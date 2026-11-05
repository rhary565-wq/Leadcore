import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  approveContact, rejectContact, pushContactToHubspot,
  bulkApproveContacts, bulkPushContactsToHubspot,
  type KeyContact,
} from '@/lib/api';

import { apiFetch } from '@/lib/http';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'pushed';
type SourceFilter = 'all' | 'apollo' | 'apify';

const CONFIDENCE_COLORS: Record<string, string> = {
  High:   'bg-green-100 text-green-700 border-green-200',
  Medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Low:    'bg-red-100 text-red-600 border-red-200',
};
const SENIORITY_COLORS: Record<string, string> = {
  Executive: 'bg-purple-100 text-purple-700',
  Director:  'bg-blue-100 text-blue-700',
  Manager:   'bg-teal-100 text-teal-700',
  Other:     'bg-gray-100 text-gray-500',
};
const SOURCE_LABELS: Record<string, string> = {
  apollo:          '🔬 Apollo',
  facebook:        '📘 Facebook',
  google:          '🌐 Google',
  company_website: '🌐 Website',
  about_page:      'ℹ️ About',
  contact_page:    '📞 Contact',
  team_page:       '👥 Team',
  linkedin:        '💼 LinkedIn',
  website:         '🌐 Website',
};
const SOURCE_BADGE: Record<string, string> = {
  apollo:          'bg-indigo-100 text-indigo-700 border border-indigo-200',
  facebook:        'bg-blue-100 text-blue-700 border border-blue-200',
  google:          'bg-green-100 text-green-700 border border-green-200',
  linkedin:        'bg-sky-100 text-sky-700 border border-sky-200',
  company_website: 'bg-gray-100 text-gray-600 border border-gray-200',
};

function getConfidenceLevel(score: number) {
  if (score >= 70) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}

export default function AllContactsPage() {
  const [contacts,      setContacts]      = useState<KeyContact[]>([]);
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>('all');
  const [sourceFilter,  setSourceFilter]  = useState<SourceFilter>('all');
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedId,    setExpandedId]    = useState<string | null>(null);
  const [toast,         setToast]         = useState('');
  const [error,         setError]         = useState('');
  const [search,        setSearch]        = useState('');
  const [noteText,      setNoteText]      = useState<Record<string, string>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      // Always send source param — 'all' means unified view (Apollo + Apify).
      // Without it the backend defaults to Apify-only which would hide Apollo contacts.
      params.set('source', sourceFilter);
      const res  = await apiFetch(`/api/key-contacts?${params.toString()}`);
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : []);
      const notes: Record<string, string> = {};
      (Array.isArray(data) ? data : []).forEach((c: KeyContact) => {
        if (c.reviewer_notes) notes[c.id] = c.reviewer_notes;
      });
      setNoteText(notes);
    } catch {
      setError('Failed to load contacts.');
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = contacts.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.person_name  || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q) ||
      (c.job_title    || '').toLowerCase().includes(q) ||
      (c.public_email || '').toLowerCase().includes(q)
    );
  });

  // ── Group contacts into batches ───────────────────────────────────────────
  type Batch = {
    key:        string;
    label:      string;
    sublabel:   string;
    flow:       'apollo' | 'apify';
    date:       string;
    contacts:   KeyContact[];
  };

  const buildBatches = (list: KeyContact[]): Batch[] => {
    const map: Record<string, Batch> = {};
    list.forEach(c => {
      let key: string;
      let label: string;
      let sublabel: string;
      let flow: 'apollo' | 'apify';
      let date: string;

      if (c.source_type === 'apollo') {
        // Apollo: group by calendar date of creation
        const d = c.created_at ? new Date(c.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : 'Unknown date';
        key      = 'apollo-' + (c.created_at ? c.created_at.slice(0, 10) : 'unknown');
        label    = '🔬 Apollo Search';
        sublabel = d;
        flow     = 'apollo';
        date     = c.created_at || '';
      } else if (c.job_id) {
        // Apify: group by job
        key      = 'apify-' + c.job_id;
        const cfg = c.job_config;
        const queries  = cfg?.queries?.join(', ') || 'Apify Job';
        const location = [cfg?.location, cfg?.country].filter(Boolean).join(', ');
        label    = '🕷️ ' + queries;
        sublabel = location || (c.job_created_at ? new Date(c.job_created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '');
        flow     = 'apify';
        date     = c.job_created_at || c.created_at || '';
      } else {
        // Apify without job (legacy)
        const d = c.created_at ? c.created_at.slice(0, 10) : 'unknown';
        key      = 'apify-legacy-' + d;
        label    = '🕷️ Apify Enrichment';
        sublabel = d;
        flow     = 'apify';
        date     = c.created_at || '';
      }

      if (!map[key]) map[key] = { key, label, sublabel, flow, date, contacts: [] };
      map[key].contacts.push(c);
    });

    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
  };

  const batches = buildBatches(filtered);

  // Stats
  const stats = {
    total:    contacts.length,
    pending:  contacts.filter(c => c.status === 'pending').length,
    approved: contacts.filter(c => c.status === 'approved').length,
    rejected: contacts.filter(c => c.status === 'rejected').length,
    pushed:   contacts.filter(c => c.status === 'pushed').length,
    apollo:   contacts.filter(c => c.source_type === 'apollo').length,
    apify:    contacts.filter(c => c.source_type !== 'apollo').length,
  };

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    const ids = filtered.filter(c => c.status === 'pending').map(c => c.id);
    setSelected(prev => prev.size === ids.length && ids.length > 0 ? new Set() : new Set(ids));
  }

  async function handleBulkApprove() {
    if (!selected.size) return;
    setActionLoading(true);
    try {
      await bulkApproveContacts([...selected]);
      showToast(`✅ ${selected.size} contact(s) approved!`);
      setSelected(new Set());
      await load();
    } catch { showToast('Approve failed'); }
    finally { setActionLoading(false); }
  }

  async function handleBulkPush() {
    const approvedIds = contacts.filter(c => c.status === 'approved').map(c => c.id);
    if (!approvedIds.length) { showToast('No approved contacts to push.'); return; }
    setActionLoading(true);
    try {
      // Group by lead_id for HubSpot push
      const leadId = contacts.find(c => c.status === 'approved')?.lead_id || '';
      await bulkPushContactsToHubspot(approvedIds, leadId);
      showToast(`🚀 ${approvedIds.length} contacts pushed to HubSpot!`);
      await load();
    } catch { showToast('Push failed'); }
    finally { setActionLoading(false); }
  }

  async function handleApprove(id: string) {
    setActionLoading(true);
    try { await approveContact(id, noteText[id]); showToast('✅ Approved!'); await load(); }
    catch { showToast('Approve failed'); }
    finally { setActionLoading(false); }
  }

  async function handleReject(id: string) {
    setActionLoading(true);
    try { await rejectContact(id, noteText[id]); showToast('❌ Rejected.'); await load(); }
    catch { showToast('Reject failed'); }
    finally { setActionLoading(false); }
  }

  async function handlePushOne(id: string) {
    setActionLoading(true);
    try { await pushContactToHubspot(id); showToast('🚀 Pushed to HubSpot!'); await load(); }
    catch { showToast('Push failed'); }
    finally { setActionLoading(false); }
  }

  function downloadCSV() {
    const headers = ['Source','Company','Person Name','Job Title','Email','Phone','LinkedIn','Status','Confidence'];
    const escape  = (v: unknown) => { const s = String(v ?? ''); return s.includes(',') ? `"${s.replace(/"/g,'""')}"` : s; };
    const rows    = filtered.map(c => [
      SOURCE_LABELS[c.source_type] || c.source_type,
      c.company_name, c.person_name, c.job_title,
      c.public_email, c.public_phone, c.linkedin_url,
      c.status, c.confidence_score,
    ]);
    const csv  = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `all-contacts-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Downloading CSV...');
  }

  if (loading) return <div className="text-center py-16 text-gray-400 animate-pulse">Loading contacts...</div>;
  if (error)   return <div className="text-center py-16 text-red-500">{error}</div>;

  const approvedCount = contacts.filter(c => c.status === 'approved').length;

  return (
    <div>
      {toast && (
        <div className="fixed top-6 right-6 text-white px-5 py-3 rounded-2xl text-sm z-50 animate-toast-in" style={{background:"linear-gradient(135deg,#1e293b,#0f172a)",boxShadow:"0 8px 24px rgb(0 0 0/.25)"}}>{toast}</div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">All Contacts</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            Unified review — 🔬 Apollo + 🕷️ Apify contacts together
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleBulkPush}
            disabled={actionLoading || approvedCount === 0}
            className="btn-success text-sm px-4 py-2"
          >
            🚀 Push to HubSpot {approvedCount > 0 ? `(${approvedCount})` : ''}
          </button>
          <button
            onClick={downloadCSV}
            disabled={filtered.length === 0}
            className="btn-secondary text-sm disabled:opacity-40"
          >
            ⬇️ CSV
          </button>
          <button onClick={load} className="btn-secondary text-sm">
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {([
          ['Total',    stats.total,    '#f8fafc','#475569','#e2e8f0'],
          ['Pending',  stats.pending,  '#fffbeb','#b45309','#fde68a'],
          ['Approved', stats.approved, '#f0fdf4','#15803d','#bbf7d0'],
          ['Rejected', stats.rejected, '#fef2f2','#b91c1c','#fecaca'],
          ['HubSpot',  stats.pushed,   '#faf5ff','#3b4a8c','#e9d5ff'],
          ['🔬 Apollo', stats.apollo,   '#eef2ff','#242A56','#c7d2fe'],
          ['🕷️ Apify',  stats.apify,    '#fff7ed','#c2410c','#fed7aa'],
        ] as [string, number, string, string, string][]).map(([label, count, bg, color, border]) => (
          <div key={label} className="rounded-xl p-3 text-center" style={{background:bg, border:`1px solid ${border}`}}>
            <div className="text-xl font-bold" style={{color}}>{count}</div>
            <div className="text-xs font-semibold mt-0.5 leading-tight" style={{color}}>{label}</div>
          </div>
        ))}
      </div>

      {/* Source filter tabs */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mr-1" style={{letterSpacing:'.07em',fontSize:'10px'}}>Source</span>
        {([
          ['all',    '🌐 All'],
          ['apollo', '🔬 Apollo'],
          ['apify',  '🕷️ Apify'],
        ] as [SourceFilter, string][]).map(([val, label]) => (
          <button key={val} onClick={() => { setSourceFilter(val); setSelected(new Set()); }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
            style={sourceFilter === val
              ? {background:'linear-gradient(135deg,#242A56,#3b4a8c)', color:'#fff', boxShadow:'0 2px 8px rgb(36 42 86/.3)'}
              : {background:'#f8fafc', color:'#64748b', border:'1px solid #f1f5f9'}}>
            {label}
          </button>
        ))}
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest mr-1" style={{letterSpacing:'.07em',fontSize:'10px'}}>Status</span>
        {(['all', 'pending', 'approved', 'rejected', 'pushed'] as StatusFilter[]).map(f => (
          <button key={f} onClick={() => { setStatusFilter(f); setSelected(new Set()); }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all capitalize"
            style={statusFilter === f
              ? {background:'linear-gradient(135deg,#242A56,#3b4a8c)', color:'#fff', boxShadow:'0 2px 8px rgb(36 42 86/.3)'}
              : {background:'#f8fafc', color:'#64748b', border:'1px solid #f1f5f9'}}>
            {f === 'pushed' ? 'In HubSpot' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, company, title, email…"
          className="input pl-8 pr-8 py-2.5"/>
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">×</button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="rounded-2xl px-5 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap animate-slide-in" style={{background:"linear-gradient(135deg,#eef2ff,#f5f3ff)",border:"1px solid #c7d2fe"}}>
          <span className="text-sm font-medium text-indigo-800">{selected.size} contact(s) selected</span>
          <div className="flex gap-2">
            <button onClick={handleBulkApprove} disabled={actionLoading}
              className="btn-success text-sm">
              {actionLoading ? '...' : '✅ Approve Selected'}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700 px-3">Clear</button>
          </div>
        </div>
      )}

      {/* Results count */}
      {contacts.length > 0 && (
        <p className="text-xs text-gray-400 mb-3">
          Showing {filtered.length} of {contacts.length} contacts
        </p>
      )}

      {/* Empty */}
      {contacts.length === 0 ? (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4" style={{background:"linear-gradient(135deg,#eef2ff,#f5f3ff)",border:"1px solid #e0e7ff"}}>👤</div>
          <p className="font-bold text-gray-800 text-lg mb-1">No contacts yet</p>
          <p className="text-sm text-gray-400">
            Run an <Link href="/apollo" className="text-indigo-500 hover:underline">Apollo Search</Link> or{' '}
            <Link href="/" className="text-indigo-500 hover:underline">launch a job</Link> to start collecting contacts.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-3xl mb-3">🔍</p>
          <p className="text-gray-500 font-semibold">No contacts match your filters</p>
          <p className="text-gray-400 text-sm mt-1">Try adjusting the source or status filters</p>
        </div>
      ) : (
        <>
          {/* Select all pending */}
          {statusFilter === 'pending' && (
            <div className="flex items-center gap-3 px-1 mb-2">
              <input type="checkbox"
                checked={selected.size === filtered.filter(c => c.status === 'pending').length && selected.size > 0}
                onChange={toggleAll} className="w-4 h-4 rounded"/>
              <span className="text-sm text-gray-500">Select all pending</span>
            </div>
          )}

          <div className="space-y-6">
            {batches.map(batch => (
              <div key={batch.key}>
                {/* Batch header */}
                <div className={`flex items-center gap-3 mb-3 px-1`}>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border ${
                    batch.flow === 'apollo'
                      ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                      : 'bg-orange-100 text-orange-700 border-orange-200'
                  }`}>
                    {batch.label}
                  </div>
                  <span className="text-xs text-gray-400">{batch.sublabel}</span>
                  <span className="text-xs text-gray-300 ml-auto">{batch.contacts.length} contact{batch.contacts.length !== 1 ? 's' : ''}</span>
                </div>

                <div className="space-y-3">
                {batch.contacts.map(contact => {
              const level      = getConfidenceLevel(contact.confidence_score);
              const isPending  = contact.status === 'pending';
              const isExpanded = expandedId === contact.id;
              const isSelected = selected.has(contact.id);

              return (
                <div key={contact.id}
                  className={`bg-white rounded-xl border shadow-sm transition-all ${
                    isSelected ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'
                  }`}>
                  <div className="flex items-start gap-4 p-4">
                    {isPending && (
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(contact.id)}
                        className="w-4 h-4 rounded mt-1 flex-shrink-0"/>
                    )}

                    {/* Score circle */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border ${
                      CONFIDENCE_COLORS[level] || 'bg-gray-100 text-gray-600 border-gray-200'
                    }`}>
                      {contact.confidence_score}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{contact.person_name || '—'}</span>
                        {/* Source badge */}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_BADGE[contact.source_type] || 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                          {SOURCE_LABELS[contact.source_type] || contact.source_type}
                        </span>
                        {contact.seniority && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SENIORITY_COLORS[contact.seniority] || 'bg-gray-100 text-gray-500'}`}>
                            {contact.seniority}
                          </span>
                        )}
                        {contact.status === 'approved' && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Approved</span>}
                        {contact.status === 'rejected' && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">✗ Rejected</span>}
                        {contact.status === 'pushed'   && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">✓ In HubSpot</span>}
                      </div>

                      <p className="text-sm text-gray-600 mt-0.5">
                        {contact.job_title || 'Unknown Title'}
                        {contact.company_name && <span className="text-gray-400"> · {contact.company_name}</span>}
                      </p>

                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-400">
                        {contact.public_email && <span className="text-green-600 font-medium">✉️ {contact.public_email}</span>}
                        {contact.public_phone && <span className="text-blue-600 font-medium">📞 {contact.public_phone}</span>}
                        {contact.company_city && <span>📍 {contact.company_city}</span>}
                        {contact.person_headline && <span className="truncate max-w-xs" title={contact.person_headline}>{contact.person_headline}</span>}
                      </div>

                      {/* Apollo intel row */}
                      {contact.source_type === 'apollo' && (contact.company_headcount || contact.company_revenue || contact.company_tech_stack) && (
                        <div className="flex flex-wrap gap-x-3 mt-1 text-xs text-indigo-400">
                          {contact.company_headcount && <span>👥 {contact.company_headcount.toLocaleString()} employees</span>}
                          {contact.company_revenue   && <span>💰 {contact.company_revenue}</span>}
                          {contact.company_tech_stack && <span>🛠 {contact.company_tech_stack.split(',').slice(0,3).join(', ')}</span>}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-3 mt-1">
                        {contact.linkedin_url && (
                          <a href={contact.linkedin_url} target="_blank" rel="noreferrer"
                            className="text-xs text-blue-500 hover:underline">💼 LinkedIn</a>
                        )}
                        {contact.source_url && contact.source_url !== contact.linkedin_url && (
                          <a href={contact.source_url} target="_blank" rel="noreferrer"
                            className="text-xs text-gray-400 hover:text-blue-500">🔗 Source</a>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      <button onClick={() => setExpandedId(isExpanded ? null : contact.id)}
                        className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-300">
                        {isExpanded ? 'Less ▲' : 'Notes ▼'}
                      </button>
                      {isPending && (
                        <>
                          <button onClick={() => handleApprove(contact.id)} disabled={actionLoading}
                            className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-3 py-1.5 rounded-lg">
                            Approve
                          </button>
                          <button onClick={() => handleReject(contact.id)} disabled={actionLoading}
                            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-medium px-3 py-1.5 rounded-lg">
                            Reject
                          </button>
                        </>
                      )}
                      {contact.status === 'approved' && (
                        <button onClick={() => handlePushOne(contact.id)} disabled={actionLoading}
                          className="text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-medium px-3 py-1.5 rounded-lg">
                          🚀 Push
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Notes expanded */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Reviewer Notes</label>
                      <input type="text"
                        value={noteText[contact.id] || ''}
                        onChange={e => setNoteText(prev => ({ ...prev, [contact.id]: e.target.value }))}
                        placeholder="Add a note..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
                    </div>
                  )}
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="mt-8 text-center">
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
