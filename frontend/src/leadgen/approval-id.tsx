import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getLeads, approveLeads, rejectLeads, saveNotes, getJob,
  getKeyContacts, approveContact, rejectContact, triggerEnrichment,
  getLeadApolloContacts, pushApolloContactsToHubspot, bulkApproveContacts,
  type Lead, type Job, type KeyContact,
} from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

function Avatar({ name }: { name: string }) {
  const COLORS = ['bg-indigo-400','bg-violet-400','bg-pink-400','bg-sky-400','bg-emerald-400','bg-amber-500','bg-rose-400','bg-teal-400'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).slice(0,2).map(w => w[0]||'').join('').toUpperCase() || '?';
  return (
    <div className={`w-7 h-7 ${COLORS[h % COLORS.length]} rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function ScoreChip({ score }: { score: number }) {
  const cls = score >= 85 ? 'bg-emerald-100 text-emerald-700'
    : score >= 70 ? 'bg-blue-100 text-blue-700'
    : score >= 50 ? 'bg-amber-100 text-amber-700'
    : 'bg-gray-100 text-gray-500';
  return <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cls}`}>{score}</span>;
}

function VerBadge({ score }: { score: number }) {
  return score >= 85
    ? <span className="text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">✅ Verified</span>
    : <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">⚠️ Probable</span>;
}

export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>();

  const [job, setJob]               = useState<Job | null>(null);
  const [leads, setLeads]           = useState<Lead[]>([]);
  const [filter, setFilter]         = useState<Filter>('pending');
  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [loading, setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [rejectReason, setRejectReason]   = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [approverName, setApproverName]   = useState('Admin');
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [noteText, setNoteText]           = useState<Record<string, string>>({});
  const [toast, setToast]                 = useState('');
  const [error, setError]                 = useState('');
  const [search, setSearch]               = useState('');

  // Contacts per lead (loaded lazily on expand)
  const [contactsByLead, setContactsByLead]   = useState<Record<string, KeyContact[]>>({});
  const [loadingContacts, setLoadingContacts] = useState<Set<string>>(new Set());
  const [enriching, setEnriching]             = useState<Set<string>>(new Set());
  const [autoApproving, setAutoApproving]     = useState<Set<string>>(new Set());
  const [pushing, setPushing]                 = useState<Set<string>>(new Set());
  // Per-lead contact selection
  const [selectedContacts, setSelectedContacts] = useState<Record<string, Set<string>>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);
      const [jobData, leadsData] = await Promise.all([getJob(id), getLeads({ jobId: id, limit: 200 })]);
      setJob(jobData);
      setLeads(leadsData.filter(l => l.lead_status !== 'Low'));
      const notes: Record<string, string> = {};
      leadsData.forEach(l => { if (l.reviewer_notes) notes[l.id] = l.reviewer_notes; });
      setNoteText(notes);
    } catch { setError('Failed to load leads.'); }
    finally  { setLoading(false); }
  }, [id]);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  // Auto-refresh while leads are enriching
  useEffect(() => {
    const hasEnriching = leads.some(l => l.enrichment_status === 'queued' || l.enrichment_status === 'enriching');
    if (!hasEnriching) return;
    const t = setInterval(() => loadLeads(), 10000);
    return () => clearInterval(t);
  }, [leads, loadLeads]);

  // Load contacts from BOTH sources and merge
  async function loadContacts(leadId: string, force = false) {
    if (!force && (contactsByLead[leadId] || loadingContacts.has(leadId))) return;
    setLoadingContacts(prev => new Set(prev).add(leadId));
    try {
      const [r1, r2] = await Promise.allSettled([
        getKeyContacts({ leadId }),
        getLeadApolloContacts(leadId).then(r => r.contacts || []),
      ]);
      const kc = r1.status === 'fulfilled' ? r1.value : [];
      const ac = r2.status === 'fulfilled' ? r2.value : [];
      // Deduplicate by id
      const seen = new Set<string>();
      const merged: KeyContact[] = [];
      for (const c of [...kc, ...ac]) {
        if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
      }
      setContactsByLead(prev => ({ ...prev, [leadId]: merged }));
    } catch {
      setContactsByLead(prev => ({ ...prev, [leadId]: [] }));
    } finally {
      setLoadingContacts(prev => { const s = new Set(prev); s.delete(leadId); return s; });
    }
  }

  function handleExpand(leadId: string) {
    if (expandedId === leadId) { setExpandedId(null); return; }
    setExpandedId(leadId);
    loadContacts(leadId);
  }

  function toggleContactSelection(leadId: string, contactId: string) {
    setSelectedContacts(prev => {
      const cur = new Set(prev[leadId] || []);
      cur.has(contactId) ? cur.delete(contactId) : cur.add(contactId);
      return { ...prev, [leadId]: cur };
    });
  }

  async function handleAutoApproveAll(leadId: string, jobId: string) {
    const contacts = contactsByLead[leadId] || [];
    const eligible = contacts.filter(c => c.status === 'pending' || c.status === 'approved');
    if (!eligible.length) { showToast('No contacts to process'); return; }
    setAutoApproving(prev => new Set(prev).add(leadId));
    try {
      const pendingIds = eligible.filter(c => c.status === 'pending').map(c => c.id);
      if (pendingIds.length) {
        await bulkApproveContacts(pendingIds);
        setContactsByLead(prev => ({
          ...prev,
          [leadId]: prev[leadId].map(c => pendingIds.includes(c.id) ? { ...c, status: 'approved' } : c),
        }));
      }
      await pushApolloContactsToHubspot(eligible.map(c => c.id), jobId);
      showToast(`⚡ ${eligible.length} contact(s) approved & pushed to HubSpot!`);
      await loadContacts(leadId, true);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed');
    } finally {
      setAutoApproving(prev => { const s = new Set(prev); s.delete(leadId); return s; });
    }
  }

  async function handlePushSelected(leadId: string, jobId: string) {
    const sel = selectedContacts[leadId];
    const ids = sel && sel.size > 0
      ? [...sel]
      : (contactsByLead[leadId] || []).filter(c => c.status === 'approved').map(c => c.id);
    if (!ids.length) { showToast('No approved contacts to push'); return; }
    setPushing(prev => new Set(prev).add(leadId));
    try {
      await pushApolloContactsToHubspot(ids, jobId);
      showToast(`⬆ ${ids.length} contact(s) queued for HubSpot`);
      setSelectedContacts(prev => ({ ...prev, [leadId]: new Set() }));
      await loadContacts(leadId, true);
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Push failed');
    } finally {
      setPushing(prev => { const s = new Set(prev); s.delete(leadId); return s; });
    }
  }

  async function handleApproveContact(contactId: string, leadId: string) {
    try {
      await approveContact(contactId);
      setContactsByLead(prev => ({
        ...prev,
        [leadId]: prev[leadId].map(c => c.id === contactId ? { ...c, status: 'approved' } : c),
      }));
      showToast('✅ Contact approved');
    } catch { showToast('Failed to approve contact'); }
  }

  async function handleRejectContact(contactId: string, leadId: string) {
    try {
      await rejectContact(contactId);
      setContactsByLead(prev => ({
        ...prev,
        [leadId]: prev[leadId].map(c => c.id === contactId ? { ...c, status: 'rejected' } : c),
      }));
      showToast('Contact rejected');
    } catch { showToast('Failed to reject contact'); }
  }

  const filtered = leads.filter(l => {
    if (filter !== 'all' && l.approval_status !== filter) return false;
    if (!search.trim()) return true;
    const pattern = search.toLowerCase()
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*').replace(/\?/g, '.');
    const re = new RegExp(pattern, 'i');
    return re.test(l.company_name||'') || re.test(l.industry||'') || re.test(l.phone||'') ||
           re.test(l.website||'') || re.test(l.address||'') || re.test(l.city||'');
  });

  const pendingCount  = leads.filter(l => l.approval_status === 'pending').length;
  const approvedCount = leads.filter(l => l.approval_status === 'approved').length;
  const rejectedCount = leads.filter(l => l.approval_status === 'rejected').length;

  function toggleSelect(lid: string) {
    setSelected(prev => { const n = new Set(prev); n.has(lid) ? n.delete(lid) : n.add(lid); return n; });
  }
  function toggleAll() {
    const pendingIds = filtered.filter(l => l.approval_status === 'pending').map(l => l.id);
    setSelected(prev => prev.size === pendingIds.length ? new Set() : new Set(pendingIds));
  }

  async function handleBulkApprove() {
    if (!selected.size) return;
    setActionLoading(true);
    try {
      await approveLeads([...selected], approverName, id);
      showToast(`✅ ${selected.size} lead(s) approved and queued for HubSpot!`);
      setSelected(new Set());
      await loadLeads();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Approval failed'); }
    finally { setActionLoading(false); }
  }

  async function handleBulkReject() {
    if (!selected.size || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await rejectLeads([...selected], rejectReason, approverName);
      showToast(`❌ ${selected.size} lead(s) rejected.`);
      setSelected(new Set()); setShowRejectModal(false); setRejectReason('');
      await loadLeads();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Rejection failed'); }
    finally { setActionLoading(false); }
  }

  async function handleSaveNote(leadId: string) {
    try {
      await saveNotes(leadId, noteText[leadId] || '');
      showToast('📝 Note saved!');
    } catch { setError('Failed to save note.'); }
  }

  function downloadCSV() {
    if (!leads.length) return;
    const headers = ['Company Name','Industry','Phone','Website','Address','City','Rating','Reviews','Lead Score','Lead Status','Approval Status','Google Maps URL','Reviewer Notes'];
    const rows = leads.map(l => [
      l.company_name||'', l.industry||'', l.phone||'', l.website||'',
      l.address||'', l.city||'', l.rating??'', l.reviews_count??'',
      l.lead_score??'', l.lead_status||'', l.approval_status||'',
      l.google_maps_url||'', (noteText[l.id] || l.reviewer_notes || ''),
    ]);
    const escape = (v: unknown) => { const s = String(v??''); return s.includes(',')||s.includes('"')||s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s; };
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob(['﻿'+csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `leads-${job?.config?.queries?.join('-')||'leads'}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    showToast('📥 Downloading CSV...');
  }

  if (loading) return <div className="text-center py-16 text-gray-400 animate-pulse">Loading leads...</div>;
  if (error)   return <div className="text-center py-16 text-red-500">{error}</div>;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm z-50">{toast}</div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h3 className="font-bold text-lg mb-2">Reject {selected.size} Lead(s)</h3>
            <p className="text-sm text-gray-500 mb-4">Please provide a reason for rejection.</p>
            <textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Already in HubSpot, outside target market..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"/>
            <div className="flex gap-3 mt-4">
              <button onClick={handleBulkReject} disabled={!rejectReason.trim() || actionLoading}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-semibold py-2.5 rounded-lg text-sm">
                {actionLoading ? 'Rejecting...' : 'Confirm Reject'}
              </button>
              <button onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🔍 Approval Gate</h1>
          {job && (
            <p className="text-gray-400 text-sm mt-0.5">
              {job.config?.queries?.join(', ')} · {job.config?.province || job.config?.location}{job.config?.province ? ', Thailand' : `, ${job.config?.country}`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={downloadCSV} disabled={leads.length===0}
            className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 text-emerald-700 border border-emerald-200 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">
            ⬇️ Export Excel
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">Reviewing as:</span>
            <input type="text" value={approverName} onChange={e => setApproverName(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-blue-400"/>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {([
          ['all',      `All (${leads.length})`,      'bg-gray-100 text-gray-700'],
          ['pending',  `Pending (${pendingCount})`,   'bg-yellow-100 text-yellow-700'],
          ['approved', `Approved (${approvedCount})`, 'bg-green-100 text-green-700'],
          ['rejected', `Rejected (${rejectedCount})`, 'bg-red-100 text-red-700'],
        ] as [Filter, string, string][]).map(([f, label, cls]) => (
          <button key={f} onClick={() => { setFilter(f); setSelected(new Set()); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? cls + ' ring-2 ring-offset-1 ring-current' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by company, industry, phone, city... (use * as wildcard)"
          className="w-full pl-8 pr-8 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"/>
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">×</button>
        )}
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium text-blue-800">{selected.size} lead(s) selected</span>
          <div className="flex gap-2">
            <button onClick={handleBulkApprove} disabled={actionLoading}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              {actionLoading ? '...' : '✅ Approve & Push to HubSpot'}
            </button>
            <button onClick={() => setShowRejectModal(true)} disabled={actionLoading}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              ❌ Reject
            </button>
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700 px-3">Clear</button>
          </div>
        </div>
      )}

      {search && (
        <p className="text-sm text-gray-500 mb-3">
          {filtered.length === 0 ? 'No results' : `${filtered.length} result${filtered.length!==1?'s':''}`} for &ldquo;<strong>{search}</strong>&rdquo;
        </p>
      )}

      {/* Lead list */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
          {search ? `No leads matching "${search}"` : 'No leads in this category.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filter === 'pending' && pendingCount > 0 && (
            <div className="flex items-center gap-3 px-1">
              <input type="checkbox"
                checked={selected.size === filtered.filter(l=>l.approval_status==='pending').length && selected.size > 0}
                onChange={toggleAll} className="w-4 h-4 rounded"/>
              <span className="text-sm text-gray-500">Select all pending</span>
            </div>
          )}

          {filtered.map(lead => {
            const isPending         = lead.approval_status === 'pending';
            const isExpanded        = expandedId === lead.id;
            const isSelected        = selected.has(lead.id);
            const contacts          = contactsByLead[lead.id] || [];
            const isLoadingC        = loadingContacts.has(lead.id);
            const isAutoApproving   = autoApproving.has(lead.id);
            const isPushing         = pushing.has(lead.id);
            const selContacts       = selectedContacts[lead.id] || new Set<string>();
            const approvedContacts  = contacts.filter(c => c.status === 'approved');
            const pushableContacts  = selContacts.size > 0
              ? contacts.filter(c => selContacts.has(c.id))
              : approvedContacts;

            return (
              <div key={lead.id}
                className={`bg-white rounded-xl border shadow-sm transition-all ${
                  isSelected ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-200'
                }`}>

                {/* ── Lead card row ── */}
                <div className="flex items-start gap-4 p-4">
                  {isPending && (
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)}
                      className="w-4 h-4 rounded mt-1 flex-shrink-0"/>
                  )}

                  {/* Score */}
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    lead.lead_status==='Hot'  ? 'bg-red-100 text-red-700' :
                    lead.lead_status==='Warm' ? 'bg-orange-100 text-orange-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {lead.lead_score}
                  </div>

                  {/* Company info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 truncate">{lead.company_name}</span>
                      <StatusBadge status={lead.lead_status}/>
                      <StatusBadge status={lead.approval_status}/>
                      {lead.hubspot_contact_id && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">✓ In HubSpot</span>
                      )}
                      {(lead.enrichment_status==='queued'||lead.enrichment_status==='enriching') && (
                        <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-medium animate-pulse">🔍 Finding contacts...</span>
                      )}
                      {lead.enrichment_status==='enriched' && (
                        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium cursor-pointer hover:bg-indigo-200"
                          onClick={() => handleExpand(lead.id)}>
                          👤 Contacts found
                        </span>
                      )}
                      {lead.enrichment_status==='no_contacts_found' && (
                        <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full font-medium">No contacts found</span>
                      )}
                      {lead.enrichment_status==='failed' && (
                        <span className="text-xs bg-red-100 text-red-400 px-2 py-0.5 rounded-full font-medium">Enrichment failed</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{lead.industry}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-400">
                      {lead.phone   && <span>📞 {lead.phone}</span>}
                      {lead.website && <a href={lead.website} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline truncate max-w-[200px]">🌐 {lead.website}</a>}
                      {lead.address && <span>📍 {lead.city||lead.address}</span>}
                      {lead.rating > 0 && <span>⭐ {lead.rating} ({lead.reviews_count} reviews)</span>}
                    </div>
                    {lead.rejection_reason && (
                      <p className="text-xs text-red-500 mt-1">Reason: {lead.rejection_reason}</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                    {lead.google_maps_url && (
                      <a href={lead.google_maps_url} target="_blank" rel="noreferrer"
                        className="text-xs text-gray-400 hover:text-blue-600 px-2 py-1 rounded border border-gray-200 hover:border-blue-300 transition-colors">
                        Maps
                      </a>
                    )}
                    {lead.enrichment_status==='failed' && (
                      <button disabled={enriching.has(lead.id)}
                        onClick={async () => {
                          setEnriching(prev => new Set(prev).add(lead.id));
                          try { await triggerEnrichment(lead.id, id); showToast('🔍 Re-enrichment queued!'); await loadLeads(); }
                          catch { setError('Failed to queue enrichment.'); }
                          finally { setEnriching(prev => { const s=new Set(prev); s.delete(lead.id); return s; }); }
                        }}
                        className="text-xs bg-orange-50 hover:bg-orange-100 text-orange-700 font-medium px-3 py-1.5 rounded-lg border border-orange-200 transition-colors disabled:opacity-50">
                        {enriching.has(lead.id) ? '...' : '🔄 Re-enrich'}
                      </button>
                    )}

                    {/* Company Details → inline expand (no navigation) */}
                    <button
                      onClick={() => handleExpand(lead.id)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                        isExpanded
                          ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                          : 'bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100'
                      }`}>
                      {isExpanded ? '📋 Close ▲' : `📋 Company Details ${lead.enrichment_status==='enriched' ? '👤' : '▼'}`}
                    </button>

                    {isPending && (
                      <>
                        <button disabled={actionLoading}
                          onClick={async () => {
                            setActionLoading(true);
                            try { await approveLeads([lead.id], approverName, id); showToast('✅ Lead approved!'); await loadLeads(); }
                            finally { setActionLoading(false); }
                          }}
                          className="text-xs bg-green-600 hover:bg-green-700 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
                          Approve
                        </button>
                        <button
                          onClick={() => { setSelected(new Set([lead.id])); setShowRejectModal(true); }}
                          className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-medium px-3 py-1.5 rounded-lg transition-colors">
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* ── Expanded inline panel ── */}
                {isExpanded && (
                  <div className="border-t border-gray-100 bg-gray-50/50">

                    {/* Company enrichment summary */}
                    {(lead.apollo_headcount || lead.apollo_revenue || lead.apollo_revenue_range || lead.rating) && (
                      <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-100 flex-wrap text-xs text-gray-600">
                        {lead.rating > 0 && (
                          <span className="flex items-center gap-1">⭐ <strong>{lead.rating}</strong> ({lead.reviews_count} reviews)</span>
                        )}
                        {lead.apollo_headcount && (
                          <span className="flex items-center gap-1">👥 <strong>{lead.apollo_headcount >= 1000 ? `${(lead.apollo_headcount/1000).toFixed(1)}K` : lead.apollo_headcount}</strong> employees</span>
                        )}
                        {(lead.apollo_revenue || lead.apollo_revenue_range) && (
                          <span className="flex items-center gap-1">💰 <strong>
                            {lead.apollo_revenue_range || (lead.apollo_revenue && lead.apollo_revenue >= 1e9
                              ? `$${(lead.apollo_revenue/1e9).toFixed(1)}B`
                              : (lead.apollo_revenue ?? 0) >= 1e6
                              ? `$${((lead.apollo_revenue ?? 0)/1e6).toFixed(1)}M`
                              : `$${lead.apollo_revenue}`)}
                          </strong> revenue</span>
                        )}
                        <a href={`https://datawarehouse.dbd.go.th/juristic/searchInfo?keyword=${lead.company_name}`}
                          target="_blank" rel="noreferrer"
                          className="text-blue-500 hover:underline">🏛 DBD Search →</a>
                      </div>
                    )}

                    {/* Contacts header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-gray-700">👤 Contacts</h3>
                        <span className="text-xs bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full">
                          {isLoadingC ? '...' : `${contacts.length} found`}
                        </span>
                        {isLoadingC && <span className="text-xs text-blue-400 animate-pulse">Loading...</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Refresh */}
                        <button onClick={() => loadContacts(lead.id, true)} disabled={isLoadingC}
                          className="text-xs text-gray-400 hover:text-indigo-600 border border-gray-200 px-2.5 py-1 rounded-lg hover:border-indigo-200 transition-colors disabled:opacity-40">
                          ↺ Refresh
                        </button>
                        {/* Auto-Approve All & Push */}
                        <button
                          onClick={() => handleAutoApproveAll(lead.id, id)}
                          disabled={isAutoApproving || contacts.filter(c=>c.status==='pending'||c.status==='approved').length===0}
                          className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1">
                          {isAutoApproving
                            ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Processing...</>
                            : '⚡ Auto-Approve All & Push'}
                        </button>
                        {/* Push approved */}
                        <button
                          onClick={() => handlePushSelected(lead.id, id)}
                          disabled={isPushing || pushableContacts.length===0}
                          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1">
                          {isPushing
                            ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Pushing...</>
                            : `⬆ Push ${pushableContacts.length} to HubSpot`}
                        </button>
                      </div>
                    </div>

                    {/* Contacts table */}
                    {isLoadingC ? (
                      <div className="px-5 py-6 text-sm text-gray-400 animate-pulse">Fetching contacts from all sources...</div>
                    ) : contacts.length === 0 ? (
                      <div className="px-5 py-6 text-sm text-gray-400">
                        {lead.enrichment_status === 'queued' || lead.enrichment_status === 'enriching'
                          ? '🔍 Enrichment running in background — check back in a minute.'
                          : lead.enrichment_status === 'enriched'
                          ? 'No contacts saved yet — click ↺ Refresh or try opening Company Details for full enrichment.'
                          : '⚠️ No contacts found. You can still approve the lead.'}
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm border-collapse">
                          <thead>
                            <tr className="border-b-2 border-gray-100 bg-gray-50">
                              <th className="py-3 px-3 w-8">
                                <input type="checkbox"
                                  checked={contacts.filter(c=>c.status!=='pushed').length > 0
                                    && selContacts.size === contacts.filter(c=>c.status!=='pushed').length}
                                  onChange={() => {
                                    const eligible = contacts.filter(c=>c.status!=='pushed').map(c=>c.id);
                                    setSelectedContacts(prev => ({
                                      ...prev,
                                      [lead.id]: selContacts.size === eligible.length ? new Set() : new Set(eligible),
                                    }));
                                  }}
                                  className="rounded"/>
                              </th>
                              {['FIRST NAME','LAST NAME','TITLE','COMPANY','EMAIL','PHONE','SCORE','ACTIONS'].map(h => (
                                <th key={h} className="py-3 px-3 text-left text-xs text-gray-400 font-bold tracking-wide uppercase whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {contacts.map(c => {
                              const isPushed   = c.status === 'pushed';
                              const isApproved = c.status === 'approved';
                              const isRejected = c.status === 'rejected';
                              const isSel      = selContacts.has(c.id);
                              const firstName  = c.first_name || c.person_name?.split(' ')[0] || '—';
                              const lastName   = c.last_name  || c.person_name?.split(' ').slice(1).join(' ') || '—';
                              const score      = c.confidence_score ?? 0;
                              const scoreLabel = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
                              const scoreCls   = score >= 70 ? 'text-emerald-600' : score >= 45 ? 'text-amber-500' : 'text-gray-400';
                              return (
                                <tr key={c.id} className={`border-b border-gray-100 transition-colors ${isSel ? 'bg-blue-50' : isPushed ? 'bg-gray-50 opacity-70' : 'hover:bg-gray-50'}`}>
                                  <td className="py-3 px-3">
                                    <input type="checkbox" checked={isSel} disabled={isPushed}
                                      onChange={() => toggleContactSelection(lead.id, c.id)}
                                      className="rounded disabled:opacity-40"/>
                                  </td>
                                  {/* First Name */}
                                  <td className="py-3 px-3 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                      <Avatar name={`${firstName} ${lastName}`}/>
                                      <span className="font-semibold text-gray-800">{firstName}</span>
                                    </div>
                                  </td>
                                  {/* Last Name */}
                                  <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{lastName !== '—' ? lastName : <span className="text-gray-300">—</span>}</td>
                                  {/* Title */}
                                  <td className="py-3 px-3 text-gray-600 max-w-[160px]" title={c.job_title||''}>
                                    <span className="line-clamp-2 leading-snug">{c.job_title || <span className="text-gray-300">—</span>}</span>
                                  </td>
                                  {/* Company */}
                                  <td className="py-3 px-3 text-gray-600 whitespace-nowrap font-medium">{c.company_name || lead.company_name || '—'}</td>
                                  {/* Email */}
                                  <td className="py-3 px-3 whitespace-nowrap">
                                    {c.public_email
                                      ? <a href={`mailto:${c.public_email}`} className="flex items-center gap-1.5 text-blue-600 hover:underline">
                                          <span className="text-xs">✉</span>{c.public_email}
                                        </a>
                                      : <span className="text-gray-300">—</span>}
                                  </td>
                                  {/* Phone */}
                                  <td className="py-3 px-3 whitespace-nowrap">
                                    {c.public_phone
                                      ? <a href={`tel:${c.public_phone}`} className="flex items-center gap-1.5 text-blue-600 hover:underline">
                                          <span className="text-xs">📞</span>{c.public_phone}
                                        </a>
                                      : <span className="text-gray-300">—</span>}
                                  </td>
                                  {/* Score */}
                                  <td className="py-3 px-3 whitespace-nowrap">
                                    <div className="flex flex-col items-center w-12">
                                      <span className="font-bold text-gray-800 text-base leading-none">{score}</span>
                                      <span className={`text-xs font-semibold mt-0.5 ${scoreCls}`}>{scoreLabel}</span>
                                    </div>
                                  </td>
                                  {/* Actions */}
                                  <td className="py-3 px-3 whitespace-nowrap">
                                    {isPushed ? (
                                      <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg font-medium">✓ In HubSpot</span>
                                    ) : isApproved ? (
                                      <div className="flex flex-col gap-1.5">
                                        <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-lg font-medium text-center">✓ Approved</span>
                                        <button onClick={() => handleRejectContact(c.id, lead.id)}
                                          className="text-xs bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 px-3 py-1 rounded-lg font-medium transition-colors">
                                          ✕ Reject
                                        </button>
                                      </div>
                                    ) : isRejected ? (
                                      <div className="flex flex-col gap-1.5">
                                        <span className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-lg font-medium text-center">✕ Rejected</span>
                                        <button onClick={() => handleApproveContact(c.id, lead.id)}
                                          className="text-xs bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 px-3 py-1 rounded-lg font-medium transition-colors">
                                          ✓ Approve
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex flex-col gap-1.5">
                                        <button onClick={() => handleApproveContact(c.id, lead.id)}
                                          className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1 justify-center">
                                          ✓ Approve
                                        </button>
                                        <button onClick={() => handleRejectContact(c.id, lead.id)}
                                          className="text-xs bg-red-50 hover:bg-red-100 text-red-500 border border-red-200 font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1 justify-center">
                                          ✕ Reject
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Notes */}
                    <div className="border-t border-gray-100 px-5 pb-4 pt-3">
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Reviewer Notes</label>
                      <div className="flex gap-2">
                        <textarea rows={2} value={noteText[lead.id]||''} onChange={e => setNoteText(prev=>({...prev,[lead.id]:e.target.value}))}
                          placeholder="Add internal notes about this lead..."
                          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"/>
                        <button onClick={() => handleSaveNote(lead.id)}
                          className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium px-3 rounded-lg">
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 text-center">
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
