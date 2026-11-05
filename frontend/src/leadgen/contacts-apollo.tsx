import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  getApolloRuns,
  getApolloRun,
  cancelApolloRun,
  cancelAllStuckRuns,
  deleteApolloRun,
  retryApolloRun,
  type ApolloRun,
} from '@/services/apolloApi';

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusConfig(status: ApolloRun['status']) {
  switch (status) {
    case 'completed':  return { dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700',   label: 'Completed'  };
    case 'processing': return { dot: 'bg-amber-400 animate-pulse', badge: 'bg-amber-100 text-amber-700', label: 'Processing' };
    case 'created':    return { dot: 'bg-blue-400',   badge: 'bg-blue-100 text-blue-700',    label: 'Created'    };
    case 'error':      return { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-600',      label: '⚠ Failed / Timed Out' };
    case 'cancelled':  return { dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-500',    label: 'Cancelled'  };
    default:           return { dot: 'bg-gray-400',   badge: 'bg-gray-100 text-gray-500',    label: status       };
  }
}

function getRunLabel(run: ApolloRun) {
  const payload = run.search_payload as Record<string, string[]> | null;
  const kw  = payload?.['q_keywords']?.[0];
  const loc = payload?.['organization_locations[]']?.[0];
  if (kw && loc) return `${kw} · ${loc}`;
  if (kw)  return kw;
  if (loc) return loc;
  return `Apollo Search`;
}

// ── Confirm dialog (inline, no external lib) ──────────────────────────────────
function ConfirmDialog({
  title, body, confirmLabel, danger, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
        <h2 className="text-base font-bold text-gray-900 mb-1">{title}</h2>
        <p className="text-sm text-gray-500 mb-5">{body}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="text-sm px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
            Keep
          </button>
          <button
            onClick={onConfirm}
            className={`text-sm px-4 py-2 rounded-lg font-semibold text-white transition-colors ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ApolloDashboardPage() {
  const [runs,       setRuns]       = useState<ApolloRun[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [toast,      setToast]      = useState('');
  const [toastType,  setToastType]  = useState<'ok' | 'err'>('ok');
  const [pollingId,   setPollingId]   = useState<string | null>(null);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [deletingId,  setDeletingId]  = useState<string | null>(null);
  const [retryingId,  setRetryingId]  = useState<string | null>(null);
  const [busyAll,     setBusyAll]     = useState(false);

  // Confirm dialog state
  const [confirm, setConfirm] = useState<null | {
    title: string; body: string; label: string; danger?: boolean; onOk: () => void;
  }>(null);

  function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(''), 3800);
  }

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getApolloRuns();
      setRuns(res.runs || []);
    } catch {
      showToast('Failed to load Apollo jobs', 'err');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  // ── Poll status ───────────────────────────────────────────────────────────
  async function handlePollRun(runId: string) {
    setPollingId(runId);
    try {
      const res = await getApolloRun(runId);
      const s = res.run?.status;
      const c = res.validContactsFound || 0;
      showToast(`Run ${runId.slice(0, 6)}… → ${s} · ${c} contacts`);
      setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: s, valid_contacts_count: c } : r));
    } catch {
      showToast('Poll failed', 'err');
    } finally {
      setPollingId(null);
    }
  }

  // ── Cancel single run ─────────────────────────────────────────────────────
  function promptCancelRun(run: ApolloRun) {
    setConfirm({
      title: 'Cancel this job?',
      body: `"${getRunLabel(run)}" is still processing. This will mark it as cancelled — any contacts already found are kept.`,
      label: 'Cancel job',
      danger: false,
      onOk: () => { setConfirm(null); doCancelRun(run.id); },
    });
  }

  async function doCancelRun(runId: string) {
    setCancelingId(runId);
    try {
      await cancelApolloRun(runId);
      showToast('Job cancelled');
      setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: 'cancelled' } : r));
    } catch {
      showToast('Cancel failed', 'err');
    } finally {
      setCancelingId(null);
    }
  }

  // ── Cancel ALL stuck runs ─────────────────────────────────────────────────
  function promptCancelAll() {
    const stuckCount = runs.filter(r => r.status === 'processing' || r.status === 'created').length;
    if (stuckCount === 0) { showToast('No stuck jobs to cancel'); return; }
    setConfirm({
      title: `Cancel ${stuckCount} stuck job${stuckCount > 1 ? 's' : ''}?`,
      body: 'All currently processing or created jobs will be marked as cancelled. Contacts already found are kept.',
      label: `Cancel ${stuckCount} job${stuckCount > 1 ? 's' : ''}`,
      danger: false,
      onOk: () => { setConfirm(null); doCancelAll(); },
    });
  }

  async function doCancelAll() {
    setBusyAll(true);
    try {
      const res = await cancelAllStuckRuns();
      showToast(`${res.cancelledCount} job${res.cancelledCount !== 1 ? 's' : ''} cancelled`);
      setRuns(prev => prev.map(r =>
        (r.status === 'processing' || r.status === 'created') ? { ...r, status: 'cancelled' } : r
      ));
    } catch {
      showToast('Cancel all failed', 'err');
    } finally {
      setBusyAll(false);
    }
  }

  // ── Delete single run ─────────────────────────────────────────────────────
  function promptDeleteRun(run: ApolloRun) {
    setConfirm({
      title: 'Delete this Apollo job?',
      body: `"${getRunLabel(run)}" will be removed from the dashboard. Contacts already saved are preserved.`,
      label: 'Delete',
      danger: true,
      onOk: () => { setConfirm(null); doDeleteRun(run.id); },
    });
  }

  async function doDeleteRun(runId: string) {
    setDeletingId(runId);
    try {
      await deleteApolloRun(runId);
      showToast('Job deleted');
      setRuns(prev => prev.filter(r => r.id !== runId));
    } catch (err: any) {
      showToast(err?.message || 'Delete failed', 'err');
    } finally {
      setDeletingId(null);
    }
  }

  // ── Retry failed / cancelled run ──────────────────────────────────────────
  async function doRetryRun(runId: string) {
    setRetryingId(runId);
    try {
      const result = await retryApolloRun(runId);
      if (result.status === 'processing') {
        showToast(`Retry started — ${result.searchedCount || 0} candidates sent for enrichment`);
        setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: 'processing' as ApolloRun['status'], error_message: null } : r));
      } else {
        showToast(result.message || 'Retry complete — no results found');
        setRuns(prev => prev.map(r => r.id === runId ? { ...r, status: 'completed' as ApolloRun['status'] } : r));
      }
    } catch (err: any) {
      showToast(err?.message || 'Retry failed', 'err');
    } finally {
      setRetryingId(null);
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  const stuckCount = runs.filter(r => r.status === 'processing' || r.status === 'created').length;
  const completed  = runs.filter(r => r.status === 'completed').length;
  const totalValid = runs.reduce((n, r) => n + (r.valid_contacts_count || 0), 0);

  return (
    <div className="max-w-4xl mx-auto py-6 px-4">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm z-50 text-white transition-opacity ${
          toastType === 'err' ? 'bg-red-600' : 'bg-gray-900'
        }`}>
          {toast}
        </div>
      )}

      {/* Confirm dialog */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.label}
          danger={confirm.danger}
          onConfirm={confirm.onOk}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🔬 Apollo Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Apollo jobs &amp; stats · email + phone verified contacts only</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          {stuckCount > 0 && (
            <button
              onClick={promptCancelAll}
              disabled={busyAll}
              className="text-sm font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
              {busyAll ? '⏳ Cancelling…' : `⏹ Cancel ${stuckCount} stuck`}
            </button>
          )}
          <Link
            href="/apollo"
            className="flex items-center gap-1.5 text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-4 py-2 rounded-lg transition-colors">
            + New Apollo Search
          </Link>
          <button
            onClick={loadRuns}
            className="text-sm text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 px-3 py-2 rounded-lg transition-colors">
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900">{runs.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">Total runs</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{stuckCount}</p>
          <p className="text-xs text-gray-400 mt-0.5">Still running</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{completed}</p>
          <p className="text-xs text-gray-400 mt-0.5">Completed</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-teal-600">{totalValid}</p>
          <p className="text-xs text-gray-400 mt-0.5">Verified contacts</p>
        </div>
      </div>

      {/* Runs list */}
      {loading ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">⏳</p>
          <p>Loading Apollo jobs...</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🔬</p>
          <p className="font-medium text-gray-600 mb-1">No Apollo searches yet</p>
          <p className="text-sm mb-5">Run an Apollo search to find contacts with verified email + phone</p>
          <Link href="/apollo" className="inline-block text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2.5 rounded-lg transition-colors">
            + New Apollo Search
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map(run => {
            const sc         = statusConfig(run.status);
            const label      = getRunLabel(run);
            const isPolling   = pollingId   === run.id;
            const isCanceling = cancelingId === run.id;
            const isDeleting  = deletingId  === run.id;
            const isRetrying  = retryingId  === run.id;
            const isStuck     = run.status === 'processing' || run.status === 'created';
            const isFailed    = run.status === 'error' || run.status === 'cancelled';

            return (
              <div
                key={run.id}
                className={`bg-white border rounded-xl p-4 transition-all ${
                  isDeleting ? 'opacity-40 scale-95' : 'hover:border-indigo-200 hover:shadow-sm border-gray-200'
                }`}>
                <div className="flex items-start justify-between gap-3">

                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`}/>
                      <p className="font-semibold text-gray-900 truncate">{label}</p>
                    </div>
                    <p className="text-xs text-gray-400 mb-2">{fmtDate(run.created_at)}</p>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sc.badge}`}>
                        {sc.label}
                      </span>
                      <span className="text-xs bg-gray-50 text-gray-500 border border-gray-100 px-2.5 py-1 rounded-full">
                        🔍 {run.search_count || 0} searched
                      </span>
                      <span className="text-xs bg-gray-50 text-gray-500 border border-gray-100 px-2.5 py-1 rounded-full">
                        ⚡ {run.enrichment_requested_count || 0} enriched
                      </span>
                      {(run.valid_contacts_count || 0) > 0 && (
                        <span className="text-xs bg-teal-50 text-teal-700 border border-teal-100 px-2.5 py-1 rounded-full font-semibold">
                          ✉️+📞 {run.valid_contacts_count} contacts
                        </span>
                      )}
                      {isStuck && (
                        <span className="text-xs bg-amber-50 text-amber-600 px-2.5 py-1 rounded-full animate-pulse">
                          Enrichment in progress…
                        </span>
                      )}
                    </div>
                    {/* Show error message for failed/timed-out runs */}
                    {run.status === 'error' && (run as ApolloRun & { error_message?: string }).error_message && (
                      <p className="text-xs text-red-500 mt-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2 max-w-lg">
                        ⚠ {(run as ApolloRun & { error_message?: string }).error_message}
                      </p>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {/* View button — show for completed or any run with contacts */}
                    <Link
                      href={`/contacts/apollo/${run.id}`}
                      className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
                      View / Approve →
                    </Link>

                    <div className="flex items-center gap-1.5">
                      {/* Cancel — only for stuck runs */}
                      {isStuck && (
                        <button
                          onClick={() => promptCancelRun(run)}
                          disabled={isCanceling}
                          className="text-xs text-amber-600 hover:text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors">
                          {isCanceling ? '⏳…' : '⏹ Cancel'}
                        </button>
                      )}

                      {/* Poll — useful for processing runs */}
                      {isStuck && (
                        <button
                          onClick={() => handlePollRun(run.id)}
                          disabled={isPolling}
                          className="text-xs text-gray-400 hover:text-indigo-500 border border-gray-200 bg-white px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors">
                          {isPolling ? '⏳…' : '🔄 Poll'}
                        </button>
                      )}

                      {/* Retry — for failed or cancelled runs */}
                      {isFailed && (
                        <button
                          onClick={() => doRetryRun(run.id)}
                          disabled={isRetrying}
                          className="text-xs text-green-700 hover:text-green-800 border border-green-200 bg-green-50 hover:bg-green-100 px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors font-medium">
                          {isRetrying ? '⏳ Retrying…' : '🔁 Retry'}
                        </button>
                      )}

                      {/* Delete — always available */}
                      <button
                        onClick={() => promptDeleteRun(run)}
                        disabled={isDeleting}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-100 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg disabled:opacity-50 transition-colors">
                        {isDeleting ? '⏳…' : '🗑 Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
