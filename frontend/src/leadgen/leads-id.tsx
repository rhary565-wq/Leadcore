import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  getLead, enrichLeadWithApollo, getLeadApolloContacts, getKeyContacts,
  pushApolloContactsToHubspot, approveContact, rejectContact,
  saveNotes, approveLeads, rejectLeads, bulkApproveContacts,
  type Lead, type KeyContact, type ApolloEnrichResult,
} from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtRevenue(rev: number | null | undefined, range: string | null | undefined): string {
  if (range) return range;
  if (!rev)  return '—';
  if (rev >= 1_000_000_000) return `$${(rev / 1_000_000_000).toFixed(1)}B`;
  if (rev >= 1_000_000)     return `$${(rev / 1_000_000).toFixed(1)}M`;
  if (rev >= 1_000)         return `$${(rev / 1_000).toFixed(0)}K`;
  return `$${rev}`;
}
function fmtHeadcount(n: number | null | undefined): string {
  if (!n) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function StarRating({ rating }: { rating: number | null | undefined }) {
  if (!rating) return <span className="text-gray-300 text-xs">No rating</span>;
  const full = Math.floor(rating);
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <span key={i} className={`text-sm ${i <= full ? 'text-amber-400' : i - 0.5 <= rating ? 'text-amber-300' : 'text-gray-200'}`}>★</span>
      ))}
    </div>
  );
}

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm'|'md' }) {
  const COLORS = ['bg-indigo-400','bg-violet-400','bg-pink-400','bg-sky-400','bg-emerald-400','bg-amber-500','bg-rose-400','bg-teal-400'];
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.trim().split(/\s+/).slice(0,2).map(w => w[0] || '').join('').toUpperCase() || '?';
  const sz = size === 'md' ? 'w-8 h-8 text-sm' : 'w-6 h-6 text-xs';
  return (
    <div className={`${sz} ${COLORS[h % COLORS.length]} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

function ScoreChip({ score }: { score: number }) {
  const cls = score >= 90 ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : score >= 75 ? 'bg-blue-100 text-blue-700 border-blue-200'
    : score >= 60 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-gray-100 text-gray-500 border-gray-200';
  return <span className={`inline-block font-bold text-xs px-1.5 py-0.5 rounded border ${cls}`}>{score}</span>;
}

function VerificationBadge({ score }: { score: number }) {
  return score >= 85
    ? <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 whitespace-nowrap">✅ Verified</span>
    : <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100 whitespace-nowrap">⚠️ Probable</span>;
}

function SourceBadge({ source }: { source: string | null | undefined }) {
  const s = (source || 'apollo');
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  const cls = s.toLowerCase() === 'apollo' ? 'bg-indigo-50 text-indigo-600' : 'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function InfoRow({ label, value, isLink = false }: { label: string; value: string | null | undefined; isLink?: boolean }) {
  return (
    <div>
      <span className="text-gray-400 text-xs">{label}</span>
      {isLink && value
        ? <a href={value.startsWith('http') ? value : `https://${value}`} target="_blank" rel="noreferrer"
            className="block text-blue-500 hover:underline font-medium text-sm truncate mt-0.5">{value}</a>
        : <p className="text-gray-700 font-medium text-sm mt-0.5 break-words">{value || '—'}</p>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LeadReviewPage() {
  const { id } = useParams<{ id: string }>();

  const [lead, setLead]                     = useState<Lead | null>(null);
  const [contacts, setContacts]             = useState<KeyContact[]>([]);
  const [selected, setSelected]             = useState<Set<string>>(new Set());
  const [enrichResult, setEnrichResult]     = useState<ApolloEnrichResult | null>(null);
  const [loading, setLoading]               = useState(true);
  const [enriching, setEnriching]           = useState(false);
  const [syncing, setSyncing]               = useState(false);
  const [approvingLead, setApprovingLead]   = useState(false);
  const [savingNotes, setSavingNotes]       = useState(false);
  const [autoApproving, setAutoApproving]   = useState(false);
  const [toast, setToast]                   = useState('');
  const [error, setError]                   = useState('');
  const [notes, setNotes]                   = useState('');
  const [companyCollapsed, setCompanyCollapsed] = useState(false);
  const [contactSearch, setContactSearch]   = useState('');
  const [positionFilter, setPositionFilter] = useState('All Positions');
  const [deptFilter, setDeptFilter]         = useState('All Departments');
  const [sourceFilter, setSourceFilter]     = useState('All Sources');
  const [statusFilter, setStatusFilter]     = useState('All Statuses');
  const autoEnrichedRef = useRef(false);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500); }

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch lead + contacts from BOTH sources in parallel, then merge
      const [leadData, r1, r2] = await Promise.all([
        getLead(id),
        getLeadApolloContacts(id).then(r => r.contacts || []).catch(() => [] as KeyContact[]),
        getKeyContacts({ leadId: id }).catch(() => [] as KeyContact[]),
      ]);
      setLead(leadData);
      // Deduplicate by id — key contacts (all sources) takes precedence over apollo-only
      const seen = new Set<string>();
      const merged: KeyContact[] = [];
      for (const c of [...r2, ...r1]) {
        if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
      }
      setContacts(merged);
      setNotes(leadData.reviewer_notes || '');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Auto-enrich on first open ─────────────────────────────────────────────
  useEffect(() => {
    if (lead && !lead.apollo_company_enriched_at && !autoEnrichedRef.current) {
      autoEnrichedRef.current = true;
      handleEnrich();
    }
  }, [lead]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────
  async function handleEnrich() {
    setEnriching(true);
    try {
      const result = await enrichLeadWithApollo(id);
      setEnrichResult(result);
      showToast(result.message);
      await loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Enrichment failed');
    } finally { setEnriching(false); }
  }

  async function handleApproveLead() {
    if (!lead) return;
    setApprovingLead(true);
    try {
      await approveLeads([lead.id], 'reviewer', lead.job_id);
      showToast('✅ Lead approved');
      await loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Approval failed');
    } finally { setApprovingLead(false); }
  }

  async function handleRejectLead() {
    if (!lead) return;
    setApprovingLead(true);
    try {
      await rejectLeads([lead.id], 'Rejected during review', 'reviewer');
      showToast('Lead rejected');
      await loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Rejection failed');
    } finally { setApprovingLead(false); }
  }

  // One-click: approve all pending contacts + immediately push to HubSpot
  async function handleAutoApproveAll() {
    const pending = contacts.filter(c => c.status === 'pending' || c.status === 'approved');
    if (!pending.length) { showToast('No contacts to approve'); return; }
    setAutoApproving(true);
    try {
      // Step 1 — approve all pending
      const pendingIds = pending.filter(c => c.status === 'pending').map(c => c.id);
      if (pendingIds.length) {
        await bulkApproveContacts(pendingIds);
        setContacts(prev => prev.map(c => pendingIds.includes(c.id) ? { ...c, status: 'approved' } : c));
      }
      // Step 2 — push all (pending + already-approved) to HubSpot
      const allIds = pending.map(c => c.id);
      await pushApolloContactsToHubspot(allIds, lead?.job_id);
      showToast(`⚡ ${allIds.length} contact(s) approved & pushed to HubSpot`);
      await loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Auto-approve failed');
    } finally { setAutoApproving(false); }
  }

  async function handleSaveNotes() {
    if (!lead) return;
    setSavingNotes(true);
    try {
      await saveNotes(lead.id, notes);
      showToast('Notes saved');
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Save failed');
    } finally { setSavingNotes(false); }
  }

  function toggleContact(cid: string) {
    setSelected(prev => { const s = new Set(prev); s.has(cid) ? s.delete(cid) : s.add(cid); return s; });
  }
  function toggleAll() {
    const eligible = filteredContacts.filter(c => c.status !== 'pushed');
    if (selected.size === eligible.length && eligible.length > 0) setSelected(new Set());
    else setSelected(new Set(eligible.map(c => c.id)));
  }

  async function handleApprove(contactId: string) {
    await approveContact(contactId);
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status: 'approved' } : c));
    showToast('Contact approved');
  }
  async function handleReject(contactId: string) {
    await rejectContact(contactId);
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status: 'rejected' } : c));
    showToast('Contact rejected');
  }

  async function handleBulkApprove() {
    const ids = [...selected].filter(sid => contacts.find(c => c.id === sid)?.status !== 'pushed');
    if (!ids.length) return;
    try {
      await bulkApproveContacts(ids);
      setContacts(prev => prev.map(c => ids.includes(c.id) ? { ...c, status: 'approved' } : c));
      showToast(`${ids.length} contact(s) approved`);
      setSelected(new Set());
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleBulkReject() {
    const ids = [...selected].filter(sid => contacts.find(c => c.id === sid)?.status !== 'pushed');
    if (!ids.length) return;
    try {
      await Promise.all(ids.map(sid => rejectContact(sid)));
      setContacts(prev => prev.map(c => ids.includes(c.id) ? { ...c, status: 'rejected' } : c));
      showToast(`${ids.length} contact(s) rejected`);
      setSelected(new Set());
    } catch (e: unknown) { showToast(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleSync() {
    const ids = selected.size > 0
      ? [...selected]
      : contacts.filter(c => c.status === 'approved').map(c => c.id);
    if (!ids.length) return;
    setSyncing(true);
    try {
      await pushApolloContactsToHubspot(ids, lead?.job_id);
      showToast(`${ids.length} contact(s) queued for HubSpot`);
      setSelected(new Set());
      await loadData();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Sync failed');
    } finally { setSyncing(false); }
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredContacts = contacts.filter(c => {
    if (contactSearch) {
      const q = contactSearch.toLowerCase();
      const name = `${c.first_name||''} ${c.last_name||''} ${c.person_name||''}`.toLowerCase();
      if (!name.includes(q) && !(c.job_title||'').toLowerCase().includes(q)) return false;
    }
    if (positionFilter !== 'All Positions' && c.job_title !== positionFilter) return false;
    if (deptFilter !== 'All Departments' && c.department !== deptFilter) return false;
    if (sourceFilter !== 'All Sources' && (c.source_type||'apollo').toLowerCase() !== sourceFilter.toLowerCase()) return false;
    if (statusFilter !== 'All Statuses' && c.status !== statusFilter) return false;
    return true;
  });

  const uniquePositions = [...new Set(contacts.map(c => c.job_title).filter(Boolean))] as string[];
  const uniqueDepts     = [...new Set(contacts.map(c => c.department).filter(Boolean))] as string[];
  const uniqueSources   = [...new Set(contacts.map(c => c.source_type || 'apollo'))] as string[];

  const approvedContacts  = contacts.filter(c => c.status === 'approved');
  const contactsToSync    = selected.size > 0 ? contacts.filter(c => selected.has(c.id)) : approvedContacts;
  const alreadyEnriched   = !!lead?.apollo_company_enriched_at;
  const hasApollo         = !!lead?.apollo_company_id;

  const scoreGradient: Record<string, string> = {
    Hot:  'from-emerald-400 to-teal-500',
    Warm: 'from-amber-400 to-orange-500',
    Low:  'from-gray-400 to-gray-500',
  };
  const statusBadgeCls: Record<string, string> = {
    Hot:  'bg-red-100 text-red-600 border-red-200',
    Warm: 'bg-amber-100 text-amber-600 border-amber-200',
    Low:  'bg-gray-100 text-gray-500 border-gray-200',
  };
  const approvalBadgeCls: Record<string, string> = {
    pending:  'bg-amber-50 text-amber-600 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    rejected: 'bg-red-50 text-red-500 border-red-200',
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="space-y-4 animate-pulse max-w-7xl mx-auto py-6 px-4">
      <div className="h-36 bg-gray-100 rounded-2xl"/>
      <div className="h-72 bg-gray-100 rounded-2xl"/>
      <div className="h-48 bg-gray-100 rounded-2xl"/>
    </div>
  );
  if (error || !lead) return (
    <div className="max-w-7xl mx-auto py-6 px-4">
      <div className="bg-white rounded-2xl border border-red-200 p-8 text-center text-red-500">{error || 'Lead not found'}</div>
    </div>
  );

  const gradient = scoreGradient[lead.lead_status] || scoreGradient.Low;
  const statusCls = statusBadgeCls[lead.lead_status] || statusBadgeCls.Low;
  const approvalCls = approvalBadgeCls[lead.approval_status] || approvalBadgeCls.pending;

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 animate-fade-in">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-600 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      {/* ① HEADER ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-4">
        <div className="mb-3">
          <Link href={`/approval/${lead.job_id}`} className="text-xs text-indigo-500 hover:underline">← Back to Approval Queue</Link>
        </div>
        <div className="flex items-start gap-4">
          {/* Score circle */}
          <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${gradient} flex flex-col items-center justify-center text-white flex-shrink-0 shadow-md`}>
            <span className="text-xl font-bold leading-none">{lead.lead_score}</span>
            <span className="text-xs opacity-80 mt-0.5">Score</span>
          </div>

          {/* Name + badges + contact info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-xl font-bold text-gray-900">{lead.company_name}</h1>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusCls}`}>● {lead.lead_status}</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${approvalCls}`}>
                ● {(lead.approval_status || 'pending').charAt(0).toUpperCase() + (lead.approval_status || 'pending').slice(1)}
              </span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full border border-gray-200">
                👤 Contacts found ({contacts.length})
              </span>
            </div>
            <p className="text-sm text-gray-500">{lead.industry || 'Business'}</p>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 flex-wrap">
              {lead.phone   && <span>📞 {lead.phone}</span>}
              {lead.website && (
                <a href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                  target="_blank" rel="noreferrer" className="text-blue-500 hover:underline truncate max-w-[200px]">
                  🌐 {lead.website}
                </a>
              )}
              {lead.address && <span className="truncate max-w-[220px]">📍 {lead.address}</span>}
            </div>
          </div>

          {/* Right: rating + action buttons */}
          <div className="flex flex-col items-end gap-3 flex-shrink-0">
            <div className="flex gap-2">
              <button onClick={handleApproveLead} disabled={approvingLead || lead.approval_status === 'approved'}
                className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors shadow-sm">
                Approve
              </button>
              <button onClick={handleRejectLead} disabled={approvingLead || lead.approval_status === 'rejected'}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-colors shadow-sm">
                Reject
              </button>
            </div>
            {lead.rating != null && (
              <div className="flex items-center gap-2">
                <StarRating rating={lead.rating} />
                <span className="text-sm font-semibold text-gray-700">{lead.rating}</span>
                <span className="text-xs text-gray-400">({lead.reviews_count ?? 0} reviews)</span>
              </div>
            )}
            <div className="flex gap-2">
              {lead.google_maps_url && (
                <a href={lead.google_maps_url} target="_blank" rel="noreferrer"
                  className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                  🗺 Maps
                </a>
              )}
              <button
                onClick={() => document.getElementById('company-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="text-xs bg-gray-50 text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                📋 Company Details
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Page subtitle */}
      <div className="mb-4">
        <h2 className="text-base font-bold text-gray-800">Lead Review – Prioritize Key Contacts</h2>
        <p className="text-xs text-gray-400 mt-0.5">Review contacts first, validate company information, then push to HubSpot</p>
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────────── */}
      <div className="flex gap-5 items-start">

        {/* MAIN CONTENT */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ② KEY CONTACTS ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border-2 border-indigo-200 shadow-sm overflow-hidden">
            {/* Section header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-indigo-50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">1</div>
                <h3 className="text-sm font-bold text-gray-800 tracking-wide">KEY CONTACTS</h3>
                <span className="text-xs bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full">(Apollo)</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleAutoApproveAll} disabled={autoApproving || contacts.filter(c=>c.status==='pending'||c.status==='approved').length===0}
                  title="Approve all contacts and push directly to HubSpot — skips manual review"
                  className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 flex items-center gap-1.5 shadow-sm">
                  {autoApproving
                    ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Processing...</>
                    : <>⚡ Auto-Approve All &amp; Push</>}
                </button>
                <button onClick={handleEnrich} disabled={enriching}
                  className="text-xs bg-white border border-indigo-200 text-indigo-600 font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors disabled:opacity-50 flex items-center gap-1.5">
                  {enriching
                    ? <><span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Enriching...</>
                    : <>↺ Refresh Contacts</>}
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-50 flex-wrap bg-gray-50">
              <input type="text" placeholder="Search contacts..." value={contactSearch}
                onChange={e => setContactSearch(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 w-44 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white"/>
              <select value={positionFilter} onChange={e => setPositionFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                <option>All Positions</option>
                {uniquePositions.map(p => <option key={p}>{p}</option>)}
              </select>
              <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                <option>All Departments</option>
                {uniqueDepts.map(d => <option key={d}>{d}</option>)}
              </select>
              <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                <option>All Sources</option>
                {uniqueSources.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-300 bg-white">
                <option>All Statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="pushed">Pushed</option>
              </select>
            </div>

            {/* Table */}
            {contacts.length === 0 ? (
              <div className="px-5 py-12 text-center text-gray-400 text-sm">
                {alreadyEnriched && !hasApollo
                  ? 'No company match in Apollo — contacts unavailable'
                  : enriching ? '⏳ Finding decision makers...'
                  : 'Run Apollo enrichment to discover key contacts'}
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">No contacts match the current filters</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-100 bg-gray-50">
                      <th className="py-3 px-3 w-8">
                        <input type="checkbox"
                          checked={filteredContacts.filter(c=>c.status!=='pushed').length > 0
                            && selected.size === filteredContacts.filter(c=>c.status!=='pushed').length}
                          onChange={toggleAll} className="rounded"/>
                      </th>
                      {['FIRST NAME','LAST NAME','TITLE','COMPANY','EMAIL','PHONE','SCORE','ACTIONS'].map(h => (
                        <th key={h} className="py-3 px-3 text-left text-xs text-gray-400 font-bold tracking-wide uppercase whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(c => {
                      const isPushed   = c.status === 'pushed';
                      const isApproved = c.status === 'approved';
                      const isRejected = c.status === 'rejected';
                      const isSelected = selected.has(c.id);
                      const firstName  = c.first_name || c.person_name?.split(' ')[0] || '—';
                      const lastName   = c.last_name  || c.person_name?.split(' ').slice(1).join(' ') || '—';
                      const score      = c.confidence_score ?? 0;
                      const scoreLabel = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
                      const scoreCls   = score >= 70 ? 'text-emerald-600' : score >= 45 ? 'text-amber-500' : 'text-gray-400';
                      return (
                        <tr key={c.id}
                          className={`border-b border-gray-100 transition-colors ${isSelected ? 'bg-blue-50' : isPushed ? 'bg-gray-50 opacity-70' : 'hover:bg-gray-50'}`}>
                          <td className="py-3 px-3">
                            <input type="checkbox" checked={isSelected} disabled={isPushed}
                              onChange={() => toggleContact(c.id)} className="rounded disabled:opacity-40"/>
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
                          <td className="py-3 px-3 text-gray-600 whitespace-nowrap font-medium">{c.company_name || lead?.company_name || '—'}</td>
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
                                <button onClick={() => handleReject(c.id)}
                                  className="text-xs bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 px-3 py-1 rounded-lg font-medium transition-colors">
                                  ✕ Reject
                                </button>
                              </div>
                            ) : isRejected ? (
                              <div className="flex flex-col gap-1.5">
                                <span className="text-xs bg-red-100 text-red-600 px-3 py-1 rounded-lg font-medium text-center">✕ Rejected</span>
                                <button onClick={() => handleApprove(c.id)}
                                  className="text-xs bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 px-3 py-1 rounded-lg font-medium transition-colors">
                                  ✓ Approve
                                </button>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-1.5">
                                <button onClick={() => handleApprove(c.id)}
                                  className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-1.5 rounded-lg transition-colors flex items-center gap-1 justify-center">
                                  ✓ Approve
                                </button>
                                <button onClick={() => handleReject(c.id)}
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

            {/* Footer action bar */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50">
              <span className="text-xs text-gray-500">{selected.size} selected</span>
              <div className="flex gap-2">
                <button onClick={handleBulkApprove} disabled={!selected.size}
                  className="text-xs border border-emerald-200 text-emerald-600 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors disabled:opacity-40 font-medium">
                  Bulk Approve
                </button>
                <button onClick={handleBulkReject} disabled={!selected.size}
                  className="text-xs border border-red-200 text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-40 font-medium">
                  Bulk Reject
                </button>
                <button onClick={handleSync} disabled={(selected.size === 0 && approvedContacts.length === 0) || syncing}
                  className="text-xs bg-indigo-600 text-white font-semibold px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-40 flex items-center gap-1.5">
                  {syncing
                    ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"/>Syncing...</>
                    : `⬆ Push ${selected.size > 0 ? `${selected.size} selected` : `${approvedContacts.length} approved`} to HubSpot`}
                </button>
              </div>
            </div>
          </div>

          {/* ② COMPANY INFORMATION ────────────────────────────────────────── */}
          <div id="company-section" className="bg-white rounded-2xl border-2 border-orange-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-orange-50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center text-orange-600 font-bold text-sm flex-shrink-0">2</div>
                <h3 className="text-sm font-bold text-gray-800 tracking-wide">COMPANY INFORMATION</h3>
              </div>
              <button onClick={() => setCompanyCollapsed(v => !v)}
                className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                {companyCollapsed ? 'Expand ↓' : 'Collapse ↑'}
              </button>
            </div>

            {!companyCollapsed && (
              <div className="p-5">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
                  <div className="space-y-4">
                    <InfoRow label="Business Name" value={lead.company_name}/>
                    <InfoRow label="Industry"      value={lead.industry}/>
                    <InfoRow label="Categories"    value={lead.industry}/>
                    <InfoRow label="Website"       value={lead.website} isLink/>
                    <InfoRow label="Phone"         value={lead.phone}/>
                    <InfoRow label="Email"         value={null}/>
                  </div>
                  <div className="space-y-4">
                    <InfoRow label="Address" value={lead.address}/>
                    <div>
                      <span className="text-gray-400 text-xs">Employee Size</span>
                      <p className="text-gray-700 font-medium text-sm mt-0.5">
                        {fmtHeadcount(lead.apollo_headcount)}
                        {lead.apollo_headcount && <span className="text-xs text-gray-400 ml-1">(Apollo)</span>}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-400 text-xs">Revenue</span>
                      <p className="text-gray-700 font-medium text-sm mt-0.5">
                        {fmtRevenue(lead.apollo_revenue, lead.apollo_revenue_range)}
                        {hasApollo && <span className="text-xs text-gray-400 ml-1">(Apollo)</span>}
                      </p>
                    </div>
                    <InfoRow label="Business Description" value={null}/>
                    <InfoRow label="Opening Hours"        value={null}/>
                    <InfoRow label="Social Links"         value={null}/>
                  </div>
                </div>

                {/* Rating + HubSpot row */}
                <div className="mt-4 pt-4 border-t border-gray-50 grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                  <div>
                    <span className="text-gray-400 text-xs">Google Rating</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StarRating rating={lead.rating}/>
                      <span className="text-gray-700 font-medium">{lead.rating ?? '—'}</span>
                      {lead.reviews_count && <span className="text-xs text-gray-400">({lead.reviews_count} reviews)</span>}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-400 text-xs">HubSpot Company</span>
                    <p className="text-gray-700 font-medium text-sm mt-0.5">
                      {lead.hubspot_company_id ? `ID: ${lead.hubspot_company_id}` : 'Not yet synced'}
                    </p>
                  </div>
                </div>

                {/* Buttons row */}
                <div className="mt-4 pt-4 border-t border-gray-50 flex items-center gap-3 flex-wrap">
                  <a href={lead.dbd_url || `https://datawarehouse.dbd.go.th/juristic/searchInfo?keyword=${lead.company_name}`}
                    target="_blank" rel="noreferrer"
                    className="text-xs bg-blue-50 text-blue-600 border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                    🏛 Search DBD Thailand →
                  </a>
                  {lead.google_maps_url && (
                    <a href={lead.google_maps_url} target="_blank" rel="noreferrer"
                      className="text-xs bg-white text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                      🔍 View on Google
                    </a>
                  )}
                  <div className="ml-auto">
                    {alreadyEnriched ? (
                      <button onClick={handleEnrich} disabled={enriching}
                        className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50">
                        {enriching ? 'Re-enriching...' : '↺ Re-enrich Apollo'}
                      </button>
                    ) : (
                      <button onClick={handleEnrich} disabled={enriching}
                        className="text-xs bg-indigo-600 text-white font-semibold px-4 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50">
                        {enriching ? '⏳ Enriching...' : '▶ Run Apollo Enrichment'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Apollo status bar */}
                {alreadyEnriched && (
                  <div className={`mt-3 text-xs px-3 py-2 rounded-lg ${hasApollo ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                    {hasApollo
                      ? '✅ Apollo matched — headcount & revenue loaded'
                      : '⚠️ No Apollo match — DBD link available above for official verification'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ③ GOOGLE REVIEWS ───────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border-2 border-purple-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-purple-50">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm flex-shrink-0">3</div>
                <h3 className="text-sm font-bold text-gray-800 tracking-wide">
                  GOOGLE REVIEWS{lead.reviews_count ? ` (${lead.reviews_count})` : ''}
                </h3>
              </div>
              {lead.google_maps_url && (
                <a href={lead.google_maps_url} target="_blank" rel="noreferrer"
                  className="text-xs bg-white text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                  View All Reviews →
                </a>
              )}
            </div>
            <div className="p-5">
              <div className="flex items-start gap-5 mb-5">
                <div className="text-center flex-shrink-0">
                  <p className="text-5xl font-bold text-gray-800">{lead.rating ?? '—'}</p>
                  <div className="mt-1"><StarRating rating={lead.rating}/></div>
                  <p className="text-xs text-gray-400 mt-1">{lead.reviews_count ?? 0} reviews</p>
                </div>
                <div className="flex-1 pl-5 border-l border-gray-100">
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Google Business Profile rating based on customer reviews collected from Google Maps.
                  </p>
                  {lead.google_maps_url && (
                    <a href={lead.google_maps_url} target="_blank" rel="noreferrer"
                      className="mt-2 inline-block text-xs text-blue-500 hover:underline">
                      View full review history on Google Maps →
                    </a>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
                {[
                  { stars: 5, text: 'Excellent service! View more reviews on Google Maps.' },
                  { stars: 4, text: 'Great experience. Click "View All Reviews" above.' },
                ].map((r, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                    <div className="flex items-center gap-1 mb-1.5">
                      {[1,2,3,4,5].map(s => (
                        <span key={s} className={s <= r.stars ? 'text-amber-400' : 'text-gray-200'}>★</span>
                      ))}
                      <span className="text-gray-300 ml-1">· Recent</span>
                    </div>
                    <p className="italic">{r.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ④ REVIEWER NOTES ──────────────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border-2 border-emerald-200 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-emerald-50">
              <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-sm flex-shrink-0">4</div>
              <h3 className="text-sm font-bold text-gray-800 tracking-wide">REVIEWER NOTES</h3>
            </div>
            <div className="p-5">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Add internal notes about this lead..."
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-200 resize-none text-gray-700 placeholder-gray-300"/>
              <div className="flex justify-end mt-2">
                <button onClick={handleSaveNotes} disabled={savingNotes}
                  className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50">
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          </div>

        </div>{/* end main */}

        {/* ── RIGHT SIDEBAR ────────────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 hidden lg:block">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-4">
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 bg-gray-50">
              <h3 className="text-xs font-bold text-gray-700 tracking-wide uppercase">HubSpot Sync Summary</h3>
              <span className="text-gray-400 text-sm cursor-help" title="Shows contacts and associations that will be pushed to HubSpot">ℹ</span>
            </div>

            <div className="p-4 space-y-4">
              {/* Company */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">🏢 Company</p>
                <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
                  <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]">{lead.company_name}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    lead.hubspot_company_id ? 'bg-blue-100 text-blue-600' : 'bg-emerald-100 text-emerald-600'
                  }`}>
                    {lead.hubspot_company_id ? 'Update' : 'Ready'}
                  </span>
                </div>
              </div>

              {/* Contacts to sync */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  👤 Contacts to Sync ({contactsToSync.length})
                </p>
                {contactsToSync.length === 0 ? (
                  <p className="text-xs text-gray-300 italic px-1 leading-relaxed">
                    Approve contacts in the table to prepare them for HubSpot sync
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {contactsToSync.slice(0, 5).map(c => {
                      const name = `${c.first_name||''} ${c.last_name||''}`.trim() || c.person_name || 'Unknown';
                      return (
                        <div key={c.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2.5 py-2 border border-gray-100">
                          <Avatar name={name} size="sm"/>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-gray-700 truncate">{name}</p>
                            <p className="text-xs text-gray-400 truncate">{c.job_title||'—'}</p>
                          </div>
                          <span className="text-emerald-500 text-sm font-bold">✓</span>
                        </div>
                      );
                    })}
                    {contactsToSync.length > 5 && (
                      <p className="text-xs text-gray-400 text-center">+{contactsToSync.length - 5} more</p>
                    )}
                  </div>
                )}
              </div>

              {/* Associations */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">🔗 Associations</p>
                <div className="space-y-2">
                  {[
                    { icon: '📋', text: `1 Company — Will be ${lead.hubspot_company_id ? 'updated' : 'created'}` },
                    { icon: '👤', text: `${contactsToSync.length} Contact${contactsToSync.length !== 1 ? 's' : ''} — Will be created` },
                    { icon: '🔗', text: `${contactsToSync.length} Associations — Company ↔ Contacts` },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-gray-600">
                      <span className="mt-0.5">{item.icon}</span>
                      <span className="flex-1 leading-relaxed">{item.text}</span>
                      <span className="text-emerald-500 font-bold mt-0.5">✓</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sync status */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Sync Status</p>
                <div className={`text-xs text-center py-2 px-3 rounded-lg font-medium ${
                  contactsToSync.length > 0
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                    : 'bg-gray-50 text-gray-400 border border-gray-100'
                }`}>
                  {contactsToSync.length > 0 ? '✅ Ready to push to HubSpot' : '⏳ Approve contacts first'}
                </div>
              </div>

              {/* Push button */}
              <button onClick={handleSync} disabled={contactsToSync.length === 0 || syncing}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm">
                {syncing
                  ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Pushing...</>
                  : <>Push to HubSpot 🚀</>}
              </button>

              {/* Data flow */}
              <div className="pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Data Flow</p>
                <div className="flex items-center justify-between gap-1">
                  {[
                    { icon: '🗺', label: 'Google\nBusiness' },
                    { icon: '🔬', label: 'Apollo\nEnrich' },
                    { icon: '👁', label: 'Review &\nApprove' },
                    { icon: '🟠', label: 'HubSpot\nCRM' },
                  ].map((item, i, arr) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="flex flex-col items-center">
                        <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center text-base">{item.icon}</div>
                        <p className="text-gray-400 mt-1 text-center whitespace-pre-line leading-tight" style={{fontSize:'9px'}}>{item.label}</p>
                      </div>
                      {i < arr.length - 1 && <span className="text-gray-300 text-xs mb-4">→</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>{/* end two-col */}
    </div>
  );
}
