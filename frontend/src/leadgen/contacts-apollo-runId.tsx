import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getApolloContacts, getApolloRun, type ApolloContact, type ApolloRun } from '@/services/apolloApi';
import { approveContact, rejectContact, pushContactToHubspot } from '@/lib/api';

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(s: string) {
  if (s === 'approved') return 'bg-green-100 text-green-700';
  if (s === 'rejected') return 'bg-red-100 text-red-600';
  return 'bg-gray-100 text-gray-500';
}

/** Confidence score 0–100 based on available contact fields */
function calcConfidence(c: ApolloContact): number {
  let score = 0;
  if (c.public_email)  score += 40;
  if (c.public_phone)  score += 30;
  if (c.linkedin_url)  score += 20;
  if (c.job_title)     score += 10;
  return score;
}

function confidenceStyle(score: number): { bg: string; color: string; border: string; label: string } {
  if (score >= 80) return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: 'High' };
  if (score >= 50) return { bg: '#fffbeb', color: '#b45309', border: '#fde68a', label: 'Med' };
  return             { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', label: 'Low' };
}

// ── Split stored first_name / last_name; fall back to parsing person_name ─────
function splitName(c: ApolloContact): { first: string; last: string } {
  const fn = c.first_name?.trim() || '';
  const ln = c.last_name?.trim()  || '';
  if (fn || ln) {
    if (fn && !ln && c.person_name) {
      const full = c.person_name.trim();
      if (full.toLowerCase().startsWith(fn.toLowerCase()) && full.length > fn.length)
        return { first: fn, last: full.slice(fn.length).trim() };
    }
    return { first: fn || '—', last: ln };
  }
  if (c.person_name) {
    const parts = c.person_name.trim().split(/\s+/);
    return { first: parts[0] || '—', last: parts.slice(1).join(' ') };
  }
  return { first: '—', last: '' };
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function getRunLabel(run: ApolloRun) {
  const payload = run.search_payload as Record<string, string[]> | null;
  const kw  = payload?.['q_keywords']?.[0];
  const loc = payload?.['organization_locations[]']?.[0];
  if (kw && loc) return `${kw} · ${loc}`;
  if (kw)  return kw;
  if (loc) return loc;
  return 'Apollo Search';
}

function runStatusBadge(status: ApolloRun['status']) {
  switch (status) {
    case 'completed':  return 'bg-green-100 text-green-700';
    case 'processing': return 'bg-amber-100 text-amber-700';
    case 'error':      return 'bg-red-100 text-red-600';
    default:           return 'bg-gray-100 text-gray-500';
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ApolloRunReviewPage() {
  const { runId } = useParams() as { runId: string };

  const [run,        setRun]        = useState<ApolloRun | null>(null);
  const [contacts,   setContacts]   = useState<ApolloContact[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [toast,      setToast]      = useState('');
  // ── Sort & Search ─────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<string>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQ, setSearchQ] = useState('');

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500); }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runRes, contactsRes] = await Promise.all([
        getApolloRun(runId),
        getApolloContacts({ apolloRunId: runId }),
      ]);
      setRun(runRes.run);
      setContacts(contactsRes.contacts || []);
    } catch (e) {
      console.error('Failed to load run:', e);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { load(); }, [load]);

  function updateContact(id: string, patch: Partial<ApolloContact>) {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  async function handleApprove(id: string) {
    setActionBusy(id);
    try { await approveContact(id); updateContact(id, { status: 'approved' }); showToast('✅ Approved'); }
    catch { showToast('Failed'); } finally { setActionBusy(null); }
  }

  async function handleReject(id: string) {
    setActionBusy(id);
    try { await rejectContact(id); updateContact(id, { status: 'rejected' }); showToast('❌ Rejected'); }
    catch { showToast('Failed'); } finally { setActionBusy(null); }
  }

  async function handlePush(id: string) {
    setActionBusy(id);
    try { await pushContactToHubspot(id); updateContact(id, { pushed_to_hubspot: true }); showToast('🚀 Pushed to HubSpot'); }
    catch { showToast('Push failed'); } finally { setActionBusy(null); }
  }

  async function handleBulkApprove() {
    const ids = [...selected];
    if (!ids.length) return;
    setActionBusy('bulk');
    try {
      await Promise.all(ids.map(id => approveContact(id)));
      ids.forEach(id => updateContact(id, { status: 'approved' }));
      showToast(`✅ ${ids.length} approved`);
      setSelected(new Set());
    } catch { showToast('Bulk approve failed'); } finally { setActionBusy(null); }
  }

  async function handlePollStatus() {
    try {
      const res = await getApolloRun(runId);
      setRun(res.run);
      if (res.validContactsFound > 0) {
        await load();
        showToast(`🔄 Refreshed · ${res.validContactsFound} contacts found`);
      } else {
        showToast(`Run: ${res.run.status} · ${res.validContactsFound} contacts so far`);
      }
    } catch { showToast('Poll failed'); }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    const ids = displayContacts.map(c => c.id);
    const allSelected = ids.every(id => selected.has(id));
    setSelected(prev => { const n = new Set(prev); allSelected ? ids.forEach(id => n.delete(id)) : ids.forEach(id => n.add(id)); return n; });
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'score' ? 'desc' : 'asc');
    }
  }

  const displayContacts = useMemo(() => {
    let list = [...contacts];
    // Search filter
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(c =>
        (c.first_name   || '').toLowerCase().includes(q) ||
        (c.last_name    || '').toLowerCase().includes(q) ||
        (c.person_name  || '').toLowerCase().includes(q) ||
        (c.job_title    || '').toLowerCase().includes(q) ||
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.public_email || '').toLowerCase().includes(q) ||
        (c.public_phone || '').toLowerCase().includes(q)
      );
    }
    // Sort
    if (sortKey) {
      list.sort((a, b) => {
        if (sortKey === 'score') {
          const diff = calcConfidence(a) - calcConfidence(b);
          return sortDir === 'asc' ? diff : -diff;
        }
        const getVal = (c: ApolloContact): string => {
          const { first, last } = splitName(c);
          switch (sortKey) {
            case 'first':   return first;
            case 'last':    return last;
            case 'title':   return c.job_title    || '';
            case 'company': return c.company_name || '';
            case 'email':   return c.public_email || '';
            case 'phone':   return c.public_phone || '';
            default:        return '';
          }
        };
        const cmp = getVal(a).toLowerCase().localeCompare(getVal(b).toLowerCase());
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [contacts, searchQ, sortKey, sortDir]);

  const pending  = contacts.filter(c => c.status === 'pending').length;
  const approved = contacts.filter(c => c.status === 'approved').length;
  const pushed   = contacts.filter(c => c.pushed_to_hubspot).length;

  return (
    <div className="w-full py-6 px-2">
      {toast && (
        <div className="fixed top-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm z-50">{toast}</div>
      )}

      {/* Back link */}
      <Link href="/contacts/apollo"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-indigo-600 mb-4 transition-colors">
        ← Back to Apollo Dashboard
      </Link>

      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-3xl mb-2">⏳</p><p>Loading contacts...</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {run ? getRunLabel(run) : 'Apollo Job Review'}
              </h1>
              {run && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {fmtDate(run.created_at)} · Run {runId.slice(0, 8)}…
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {run && (
                <span className={`text-xs font-semibold px-2.5 py-1.5 rounded-full ${runStatusBadge(run.status)}`}>
                  {run.status}
                </span>
              )}
              <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 px-2.5 py-1.5 rounded-full font-semibold">
                {contacts.length} contacts
              </span>
              {contacts.length > 0 && (
                <span className="text-xs bg-teal-50 text-teal-600 px-2.5 py-1.5 rounded-full">
                  ✉️ {contacts.filter(c => c.public_email).length} email · 📞 {contacts.filter(c => c.public_phone).length} phone
                </span>
              )}
              {pending  > 0 && <span className="text-xs bg-gray-100 text-gray-500 px-2.5 py-1.5 rounded-full">{pending} pending</span>}
              {approved > 0 && <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1.5 rounded-full">✅ {approved}</span>}
              {pushed   > 0 && <span className="text-xs bg-purple-100 text-purple-700 px-2.5 py-1.5 rounded-full">🚀 {pushed}</span>}
              <button onClick={handlePollStatus}
                className="text-xs text-gray-400 hover:text-indigo-500 border border-gray-200 px-2.5 py-1.5 rounded-full transition-colors">
                🔄 Poll Status
              </button>
            </div>
          </div>

          {/* Run stats */}
          {run && (
            <div className="grid grid-cols-3 gap-3 mb-5 max-w-lg">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-gray-800">{run.search_count || 0}</p>
                <p className="text-xs text-gray-400">Candidates searched</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-gray-800">{run.enrichment_requested_count || 0}</p>
                <p className="text-xs text-gray-400">Sent for enrichment</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-teal-600">{contacts.length}</p>
                <p className="text-xs text-gray-400">Contacts found</p>
              </div>
            </div>
          )}

          {/* No contacts yet */}
          {contacts.length === 0 ? (
            <div className="text-center py-16 text-gray-400 bg-white border border-gray-200 rounded-xl">
              <p className="text-4xl mb-3">⏳</p>
              <p className="font-medium text-gray-600 mb-1">
                {run?.status === 'processing' ? 'Apollo enrichment in progress…' : 'No contacts found yet'}
              </p>
              <p className="text-sm mb-4">
                {run?.status === 'processing'
                  ? 'Contacts appear here once Apollo finds verified email or phone. Poll status to check.'
                  : 'Contacts with at least an email or phone will appear here once enrichment completes.'}
              </p>
              {run?.status === 'processing' && (
                <button onClick={handlePollStatus}
                  className="text-sm text-amber-600 border border-amber-300 bg-amber-50 hover:bg-amber-100 px-4 py-2 rounded-lg transition-colors">
                  🔄 Check for Results
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Bulk actions */}
              {selected.size > 0 && (
                <div className="flex items-center gap-3 mb-4 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                  <span className="text-sm font-semibold text-indigo-700">{selected.size} selected</span>
                  <button onClick={handleBulkApprove} disabled={actionBusy === 'bulk'}
                    className="text-sm bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-semibold px-4 py-2 rounded-lg transition-colors">
                    ✅ Approve All Selected
                  </button>
                  <button onClick={() => setSelected(new Set())} className="text-sm text-gray-400 hover:text-gray-600 ml-auto">
                    Clear
                  </button>
                </div>
              )}

              {/* Search bar */}
              <div className="flex items-center gap-3 mb-3">
                <div className="relative flex-1 max-w-sm">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">🔍</span>
                  <input
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    placeholder="Search name, email, company, phone…"
                    className="w-full pl-9 pr-8 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                  />
                  {searchQ && (
                    <button onClick={() => setSearchQ('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-bold">✕</button>
                  )}
                </div>
                {searchQ.trim() && (
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {displayContacts.length} of {contacts.length} contacts
                  </span>
                )}
              </div>

              {/* Contacts table */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-3">
                        <input type="checkbox"
                          checked={displayContacts.length > 0 && displayContacts.every(c => selected.has(c.id))}
                          onChange={toggleAll}
                          className="w-4 h-4 rounded accent-indigo-600"/>
                      </th>
                      {([
                        { label: 'First Name', key: 'first'   },
                        { label: 'Last Name',  key: 'last'    },
                        { label: 'Title',      key: 'title'   },
                        { label: 'Company',    key: 'company' },
                        { label: 'Email',      key: 'email'   },
                        { label: 'Phone',      key: 'phone'   },
                        { label: 'Score',      key: 'score'   },
                        { label: 'Actions',    key: null      },
                      ] as { label: string; key: string | null }[]).map(({ label, key }) => (
                        <th key={label}
                          onClick={key ? () => handleSort(key) : undefined}
                          className={`px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap
                            ${key ? 'cursor-pointer select-none hover:bg-gray-100 transition-colors' : ''}`}>
                          {key ? (
                            <span className="inline-flex items-center gap-1">
                              {label}
                              <span className={`text-xs transition-colors ${sortKey === key ? 'text-indigo-500' : 'text-gray-300'}`}>
                                {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                              </span>
                            </span>
                          ) : label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {displayContacts.length === 0 && searchQ.trim() ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">
                          No contacts match &ldquo;{searchQ}&rdquo; — <button onClick={() => setSearchQ('')} className="text-indigo-500 hover:underline">clear search</button>
                        </td>
                      </tr>
                    ) : null}
                    {displayContacts.map(c => {
                      const { first, last } = splitName(c);
                      return (
                      <tr key={c.id} className={`hover:bg-gray-50 transition-colors ${selected.has(c.id) ? 'bg-indigo-50' : ''}`}>
                        <td className="px-3 py-3">
                          <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)}
                            className="w-4 h-4 rounded accent-indigo-600"/>
                        </td>
                        {/* First Name + avatar + LinkedIn */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 text-xs font-bold flex-shrink-0">
                              {(first[0] || '?').toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 text-xs">{first}</p>
                              {c.linkedin_url && (
                                <a href={c.linkedin_url} target="_blank" rel="noreferrer"
                                  className="text-xs text-blue-400 hover:underline">LinkedIn</a>
                              )}
                            </div>
                          </div>
                        </td>
                        {/* Last Name */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <p className="text-xs text-gray-700">{last || '—'}</p>
                        </td>
                        <td className="px-3 py-3 text-gray-600 text-xs max-w-[160px]">{c.job_title || '—'}</td>
                        <td className="px-3 py-3 text-xs">
                          <p className="font-medium text-gray-800">{c.company_name || '—'}</p>
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {c.public_email
                            ? <span className="text-green-700 bg-green-50 border border-green-200 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">✉️ {c.public_email}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {c.public_phone
                            ? <span className="text-blue-700 bg-blue-50 border border-blue-200 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">📞 {c.public_phone}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {(() => {
                            const score = calcConfidence(c);
                            const st = confidenceStyle(score);
                            return (
                              <div className="flex flex-col items-center gap-0.5 w-10">
                                <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                                      style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                                  {score}
                                </span>
                                <span className="text-xs font-medium" style={{ color: st.color }}>{st.label}</span>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-3 min-w-[140px]">
                          <div className="flex flex-col gap-1.5">
                            {c.pushed_to_hubspot ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg">
                                🚀 In HubSpot
                              </span>
                            ) : c.status === 'approved' ? (
                              <>
                                <button onClick={() => handlePush(c.id)} disabled={actionBusy === c.id}
                                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                  {actionBusy === c.id ? '⏳ Pushing…' : '🚀 Push to HubSpot'}
                                </button>
                                <button onClick={() => handleReject(c.id)} disabled={actionBusy === c.id}
                                  className="inline-flex items-center justify-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                  ✕ Reject
                                </button>
                              </>
                            ) : c.status === 'rejected' ? (
                              <button onClick={() => handleApprove(c.id)} disabled={actionBusy === c.id}
                                className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                {actionBusy === c.id ? '⏳…' : '✅ Approve'}
                              </button>
                            ) : (
                              <>
                                <button onClick={() => handleApprove(c.id)} disabled={actionBusy === c.id}
                                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                  {actionBusy === c.id ? '⏳…' : '✅ Approve'}
                                </button>
                                <button onClick={() => handleReject(c.id)} disabled={actionBusy === c.id}
                                  className="inline-flex items-center justify-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                  ✕ Reject
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
