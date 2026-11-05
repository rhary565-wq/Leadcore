import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getJob, getJobContactStats, createJob, type Job } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';

interface ContactStats {
  totalLeads: number; apollo: number; fallback: number; total: number;
  apolloLeads: number; fallbackLeads: number;
}

const PIPELINE_BASE = [
  { key:'queued',           label:'Queued',                      icon:'⏳', desc:'Job is waiting to start',                                         color:'bg-slate-100',  apolloOnly:false },
  { key:'running',          label:'Google Maps Search',          icon:'🗺️', desc:'Scanning Google Maps for business listings',                      color:'bg-blue-100',   apolloOnly:false },
  { key:'apollo_enriching', label:'Apollo Enrichment',           icon:'🔬', desc:'Finding B2B contacts via Apollo.io',                              color:'bg-indigo-100', apolloOnly:true  },
  { key:'contact_fallback', label:'Fallback Contact Search',     icon:'🔍', desc:'Searching LinkedIn & Facebook for companies Apollo couldn\'t find', color:'bg-amber-100',  apolloOnly:true  },
  { key:'cleaning',         label:'Cleaning & Scoring',          icon:'🧠', desc:'Deduplicating, validating and scoring leads',                     color:'bg-purple-100', apolloOnly:false },
  { key:'done',             label:'Ready for Approval',          icon:'✅', desc:'Leads + contacts ready to review',                                color:'bg-emerald-100',apolloOnly:false },
];
// Build step index dynamically so indices align correctly whether Apollo is on or off.
// 'enriching' is an internal Apify sub-phase — stays on Google Maps Search step.

export default function JobStatusPage() {
  const { id }                           = useParams<{ id:string }>();
  const router                           = useRouter();
  const [job, setJob]                    = useState<Job|null>(null);
  const [error, setErr]                  = useState('');
  const [retrying, setRetrying]          = useState(false);
  const [contactStats, setContactStats]  = useState<ContactStats|null>(null);

  async function handleRetry() {
    if (!job) return;
    setRetrying(true);
    try {
      const newJob = await createJob(job.config);
      router.push(`/jobs/${newJob.jobId}`);
    } catch {
      setErr('Failed to retry. Please try launching from the Launch page.');
      setRetrying(false);
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await getJob(id);
        setJob(data);
        if (data.status === 'done' || data.status === 'error') {
          // Job finished — fetch contact breakdown once
          if (data.config?.apolloEnabled) {
            getJobContactStats(id).then(setContactStats).catch(() => {});
          }
        } else {
          timer = setTimeout(poll, 5000);
        }
      } catch { setErr('Could not load job.'); }
    }
    poll();
    return () => clearTimeout(timer);
  }, [id]);

  if (error) return <div className="card p-10 text-center text-red-500">{error}</div>;
  if (!job)  return (
    <div className="space-y-4 animate-pulse">
      <div className="skeleton h-8 w-48"/>
      <div className="skeleton h-48 rounded-xl"/>
    </div>
  );

  const apolloEnabled = job.config?.apolloEnabled;
  const PIPELINE      = PIPELINE_BASE.filter(s => !s.apolloOnly || apolloEnabled);

  // Map each pipeline step key → its array index (changes if Apollo step is filtered out)
  const stepMap: Record<string,number> = {};
  PIPELINE.forEach((s, i) => { stepMap[s.key] = i; });

  // 'enriching' is an internal Apify phase — treat as same step as 'running'
  // 'contact_fallback' is in stepMap directly so it resolves to its own step index
  const step = job.status === 'enriching'
    ? (stepMap['running'] ?? 1)
    : (stepMap[job.status] ?? 0);

  const isError = job.status === 'error';
  const isDone  = job.status === 'done';

  return (
    <div className="animate-fade-in max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">📋 Job Progress</h1>
          <p className="font-mono text-xs text-gray-400 mt-0.5">{job.id}</p>
        </div>
        <StatusBadge status={job.status} size="md"/>
      </div>

      {/* Pipeline */}
      <div className="card overflow-hidden">
        {PIPELINE.map((stage, i) => {
          const done   = i < step;
          const active = i === step && !isError;
          const future = i > step;

          // Build a meaningful "done" label for Apollo steps using real contact stats
          let doneLabel = <span className="text-xs text-emerald-600 font-medium">Done</span>;
          if (done && contactStats) {
            if (stage.key === 'apollo_enriching') {
              const { apolloLeads, totalLeads, apollo } = contactStats;
              if (apollo === 0) {
                doneLabel = <span className="text-xs text-red-400 font-medium">0 found</span>;
              } else if (apolloLeads < totalLeads) {
                doneLabel = (
                  <span className="text-xs font-medium text-amber-600">
                    {apolloLeads}/{totalLeads} <span className="text-gray-400 font-normal">co · {apollo} contacts</span>
                  </span>
                );
              } else {
                doneLabel = (
                  <span className="text-xs font-medium text-emerald-600">
                    {apolloLeads}/{totalLeads} <span className="text-gray-400 font-normal">co · {apollo} contacts</span>
                  </span>
                );
              }
            } else if (stage.key === 'contact_fallback') {
              const { fallbackLeads, fallback } = contactStats;
              if (fallback === 0) {
                doneLabel = <span className="text-xs text-gray-400 font-medium">None found</span>;
              } else {
                doneLabel = (
                  <span className="text-xs font-medium text-emerald-600">
                    {fallbackLeads} <span className="text-gray-400 font-normal">co · {fallback} contacts</span>
                  </span>
                );
              }
            }
          }

          return (
            <div key={stage.key} className={`flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-0 transition-colors ${active?'bg-blue-50':done?'bg-emerald-50':''}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${done?'bg-emerald-100':active?stage.color:'bg-gray-100'}`}>
                {done ? '✅' : stage.icon}
              </div>
              <div className="flex-1">
                <p className={`text-sm font-semibold ${done?'text-emerald-700':active?'text-blue-700':future?'text-gray-300':'text-gray-700'}`}>{stage.label}</p>
                <p className="text-xs text-gray-400">{stage.desc}</p>
              </div>
              {active && (
                <div className="flex gap-1">
                  {[0,150,300].map(d => (
                    <span key={d} style={{animationDelay:`${d}ms`}} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"/>
                  ))}
                </div>
              )}
              {done  && doneLabel}
              {future && <span className="text-xs text-gray-300">Pending</span>}
            </div>
          );
        })}
      </div>

      {/* Error */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-red-700 font-semibold">❌ This job encountered an error. The pipeline stopped unexpectedly.</p>
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="flex-shrink-0 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {retrying ? '⏳ Retrying...' : '↺ Retry Job'}
            </button>
          </div>
          {job.last_error && (
            <p className="text-xs text-red-600 font-mono bg-red-100 rounded-lg px-3 py-2 break-all">
              {job.last_error}
            </p>
          )}
        </div>
      )}

      {/* Stats */}
      {(job.total_records > 0 || isDone) && (
        <div className="card p-5">
          <h2 className="section-title">📊 Results</h2>
          {/* Hot/Warm/Low are only real after the clean step finishes (step ≥ 4 or done).
              Until then show — so the zeros don't look like actual scoring results. */}
          {(() => {
            const scoringDone = isDone || step > (stepMap['cleaning'] ?? 99);
            return (
              <div className="grid grid-cols-4 gap-3 text-center">
                <div className="bg-gray-50 rounded-xl py-3">
                  <p className="text-2xl font-bold text-gray-700">{job.total_records || 0}</p>
                  <p className="text-xs text-gray-400 mt-1">Total Found</p>
                </div>
                {[
                  { l:'🔥 Hot',  v:job.hot_count,  c:'text-red-500'   },
                  { l:'🌤 Warm', v:job.warm_count, c:'text-orange-500' },
                  { l:'❄️ Low',  v:job.low_count,  c:'text-gray-400'  },
                ].map(s => (
                  <div key={s.l} className="bg-gray-50 rounded-xl py-3">
                    {scoringDone
                      ? <p className={`text-2xl font-bold ${s.c}`}>{s.v || 0}</p>
                      : <p className="text-2xl font-bold text-gray-300">—</p>}
                    <p className="text-xs text-gray-400 mt-1">{s.l}</p>
                  </div>
                ))}
              </div>
            );
          })()}
          {!isDone && step <= (stepMap['cleaning'] ?? 99) && (
            <p className="text-xs text-gray-400 text-center mt-2 animate-pulse">
              ⏳ Scoring in progress — Hot / Warm / Low will appear after the Cleaning step
            </p>
          )}
        </div>
      )}

      {/* Config */}
      <div className="card p-5">
        <h2 className="section-title">⚙️ Configuration</h2>
        {(() => {
          const cfg = job.config;
          const fmtN = (n: number) => n >= 1000 ? `${(n/1000).toFixed(n%1000===0?0:1)}K` : String(n);
          const rows: [string, string][] = [
            ['Queries',      cfg.queries?.join(', ') || '—'],
            ['Location',     cfg.province ? (cfg.province === 'All Thailand' ? '🇹🇭 All Thailand' : `${cfg.province}, Thailand`) : `${cfg.location}, ${cfg.country}`],
            ['Industry',     cfg.industryFilter || 'Any Industry'],
            ['Max Results',  cfg.maxResults != null ? fmtN(cfg.maxResults) : '100'],
            ['Apollo',       cfg.apolloEnabled ? '🔬 Enabled' : '— Disabled'],
            ['Max Contacts', cfg.apolloEnabled && cfg.maxContacts != null ? fmtN(cfg.maxContacts) : '—'],
            ['Auto Submit',  cfg.autoApprove ? '⚡ Enabled' : '— Manual'],
            ['Launched By',  cfg.createdBy || '—'],
            ['Started',      new Date(job.created_at).toLocaleString()],
          ];
          return (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {rows.map(([l, v]) => (
                <div key={l} className="flex gap-2">
                  <dt className="text-gray-400 w-28 flex-shrink-0">{l}</dt>
                  <dd className={`font-medium truncate ${l==='Auto Submit'&&cfg.autoApprove?'text-emerald-600':l==='Apollo'&&cfg.apolloEnabled?'text-indigo-600':'text-gray-700'}`}>{v}</dd>
                </div>
              ))}
            </dl>
          );
        })()}
      </div>

      {/* CTA */}
      {isDone && (job.hot_count+job.warm_count) > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-emerald-800">✅ Leads are ready!</p>
            <p className="text-sm text-emerald-600">{job.hot_count+job.warm_count} Hot+Warm leads waiting for approval before HubSpot push.</p>
          </div>
          <Link href={`/approval/${job.id}`} className="btn-success ml-4 whitespace-nowrap">Review Leads →</Link>
        </div>
      )}
      {isDone && (job.hot_count+job.warm_count) === 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-sm text-gray-500">
          No Hot or Warm leads found. Try broader queries or a different location.
        </div>
      )}
      {!isDone && !isError && (
        <p className="text-center text-xs text-gray-400 animate-pulse">Auto-refreshing every 5 seconds...</p>
      )}
      <div className="text-center">
        <Link href="/dashboard" className="text-xs text-indigo-600 hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}
