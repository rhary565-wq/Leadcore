import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { getJobs, deleteJob, type Job } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

const ACTIVE_STATUSES = ['pending', 'queued', 'running', 'apollo_enriching', 'contact_fallback', 'cleaning'];

export default function DashboardPage() {
  const [jobs,     setJobs]     = useState<Job[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getJobs();
      setJobs(data);
      setLastSync(new Date());
      setError('');
    } catch {
      setError('Could not reach backend. Check your connection.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this job and all its leads?')) return;
    setDeleting(prev => new Set(prev).add(id));
    try {
      await deleteJob(id);
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch (err: any) {
      alert(err?.message || 'Failed to delete job. Please try again.');
    } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const handleClearStuck = async () => {
    const stuck = jobs.filter(j => j.status === 'pending' || j.status === 'error');
    if (!stuck.length) return;
    if (!confirm(`Delete ${stuck.length} stuck/failed job(s)?`)) return;
    const results = await Promise.allSettled(stuck.map(j => deleteJob(j.id)));
    const deleted = stuck.filter((_, i) => results[i].status === 'fulfilled').map(j => j.id);
    if (deleted.length) setJobs(prev => prev.filter(j => !deleted.includes(j.id)));
  };

  useEffect(() => {
    const hasActive = jobs.some(j => ACTIVE_STATUSES.includes(j.status));
    if (timerRef.current) clearTimeout(timerRef.current);
    if (hasActive) timerRef.current = setTimeout(() => load(true), 8000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [jobs]);

  const hot            = jobs.reduce((s, j) => s + (j.hot_count  || 0), 0);
  const warm           = jobs.reduce((s, j) => s + (j.warm_count || 0), 0);
  const low            = jobs.reduce((s, j) => s + (j.low_count  || 0), 0);
  const needsApproval  = jobs.filter(j => j.status === 'done' && (j.hot_count + j.warm_count) > 0).length;
  const running        = jobs.filter(j => ['running','apollo_enriching','contact_fallback','cleaning'].includes(j.status)).length;

  if (loading) return (
    <div className="animate-fade-in space-y-5">
      <div className="skeleton h-9 w-48"/>
      <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24 rounded-2xl"/>)}</div>
      <div className="skeleton h-64 rounded-2xl"/>
    </div>
  );

  if (error) return (
    <div className="card p-14 text-center animate-fade-in">
      <p className="text-4xl mb-3">⚠️</p>
      <p className="text-red-500 font-semibold">{error}</p>
      <button onClick={() => load()} className="btn-secondary mt-4 mx-auto">↻ Retry</button>
    </div>
  );

  return (
    <div className="animate-fade-in space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Search Jobs</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-gray-400">{jobs.length} total job{jobs.length !== 1 ? 's' : ''}</p>
            {jobs.some(j => ACTIVE_STATUSES.includes(j.status)) && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-100">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse"/>
                Live · auto-refreshing
              </span>
            )}
            {lastSync && !jobs.some(j => ACTIVE_STATUSES.includes(j.status)) && (
              <span className="text-xs text-gray-300">· synced {lastSync.toLocaleTimeString()}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="btn-secondary text-xs">↻ Refresh</button>
          {jobs.some(j => j.status === 'pending' || j.status === 'error') && (
            <button onClick={handleClearStuck}
              className="text-xs bg-red-50 hover:bg-red-100 text-red-600 font-semibold px-3 py-1.5 rounded-xl border border-red-100 transition-colors">
              🗑 Clear Stuck
            </button>
          )}
          <Link href="/" className="btn-primary text-sm px-4 py-2">+ New Search</Link>
        </div>
      </div>

      {/* ── Alert banners ── */}
      {needsApproval > 0 && (
        <div className="flex items-center justify-between rounded-2xl px-5 py-4 animate-slide-in"
             style={{background:'linear-gradient(135deg,#fffbeb,#fef3c7)', border:'1px solid #fde68a'}}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                 style={{background:'#fef9c3', border:'1px solid #fde68a'}}>⚡</div>
            <div>
              <p className="text-sm font-bold text-amber-800">
                {needsApproval} job{needsApproval > 1 ? 's' : ''} awaiting your approval
              </p>
              <p className="text-xs text-amber-600 mt-0.5">Hot &amp; Warm leads ready to review before HubSpot push</p>
            </div>
          </div>
          <Link href="/dashboard"
            className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-4 py-2 rounded-xl transition-colors border border-amber-200">
            View below ↓
          </Link>
        </div>
      )}
      {running > 0 && (
        <div className="flex items-center gap-3 rounded-2xl px-5 py-3.5"
             style={{background:'linear-gradient(135deg,#eff6ff,#dbeafe)', border:'1px solid #bfdbfe'}}>
          <div className="w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin flex-shrink-0"/>
          <p className="text-sm font-semibold text-blue-700">
            {running} job{running > 1 ? 's' : ''} currently running…
          </p>
        </div>
      )}

      {/* ── KPI row 1 ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3" style={{letterSpacing:'.08em'}}>Overview</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPICard icon="📋" label="Total Jobs"    value={jobs.length}  gradient={['#242A56','#3b4a8c']} />
          <KPICard icon="👥" label="Total Leads"   value={hot+warm+low} gradient={['#0891b2','#0e7490']} />
          <KPICard icon="⏳" label="Needs Approval" value={needsApproval} gradient={['#d97706','#b45309']} />
          <KPICard icon="⚙️" label="Running Now"   value={running}      gradient={['#2563eb','#1d4ed8']} />
        </div>
      </div>

      {/* ── KPI row 2 ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3" style={{letterSpacing:'.08em'}}>Lead Quality</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPICard icon="🔥" label="Hot Leads"  value={hot}  gradient={['#dc2626','#b91c1c']} sub="score ≥ 70" />
          <KPICard icon="🌤" label="Warm Leads" value={warm} gradient={['#ea580c','#c2410c']} sub="score ≥ 40" />
          <KPICard icon="❄️" label="Low Leads"  value={low}  gradient={['#475569','#334155']} sub="score < 40" />
          <KPICard icon="✅" label="Approved"   value={0}    gradient={['#059669','#047857']} sub="in HubSpot" />
        </div>
      </div>

      {/* ── Jobs table ── */}
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3" style={{letterSpacing:'.08em'}}>Recent Jobs</p>
        {jobs.length === 0 ? (
          <div className="card p-16 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4"
                 style={{background:'linear-gradient(135deg,#eef2ff,#f5f3ff)', border:'1px solid #e0e7ff'}}>🎯</div>
            <p className="text-gray-800 font-bold text-lg">No jobs yet</p>
            <p className="text-gray-400 text-sm mt-1.5 mb-6 max-w-xs mx-auto">
              Launch your first scrape to start generating qualified leads for HubSpot.
            </p>
            <Link href="/" className="btn-primary mx-auto inline-flex">🚀 Launch First Job</Link>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{background:'#fafafa', borderBottom:'1px solid #f1f5f9'}}>
                    {['Job', 'Location', 'Status', '🔥 Hot', '🌤 Warm', '❄️ Low', 'Launched', 'Actions'].map(h => (
                      <th key={h} className={`px-4 py-3.5 font-bold text-gray-500 uppercase tracking-wider ${
                        ['🔥 Hot','🌤 Warm','❄️ Low'].includes(h) ? 'text-center' : 'text-left'
                      }`} style={{letterSpacing:'.05em', fontSize:'10px'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job, idx) => {
                    const canApprove = job.status === 'done' && (job.hot_count + job.warm_count) > 0;
                    return (
                      <tr key={job.id}
                        className="transition-colors hover:bg-slate-50/70 group"
                        style={{borderTop: idx > 0 ? '1px solid #f8fafc' : 'none'}}>
                        <td className="px-4 py-3.5">
                          <p className="font-bold text-gray-800 truncate max-w-[160px]">
                            {job.config?.queries?.slice(0, 2).join(', ') || '—'}
                          </p>
                          <p className="text-gray-400 font-mono text-xs mt-0.5">{job.id.slice(0, 8)}…</p>
                        </td>
                        <td className="px-4 py-3.5 text-gray-500">
                          {[job.config?.subDistrict, job.config?.district, job.config?.province || job.config?.location].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3.5"><StatusBadge status={job.status}/></td>
                        <td className="px-4 py-3.5 text-center">
                          {job.hot_count > 0
                            ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold text-red-600 bg-red-50 border border-red-100">{job.hot_count}</span>
                            : <span className="text-gray-200 font-bold">0</span>}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {job.warm_count > 0
                            ? <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg text-xs font-bold text-orange-600 bg-orange-50 border border-orange-100">{job.warm_count}</span>
                            : <span className="text-gray-200 font-bold">0</span>}
                        </td>
                        <td className="px-4 py-3.5 text-center text-gray-400 font-medium">{job.low_count || 0}</td>
                        <td className="px-4 py-3.5 text-gray-400">{new Date(job.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-2">
                            <Link href={`/jobs/${job.id}`}
                              className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
                              View
                            </Link>
                            {canApprove && (
                              <Link href={`/approval/${job.id}`} className="btn-success py-1 px-2.5 text-xs">
                                Approve →
                              </Link>
                            )}
                            <button
                              onClick={() => handleDelete(job.id)}
                              disabled={deleting.has(job.id)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                              title="Delete job">
                              {deleting.has(job.id) ? '…' : '🗑'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function KPICard({ icon, label, value, gradient, sub }: {
  icon: string; label: string; value: number;
  gradient: [string, string]; sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 transition-all duration-200 hover:shadow-md hover:border-gray-200 group"
         style={{boxShadow:'0 1px 3px rgb(0 0 0/.04)'}}>
      <div className="flex items-center justify-between mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg transition-transform duration-200 group-hover:scale-110"
             style={{background:`linear-gradient(135deg,${gradient[0]}18,${gradient[1]}28)`,
                     border:`1px solid ${gradient[0]}22`}}>
          {icon}
        </div>
      </div>
      <p className="text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
      <p className="text-xs font-semibold text-gray-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}
