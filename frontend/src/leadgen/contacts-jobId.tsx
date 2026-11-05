import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  getKeyContacts, getContactStats, getJob,
  approveContact, rejectContact, pushContactToHubspot,
  bulkApproveContacts, bulkPushContactsToHubspot,
  type KeyContact, type ContactStats, type Job,
} from '@/lib/api';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'pushed';

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
  about_page:      'ℹ️ About Page',
  contact_page:    '📞 Contact',
  team_page:       '👥 Team Page',
  linkedin:        '💼 LinkedIn',
  website:         '🌐 Website',
  unknown:         '❓ Unknown',
};

const SOURCE_BADGE: Record<string, string> = {
  apollo:   'bg-indigo-100 text-indigo-700 border border-indigo-200',
  facebook: 'bg-blue-100 text-blue-700 border border-blue-200',
  google:   'bg-green-100 text-green-700 border border-green-200',
  linkedin: 'bg-sky-100 text-sky-700 border border-sky-200',
};

function getConfidenceLevel(score: number) {
  if (score >= 70) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}

export default function ContactsPage() {
  const { jobId }      = useParams<{ jobId: string }>();
  const searchParams   = useSearchParams();
  const leadIdFilter   = searchParams.get('leadId') || '';

  const [job, setJob]             = useState<Job | null>(null);
  const [contacts, setContacts]   = useState<KeyContact[]>([]);
  const [stats, setStats]         = useState<ContactStats | null>(null);
  const [filter, setFilter]       = useState<StatusFilter>('all');
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [loading, setLoading]     = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [toast, setToast]                 = useState('');
  const [error, setError]                 = useState('');
  const [search, setSearch]               = useState('');
  const [noteText, setNoteText]           = useState<Record<string, string>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [jobData, contactData, statsData] = await Promise.all([
        getJob(jobId),
        getKeyContacts({ jobId, ...(leadIdFilter ? { leadId: leadIdFilter } : {}) }),
        getContactStats(jobId),
      ]);
      setJob(jobData);
      setContacts(contactData);
      setStats(statsData);
      const notes: Record<string, string> = {};
      contactData.forEach(c => { if (c.reviewer_notes) notes[c.id] = c.reviewer_notes; });
      setNoteText(notes);
    } catch {
      setError('Failed to load contacts.');
    } finally {
      setLoading(false);
    }
  }, [jobId, leadIdFilter]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while any lead is still enriching
  useEffect(() => {
    const hasEnriching = contacts.some(c => c.status === 'pending');
    if (!hasEnriching) return;
    const t = setInterval(() => load(), 12000);
    return () => clearInterval(t);
  }, [contacts, load]);

  const filtered = contacts.filter(c => {
    if (filter !== 'all' && c.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.person_name   || '').toLowerCase().includes(q) ||
      (c.company_name  || '').toLowerCase().includes(q) ||
      (c.job_title     || '').toLowerCase().includes(q) ||
      (c.department    || '').toLowerCase().includes(q) ||
      (c.seniority     || '').toLowerCase().includes(q)
    );
  });

  function toggleSelect(cid: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(cid) ? next.delete(cid) : next.add(cid);
      return next;
    });
  }

  function toggleAll() {
    const ids = filtered.filter(c => c.status === 'pending').map(c => c.id);
    setSelected(prev => prev.size === ids.length ? new Set() : new Set(ids));
  }

  async function handleBulkApprove() {
    if (!selected.size) return;
    setActionLoading(true);
    try {
      await bulkApproveContacts([...selected]);
      showToast(`✅ ${selected.size} contact(s) approved!`);
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk approve failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleBulkPush() {
    const approvedIds = contacts
      .filter(c => c.status === 'approved')
      .map(c => c.id);
    if (!approvedIds.length) {
      showToast('No approved contacts to push. Approve some first.');
      return;
    }
    setActionLoading(true);
    try {
      await bulkPushContactsToHubspot(approvedIds, jobId);
      showToast(`🚀 ${approvedIds.length} contacts queued for HubSpot!`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleApprove(id: string) {
    setActionLoading(true);
    try {
      await approveContact(id, noteText[id]);
      showToast('✅ Contact approved!');
      await load();
    } catch { setError('Approve failed.'); }
    finally { setActionLoading(false); }
  }

  async function handleReject(id: string) {
    setActionLoading(true);
    try {
      await rejectContact(id, noteText[id]);
      showToast('❌ Contact rejected.');
      await load();
    } catch { setError('Reject failed.'); }
    finally { setActionLoading(false); }
  }

  async function handlePushOne(id: string) {
    setActionLoading(true);
    try {
      await pushContactToHubspot(id);
      showToast('🚀 Pushed to HubSpot!');
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Push failed');
    } finally { setActionLoading(false); }
  }

  function downloadCSV() {
    const headers = [
      'Company', 'Person Name', 'Job Title', 'Department', 'Seniority',
      'LinkedIn', 'Email', 'Phone', 'Source Type', 'Source URL',
      'Confidence Score', 'Confidence Level', 'Status', 'Notes'
    ];
    const escape = (v: unknown) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = contacts.map(c => [
      c.company_name, c.person_name, c.job_title, c.department, c.seniority,
      c.linkedin_url, c.public_email, c.public_phone,
      c.source_type, c.source_url,
      c.confidence_score, getConfidenceLevel(c.confidence_score),
      c.status, noteText[c.id] || c.reviewer_notes || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `key-contacts-${jobId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Downloading CSV...');
  }

  if (loading) return <div className="text-center py-16 text-gray-400 animate-pulse">Loading key contacts...</div>;
  if (error)   return <div className="text-center py-16 text-red-500">{error}</div>;

  const approvedCount = contacts.filter(c => c.status === 'approved').length;

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm z-50">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">👤 Key Contact Review</h1>
          {job && (
            <p className="text-gray-400 text-sm mt-0.5">
              {job.config?.queries?.join(', ')} · {job.config?.location}, {job.config?.country}
            </p>
          )}
          {leadIdFilter && (
            <p className="text-xs text-indigo-500 mt-0.5">Filtered to one lead</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Push approved to HubSpot */}
          <button
            onClick={handleBulkPush}
            disabled={actionLoading || approvedCount === 0}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            🚀 Push Approved to HubSpot {approvedCount > 0 ? `(${approvedCount})` : ''}
          </button>
          {/* Export */}
          <button
            onClick={downloadCSV}
            disabled={contacts.length === 0}
            className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 text-emerald-700 border border-emerald-200 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
          >
            ⬇️ Export CSV
          </button>
          {/* Back */}
          <Link
            href={`/approval/${jobId}`}
            className="text-sm text-gray-500 hover:text-gray-800 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors"
          >
            ← Approval Gate
          </Link>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          {([
            ['Total',    stats.total,    'bg-gray-50 text-gray-700'],
            ['Pending',  stats.pending,  'bg-yellow-50 text-yellow-700'],
            ['Approved', stats.approved, 'bg-green-50 text-green-700'],
            ['Rejected', stats.rejected, 'bg-red-50 text-red-700'],
            ['In HubSpot', stats.pushed, 'bg-purple-50 text-purple-700'],
          ] as [string, number, string][]).map(([label, count, cls]) => (
            <div key={label} className={`${cls} rounded-xl p-3 text-center`}>
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs font-medium mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'pending', 'approved', 'rejected', 'pushed'] as StatusFilter[]).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setSelected(new Set()); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'pushed' ? 'In HubSpot' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, title, company, department..."
          className="w-full pl-8 pr-8 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">×</button>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm font-medium text-indigo-800">{selected.size} contact(s) selected</span>
          <div className="flex gap-2">
            <button
              onClick={handleBulkApprove}
              disabled={actionLoading}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {actionLoading ? '...' : '✅ Approve Selected'}
            </button>
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700 px-3">
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {contacts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-semibold text-gray-700 mb-1">No key contacts yet</p>
          <p className="text-sm text-gray-400">
            Contacts are automatically enriched after leads are approved.<br />
            They will appear here once enrichment is complete.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          No contacts matching your search or filter.
        </div>
      ) : (
        <>
          {/* Select all (pending only) */}
          {filter === 'pending' && (
            <div className="flex items-center gap-3 px-1 mb-2">
              <input
                type="checkbox"
                checked={selected.size === filtered.filter(c => c.status === 'pending').length && selected.size > 0}
                onChange={toggleAll}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm text-gray-500">Select all pending</span>
            </div>
          )}

          {/* Contact cards */}
          <div className="space-y-3">
            {filtered.map(contact => {
              const level   = getConfidenceLevel(contact.confidence_score);
              const isPending = contact.status === 'pending';
              const isExpanded = expandedId === contact.id;
              const isSelected = selected.has(contact.id);

              return (
                <div
                  key={contact.id}
                  className={`bg-white rounded-xl border shadow-sm transition-all ${
                    isSelected ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-start gap-4 p-4">
                    {/* Checkbox (pending only) */}
                    {isPending && (
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(contact.id)}
                        className="w-4 h-4 rounded mt-1 flex-shrink-0"
                      />
                    )}

                    {/* Confidence score circle */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border ${
                      CONFIDENCE_COLORS[level] || 'bg-gray-100 text-gray-600 border-gray-200'
                    }`}>
                      {contact.confidence_score}
                    </div>

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      {/* Name + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900">{contact.person_name || '—'}</span>
                        {contact.source_type && (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SOURCE_BADGE[contact.source_type] || 'bg-gray-100 text-gray-500 border border-gray-200'}`}>
                            {SOURCE_LABELS[contact.source_type] || contact.source_type}
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SENIORITY_COLORS[contact.seniority] || 'bg-gray-100 text-gray-500'}`}>
                          {contact.seniority}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${CONFIDENCE_COLORS[level]}`}>
                          {level} confidence
                        </span>
                        {contact.status === 'approved' && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ Approved</span>
                        )}
                        {contact.status === 'rejected' && (
                          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">✗ Rejected</span>
                        )}
                        {contact.status === 'pushed' && (
                          <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">✓ In HubSpot</span>
                        )}
                      </div>

                      {/* Title + company */}
                      <p className="text-sm text-gray-600 mt-0.5">
                        {contact.job_title || 'Unknown Title'}
                        {contact.company_name && <span className="text-gray-400"> · {contact.company_name}</span>}
                      </p>

                      {/* Department + source */}
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gray-400">
                        {contact.department && <span>🏢 {contact.department}</span>}
                        {contact.source_type && <span>{SOURCE_LABELS[contact.source_type] || contact.source_type}</span>}
                        {contact.public_email && <span>✉️ {contact.public_email}</span>}
                        {contact.public_phone && <span>📞 {contact.public_phone}</span>}
                      </div>

                      {/* LinkedIn + source URL */}
                      <div className="flex flex-wrap gap-3 mt-1">
                        {contact.linkedin_url && (
                          <a
                            href={contact.linkedin_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-500 hover:underline"
                          >
                            💼 LinkedIn Profile
                          </a>
                        )}
                        {contact.source_url && contact.source_url !== contact.linkedin_url && (
                          <a
                            href={contact.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-gray-400 hover:text-blue-500"
                          >
                            🔗 Source
                          </a>
                        )}
                      </div>

                      {/* Confidence reason (subtle) */}
                      {contact.confidence_reason && (
                        <p className="text-xs text-gray-300 mt-1 truncate" title={contact.confidence_reason}>
                          {contact.confidence_reason}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : contact.id)}
                        className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors"
                      >
                        {isExpanded ? 'Less ▲' : 'Notes ▼'}
                      </button>

                      {isPending && (
                        <>
                          <button
                            onClick={() => handleApprove(contact.id)}
                            disabled={actionLoading}
                            className="text-xs bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleReject(contact.id)}
                            disabled={actionLoading}
                            className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-medium px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {contact.status === 'approved' && (
                        <button
                          onClick={() => handlePushOne(contact.id)}
                          disabled={actionLoading}
                          className="text-xs bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
                        >
                          🚀 Push
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded — notes */}
                  {isExpanded && (
                    <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                      <label className="text-xs font-medium text-gray-500 mb-1 block">Reviewer Notes</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={noteText[contact.id] || ''}
                          onChange={e => setNoteText(prev => ({ ...prev, [contact.id]: e.target.value }))}
                          placeholder="Add a note about this contact..."
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-8 text-center">
        <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
