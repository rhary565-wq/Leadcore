import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  approveContact, rejectContact, pushContactToHubspot,
  bulkApproveContacts,
} from '@/lib/api';
import {
  startApolloSearch, getApolloContacts, getApolloRun,
  type ApolloContact, type ApolloSearchFilters,
} from '@/services/apolloApi';

// ── Confidence score ─────────────────────────────────────────────────────────
function calcConfidence(c: ApolloContact): number {
  let s = 0;
  if (c.public_email) s += 40;
  if (c.public_phone) s += 30;
  if (c.linkedin_url) s += 20;
  if (c.job_title)    s += 10;
  return s;
}
function confStyle(score: number) {
  if (score >= 80) return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: 'High' };
  if (score >= 50) return { bg: '#fffbeb', color: '#b45309', border: '#fde68a', label: 'Med'  };
  return             { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', label: 'Low'  };
}

// ── Split stored first_name / last_name; fall back to parsing person_name ─────
function splitName(c: ApolloContact): { first: string; last: string } {
  const fn = c.first_name?.trim() || '';
  const ln = c.last_name?.trim()  || '';
  if (fn || ln) {
    // If last_name missing but person_name has more words, extract the rest
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

// ── Option lists ─────────────────────────────────────────────────────────────
const INDUSTRIES = [
  'Any Industry','Health & Medical','Restaurant & Food','Retail & Shopping',
  'Beauty & Spa','Hotel & Travel','Education','Finance & Banking','Real Estate',
  'Construction','Manufacturing','Logistics & Transport','Technology & IT',
  'Law & Legal','Marketing & Advertising','Auto & Vehicles','Gym & Fitness','Entertainment',
];

const SENIORITY_OPTIONS = [
  { value: 'Owner',     label: 'Owner'             },
  { value: 'Founder',   label: 'Founder'           },
  { value: 'C-Suite',   label: 'C-Suite (CEO/COO)' },
  { value: 'VP',        label: 'VP'                },
  { value: 'Director',  label: 'Director'          },
  { value: 'Manager',   label: 'Manager'           },
  { value: 'Head of',   label: 'Head of'           },
  { value: 'Senior',    label: 'Senior'            },
];

const DEPARTMENT_OPTIONS = [
  { value: 'Sales',      label: '💼 Sales'      },
  { value: 'Marketing',  label: '📣 Marketing'  },
  { value: 'Operations', label: '⚙️ Operations' },
  { value: 'Finance',    label: '💰 Finance'    },
  { value: 'IT / Tech',  label: '💻 IT / Tech'  },
  { value: 'HR',         label: '👥 HR'         },
];

const COMPANY_SIZE_OPTIONS = [
  { value: '1-10',    label: '1–10 (Micro)'        },
  { value: '11-50',   label: '11–50 (Small)'        },
  { value: '51-200',  label: '51–200 (Medium)'      },
  { value: '201-500', label: '201–500 (Mid-Market)' },
  { value: '501-1000',label: '501–1000 (Large)'     },
  { value: '1001+',   label: '1001+ (Enterprise)'   },
];

// ── Poll config ───────────────────────────────────────────────────────────────
// Poll every 10s. Stop after 8 minutes = 48 attempts.
const POLL_INTERVAL_MS  = 10_000;
const POLL_MAX_ATTEMPTS = 48;       // 8 minutes max before frontend timeout
const TIMEOUT_MS        = POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS;
const LS_KEY = 'apollo_active_run';

type RunStatus = 'idle' | 'searching' | 'processing' | 'completed' | 'failed';

type SavedRun = {
  apolloRunId:              string;
  searchedCount:            number;
  enrichmentRequestedCount: number;
  startedAt:                number;
};

export default function ApolloPage() {
  // ── Filter state ──────────────────────────────────────────────────────────
  const [location,       setLocation]       = useState('Bangkok');
  const [country,        setCountry]        = useState('Thailand');
  const [industry,       setIndustry]       = useState('Any Industry');
  const [customIndustry, setCustomIndustry] = useState('');
  const [companySearch,  setCompanySearch]  = useState('');
  const [seniority,      setSeniority]      = useState<string[]>(['Owner','Founder','C-Suite','VP','Director','Head of','Manager']);
  const [anyContact,     setAnyContact]     = useState(true);
  const [department,     setDepartment]     = useState<string[]>([]);
  const [companySizes,   setCompanySizes]   = useState<string[]>([]);
  const [resultsLimit,   setResultsLimit]   = useState(100);

  // ── Run state ─────────────────────────────────────────────────────────────
  const [runStatus,                setRunStatus]                = useState<RunStatus>('idle');
  const [apolloRunId,              setApolloRunId]              = useState<string|null>(null);
  const [searchedCount,            setSearchedCount]            = useState(0);
  const [enrichmentRequestedCount, setEnrichmentRequestedCount] = useState(0);
  const [pollCount,                setPollCount]                = useState(0);
  const [elapsedMs,                setElapsedMs]                = useState(0);
  const [contacts,                 setContacts]                 = useState<ApolloContact[]>([]);
  const [error,                    setError]                    = useState('');
  const [failureReason,            setFailureReason]            = useState('');

  // ── Actions state ─────────────────────────────────────────────────────────
  const [selected,    setSelected]   = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState<string|null>(null);
  const [toast,       setToast]      = useState('');
  // ── Sort & Search ─────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<string>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQ, setSearchQ] = useState('');

  const pollRef      = useRef<ReturnType<typeof setInterval>|null>(null);
  const startTimeRef = useRef<number>(0);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3500); }

  // ── localStorage ─────────────────────────────────────────────────────────
  function saveRun(runId: string, searched: number, enriched: number) {
    localStorage.setItem(LS_KEY, JSON.stringify({
      apolloRunId: runId, searchedCount: searched,
      enrichmentRequestedCount: enriched, startedAt: Date.now(),
    } as SavedRun));
  }
  function clearSavedRun() { localStorage.removeItem(LS_KEY); }

  // ── Stop polling ─────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // ── Core poll function — checks RUN STATUS first, then contacts ───────────
  const pollForResults = useCallback(async (runId: string, attempt: number) => {
    const elapsed = Date.now() - startTimeRef.current;
    setElapsedMs(elapsed);

    try {
      // 1. Check run status from backend (auto-timeout logic also runs here)
      const runRes = await getApolloRun(runId);
      const run    = runRes.run;

      // Backend marked as error (includes auto-timeout after 10 min)
      if (run.status === 'error') {
        setRunStatus('failed');
        setFailureReason(run.error_message || 'Apollo enrichment failed — webhook was not received.');
        stopPolling();
        clearSavedRun();
        return;
      }

      // Backend marked as cancelled
      if (run.status === 'cancelled') {
        setRunStatus('failed');
        setFailureReason('This Apollo search was cancelled.');
        stopPolling();
        clearSavedRun();
        return;
      }

      // Results have arrived via webhook
      if (runRes.validContactsFound > 0) {
        const contactRes = await getApolloContacts({ apolloRunId: runId });
        if (contactRes.contacts.length > 0) {
          setContacts(contactRes.contacts);
          setRunStatus('completed');
          stopPolling();
          clearSavedRun();
          return;
        }
      }

      // Apollo completed but found 0 contacts with email+phone
      if (run.status === 'completed') {
        setRunStatus('completed');
        stopPolling();
        clearSavedRun();
        return;
      }

    } catch { /* ignore transient network errors — will retry next poll */ }

    // Frontend hard timeout after 8 minutes
    if (attempt >= POLL_MAX_ATTEMPTS) {
      setRunStatus('failed');
      setFailureReason(
        'Enrichment timed out after 8 minutes with no results from Apollo. ' +
        'This usually means the backend webhook URL is misconfigured. ' +
        'Check the Apollo Dashboard for this run\'s status.'
      );
      stopPolling();
      clearSavedRun();
    }
  }, [stopPolling]);

  // ── Start polling ─────────────────────────────────────────────────────────
  function startPolling(runId: string, startAtAttempt = 0) {
    stopPolling();
    startTimeRef.current = Date.now() - startAtAttempt * POLL_INTERVAL_MS;
    let attempt = startAtAttempt;
    setPollCount(attempt);
    pollRef.current = setInterval(() => {
      attempt++;
      setPollCount(attempt);
      pollForResults(runId, attempt);
    }, POLL_INTERVAL_MS);
  }

  // ── Restore active run from localStorage on mount ─────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const saved: SavedRun = JSON.parse(raw);
      const ageMs = Date.now() - saved.startedAt;
      // Don't restore if already past max wait time
      if (ageMs > TIMEOUT_MS) { clearSavedRun(); return; }
      const elapsed = Math.floor(ageMs / POLL_INTERVAL_MS);
      setApolloRunId(saved.apolloRunId);
      setSearchedCount(saved.searchedCount);
      setEnrichmentRequestedCount(saved.enrichmentRequestedCount);
      setPollCount(elapsed);
      setRunStatus('processing');
      startPolling(saved.apolloRunId, elapsed); // starts from correct attempt offset
    } catch { clearSavedRun(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function toggle<T>(list: T[], setList: (v: T[]) => void, val: T) {
    setList(list.includes(val) ? list.filter(x => x !== val) : [...list, val]);
  }

  function resetToIdle() {
    stopPolling();
    clearSavedRun();
    setRunStatus('idle');
    setApolloRunId(null);
    setContacts([]);
    setFailureReason('');
    setPollCount(0);
    setElapsedMs(0);
  }

  // ── Search handler ────────────────────────────────────────────────────────
  async function handleSearch() {
    const loc  = location.trim();
    const ctry = country.trim();
    const effectiveIndustry = customIndustry.trim() || (industry !== 'Any Industry' ? industry : '');
    const co = companySearch.trim();

    if (!loc)                       return setError('City is required — e.g. Bangkok');
    if (!ctry)                      return setError('Country is required — e.g. Thailand');
    if (!effectiveIndustry && !co)  return setError('Industry or Company name is required');

    setError('');
    setRunStatus('searching');
    setContacts([]);
    setApolloRunId(null);
    setSelected(new Set());
    setPollCount(0);
    setElapsedMs(0);
    setFailureReason('');
    stopPolling();
    clearSavedRun();

    try {
      const filters: ApolloSearchFilters = {
        location:      loc,
        country:       ctry,
        industry:      effectiveIndustry,
        companySearch: co || undefined,
        seniority:     anyContact ? [] : seniority,
        departments:   department,
        companySizes,
        resultsLimit,
      };

      const res = await startApolloSearch(filters);

      setApolloRunId(res.apolloRunId);
      setSearchedCount(res.searchedCount || 0);
      setEnrichmentRequestedCount(res.enrichmentRequestedCount || 0);

      if (res.status === 'completed') {
        setRunStatus('completed');
        setContacts(res.contacts || []);
      } else {
        // Save to localStorage for cross-navigation persistence
        saveRun(res.apolloRunId, res.searchedCount || 0, res.enrichmentRequestedCount || 0);
        setRunStatus('processing');
        startPolling(res.apolloRunId, 0);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setRunStatus('idle');
    }
  }

  // ── Manual poll ───────────────────────────────────────────────────────────
  async function handleManualPoll() {
    if (!apolloRunId) return;
    try {
      const runRes = await getApolloRun(apolloRunId);
      if (runRes.run.status === 'error') {
        setRunStatus('failed');
        setFailureReason(runRes.run.error_message || 'Apollo enrichment failed');
        stopPolling();
        clearSavedRun();
        return;
      }
      const res = await getApolloContacts({ apolloRunId });
      setContacts(res.contacts);
      if (res.contacts.length > 0) { setRunStatus('completed'); stopPolling(); clearSavedRun(); }
      showToast(res.contacts.length > 0 ? `Found ${res.contacts.length} contacts!` : 'No contacts yet — Apollo may still be enriching');
    } catch { showToast('Poll failed'); }
  }

  // ── Contact actions ───────────────────────────────────────────────────────
  async function handleApprove(id: string) {
    setActionBusy(id);
    try { await approveContact(id); setContacts(prev => prev.map(c => c.id === id ? {...c, status:'approved'} : c)); showToast('Approved'); }
    catch { showToast('Failed to approve'); }
    finally { setActionBusy(null); }
  }
  async function handleReject(id: string) {
    setActionBusy(id);
    try { await rejectContact(id); setContacts(prev => prev.map(c => c.id === id ? {...c, status:'rejected'} : c)); showToast('Rejected'); }
    catch { showToast('Failed to reject'); }
    finally { setActionBusy(null); }
  }
  async function handlePush(id: string) {
    setActionBusy(id);
    try { await pushContactToHubspot(id); setContacts(prev => prev.map(c => c.id === id ? {...c, pushed_to_hubspot:true} : c)); showToast('Pushed to HubSpot'); }
    catch { showToast('Push failed'); }
    finally { setActionBusy(null); }
  }
  async function handleBulkApprove() {
    const ids = [...selected];
    if (!ids.length) return;
    setActionBusy('bulk');
    try { await bulkApproveContacts(ids); setContacts(prev => prev.map(c => ids.includes(c.id) ? {...c, status:'approved'} : c)); showToast(`${ids.length} approved`); setSelected(new Set()); }
    catch { showToast('Bulk approve failed'); }
    finally { setActionBusy(null); }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(selected.size === displayContacts.length ? new Set() : new Set(displayContacts.map(c => c.id)));
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'score' ? 'desc' : 'asc');
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const displayContacts = useMemo(() => {
    let list = [...contacts];
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

  // ── Derived status badge ──────────────────────────────────────────────────
  const elapsedSec = Math.round(elapsedMs / 1000) || pollCount * 10;
  const statusBadge = {
    idle:       null,
    searching:  { label: 'Searching Apollo...', color: 'bg-blue-100 text-blue-700' },
    processing: { label: `Enriching (${elapsedSec}s elapsed)`, color: 'bg-amber-100 text-amber-700' },
    completed:  { label: contacts.length > 0 ? `${contacts.length} contacts ready` : 'No sales-ready contacts found', color: contacts.length > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500' },
    failed:     { label: 'Enrichment failed', color: 'bg-red-100 text-red-600' },
  }[runStatus];

  const isSearching = runStatus === 'searching' || runStatus === 'processing';

  return (
    <div className="flex gap-0 min-h-screen -mx-4 sm:-mx-6 lg:-mx-8">
      {toast && (
        <div className="fixed top-6 right-6 bg-gray-900 text-white px-5 py-3 rounded-xl shadow-lg text-sm z-50">{toast}</div>
      )}

      {/* ── LEFT: Filter panel ──────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 px-4 py-5 space-y-5 overflow-y-auto" style={{background:'#fafbff',borderRight:'1px solid #f1f5f9'}}>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest" style={{letterSpacing:'.08em',fontSize:'10px'}}>🔬 Apollo Search</p>

        {/* Location */}
        <div className="space-y-2">
          <div>
            <label className="label">📍 City <span className="text-red-500">*</span></label>
            <input value={location} onChange={e => { setLocation(e.target.value); setError(''); }}
              placeholder="Bangkok" className="input"/>
          </div>
          <div>
            <label className="label">🌏 Country <span className="text-red-500">*</span></label>
            <input value={country} onChange={e => { setCountry(e.target.value); setError(''); }}
              placeholder="Thailand" className="input"/>
          </div>
        </div>

        {/* Industry */}
        <div>
          <label className="label">
            🏭 Industry
            {companySearch.trim()
              ? <span className="text-xs text-gray-400 font-normal ml-1">(optional if company set)</span>
              : <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <select value={industry} onChange={e => { setIndustry(e.target.value); setCustomIndustry(''); setError(''); }}
            disabled={!!customIndustry.trim()} className={`input ${customIndustry.trim() ? 'opacity-50' : ''}`}>
            {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
          </select>
          <input value={customIndustry} onChange={e => { setCustomIndustry(e.target.value); setError(''); }}
            placeholder="Or type in Thai: คลินิก, โรงแรม…" className="input mt-1.5"
            style={{borderColor:'#c7d2fe',background:'#eef2ff'}}/>
          {customIndustry.trim() && (
            <button onClick={() => setCustomIndustry('')} className="mt-1 text-xs text-gray-400 hover:text-red-500 underline">
              Clear · use dropdown
            </button>
          )}
        </div>

        {/* Company search */}
        <div>
          <label className="label">🏢 Company Name / Domain
            {!companySearch.trim() && <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>}
          </label>
          <input
            value={companySearch}
            onChange={e => { setCompanySearch(e.target.value); setError(''); }}
            placeholder="e.g. KASIKORN Bank, scb.co.th"
            className="input"
            style={companySearch.trim() ? {borderColor:'#6ee7b7', background:'#f0fdf4'} : {}}
          />
          {companySearch.trim() && (
            <button onClick={() => setCompanySearch('')} className="mt-1 text-xs text-gray-400 hover:text-red-500 underline">
              Clear
            </button>
          )}
          <p className="text-xs text-gray-400 mt-1 leading-snug">
            Name or domain. Comma-separate for multiple:<br/>
            <span className="font-mono text-gray-300">kasikornbank.com, scb.co.th</span>
          </p>
        </div>

        {/* Company size */}
        <div>
          <label className="label">🏢 Company Size <span className="text-xs text-gray-400 font-normal">(optional)</span></label>
          <div className="space-y-1.5">
            {COMPANY_SIZE_OPTIONS.map(o => (
              <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={companySizes.includes(o.value)}
                  onChange={() => toggle(companySizes, setCompanySizes, o.value)}
                  className="w-4 h-4 rounded accent-indigo-600"/>
                <span className="text-sm text-gray-700">{o.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Department */}
        <div>
          <label className="label">👔 Department <span className="text-xs text-gray-400 font-normal">(optional)</span></label>
          <div className="space-y-1.5">
            {DEPARTMENT_OPTIONS.map(o => (
              <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={department.includes(o.value)}
                  onChange={() => toggle(department, setDepartment, o.value)}
                  className="w-4 h-4 rounded accent-indigo-600"/>
                <span className="text-sm text-gray-700">{o.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Seniority */}
        <div>
          <label className="label">🎯 Seniority <span className="text-xs text-gray-400 font-normal">(optional)</span></label>
          <label className="flex items-center gap-2 cursor-pointer mb-2 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
            <input type="checkbox" checked={anyContact} onChange={e => setAnyContact(e.target.checked)} className="w-4 h-4 rounded accent-amber-500"/>
            <span className="text-sm font-semibold text-amber-700">⭐ Any Level</span>
          </label>
          {!anyContact && (
            <div className="space-y-1.5">
              {SENIORITY_OPTIONS.map(o => (
                <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={seniority.includes(o.value)}
                    onChange={() => toggle(seniority, setSeniority, o.value)}
                    className="w-4 h-4 rounded accent-indigo-600"/>
                  <span className="text-sm text-gray-700">{o.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Results limit */}
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">
            # Candidates <span className="ml-1 font-bold text-indigo-600">{resultsLimit}</span>
          </label>
          <input type="range" min={50} max={500} step={50} value={resultsLimit}
            onChange={e => setResultsLimit(Number(e.target.value))}
            className="w-full accent-indigo-600"/>
          <div className="flex justify-between text-xs text-gray-300 mt-0.5"><span>50</span><span>500</span></div>
        </div>

        {/* Search button */}
        <button onClick={handleSearch} disabled={isSearching}
          className="w-full btn-primary py-2.5 text-sm"
          style={isSearching ? {opacity:0.7,cursor:'not-allowed'} : {}}>
          {runStatus === 'searching'
            ? <span className="flex items-center justify-center gap-2"><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/>Searching...</span>
            : runStatus === 'processing'
            ? <span className="flex items-center justify-center gap-2"><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block"/>Enriching...</span>
            : '🔍 Search Apollo'}
        </button>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 flex items-start gap-2">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center"><span className="text-red-400">*</span> City, Country + Industry or Company · Uses Apollo credits</p>
      </div>

      {/* ── RIGHT: Results ──────────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-5 min-w-0">

        {/* Header */}
        <div className="mb-4">
          <a href="/contacts/apollo" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-600 mb-3 transition-colors">
            ← Apollo Dashboard
          </a>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">New Apollo Search</h1>
              <p className="text-xs text-gray-400 mt-0.5">Set filters → search → track progress here → contacts appear when Apollo delivers results</p>
            </div>
            <a href="/contacts/apollo"
              className="flex-shrink-0 flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 px-4 py-2 rounded-lg transition-colors">
              🔬 Apollo Dashboard →
            </a>
          </div>
        </div>

        {/* Status badge */}
        {statusBadge && (
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4 ${statusBadge.color}`}>
            {runStatus === 'processing' && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin inline-block"/>}
            {runStatus === 'failed' && <span>⚠️</span>}
            {statusBadge.label}
          </div>
        )}

        {/* ── Idle ── */}
        {runStatus === 'idle' && (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <p className="text-5xl mb-4">🔬</p>
            <p className="font-semibold text-gray-700 text-lg mb-1">Apollo People Search</p>
            <p className="text-sm text-gray-400 max-w-sm mb-4">
              Set your filters and click <strong>Search Apollo</strong>. We&apos;ll find candidates then run email enrichment — contacts with email <strong>or</strong> phone are saved.
            </p>
            <div className="text-xs text-gray-300 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 max-w-sm text-left space-y-1">
              <p><span className="text-gray-500 font-medium">Step 1</span> — People Search (names + companies)</p>
              <p><span className="text-gray-500 font-medium">Step 2</span> — Bulk Enrichment via Apollo email waterfall</p>
              <p><span className="text-gray-500 font-medium">Step 3</span> — Contacts with email <strong>or</strong> phone saved</p>
            </div>
          </div>
        )}

        {/* ── Step Tracker (searching + processing) ── */}
        {(runStatus === 'searching' || runStatus === 'processing') && (() => {
          const steps = [
            {
              key:   'submitted',
              icon:  '🚀',
              title: 'Search Submitted',
              desc:  runStatus === 'searching'
                ? 'Sending query to Apollo API with your filters…'
                : 'Query sent to Apollo API',
              status: runStatus === 'searching' ? 'active' : 'done',
            },
            {
              key:   'people',
              icon:  '👥',
              title: 'People Found',
              desc:  runStatus === 'searching'
                ? 'Scanning Apollo\'s database for matching contacts'
                : `Found ${searchedCount} candidates · ${enrichmentRequestedCount} sent for enrichment`,
              status: runStatus === 'searching' ? 'pending' : 'done',
            },
            {
              key:   'enriching',
              icon:  '⚡',
              title: 'Enriching Contacts',
              desc:  runStatus === 'processing'
                ? `Running email waterfall lookup · ${elapsedSec}s elapsed · auto-check every 10s`
                : 'Email waterfall lookup via Apollo (faster — phone if available)',
              status: runStatus === 'searching' ? 'pending' : 'active',
            },
            {
              key:   'webhook',
              icon:  '📡',
              title: 'Receiving Results',
              desc:  'Apollo delivers enriched contacts via webhook',
              status: 'pending' as const,
            },
            {
              key:   'ready',
              icon:  '✅',
              title: 'Ready to Review',
              desc:  'Contacts with email or phone saved and ready',
              status: 'pending' as const,
            },
          ] as Array<{ key: string; icon: string; title: string; desc: string; status: 'done' | 'active' | 'pending' }>;

          return (
            <div className="max-w-2xl">
              {/* Title + run ID */}
              <div className="mb-4">
                <h2 className="text-xl font-bold text-gray-900">🔬 Apollo Search Progress</h2>
                {apolloRunId && (
                  <p className="text-xs text-gray-400 font-mono mt-0.5">{apolloRunId}</p>
                )}
              </div>

              {/* Step card */}
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {steps.map((step, i) => {
                  const isDone    = step.status === 'done';
                  const isActive  = step.status === 'active';
                  const isPending = step.status === 'pending';
                  return (
                    <div key={step.key}
                      className={`flex items-center gap-4 px-5 py-4 ${i < steps.length - 1 ? 'border-b border-gray-100' : ''} ${isActive ? 'bg-indigo-50/60' : ''}`}>
                      {/* Icon circle */}
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-xl ${
                        isDone    ? 'bg-green-100'
                        : isActive  ? 'bg-indigo-100'
                        : 'bg-gray-100 opacity-40'
                      }`}>
                        {isDone ? '✅' : step.icon}
                      </div>
                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-sm ${isPending ? 'text-gray-400' : 'text-gray-900'}`}>
                          {step.title}
                        </p>
                        <p className={`text-xs mt-0.5 ${
                          isPending ? 'text-gray-300'
                          : isActive  ? 'text-indigo-600'
                          : 'text-gray-500'
                        }`}>
                          {step.desc}
                        </p>
                      </div>
                      {/* Status indicator */}
                      <div className="flex-shrink-0 w-16 text-right">
                        {isDone && (
                          <span className="text-green-600 font-semibold text-sm">Done</span>
                        )}
                        {isActive && (
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{animationDelay:'0ms'}}/>
                            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{animationDelay:'150ms'}}/>
                            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{animationDelay:'300ms'}}/>
                          </span>
                        )}
                        {isPending && (
                          <span className="text-gray-300 text-sm">Pending</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Results summary cards */}
              {runStatus === 'processing' && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-gray-900">{searchedCount}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Candidates Found</p>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-amber-600">{enrichmentRequestedCount}</p>
                    <p className="text-xs text-gray-500 mt-0.5">Sent for Enrichment</p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {runStatus === 'processing' && (
                <div className="mt-4 flex gap-2">
                  <button onClick={handleManualPoll}
                    className="text-sm text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg transition-colors">
                    🔄 Check Now
                  </button>
                  <a href="/contacts/apollo"
                    className="text-sm text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
                    View Dashboard →
                  </a>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── FAILED ── new clear error state */}
        {runStatus === 'failed' && (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <div className="w-16 h-16 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center text-3xl mb-4">
              ❌
            </div>
            <p className="font-bold text-gray-900 text-lg mb-1">Enrichment Failed</p>
            <p className="text-sm text-gray-500 mb-3 max-w-md">
              {failureReason || 'Apollo enrichment did not complete. The webhook may not have been received.'}
            </p>
            {apolloRunId && (
              <p className="text-xs font-mono text-gray-300 mb-4">Run: {apolloRunId}</p>
            )}
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 max-w-sm text-left text-xs text-red-600 space-y-1 mb-5">
              <p className="font-semibold">What to check:</p>
              <p>1. Ensure <code className="bg-red-100 px-1 rounded">PUBLIC_BASE_URL</code> is set on Cloud Run</p>
              <p>2. Ensure <code className="bg-red-100 px-1 rounded">GCP_PROJECT_ID</code> is set on Cloud Run</p>
              <p>3. Go to Apollo Dashboard to see the run status</p>
            </div>
            <div className="flex gap-2">
              <button onClick={resetToIdle}
                className="text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-lg transition-colors">
                🔄 Try Again
              </button>
              <a href="/contacts/apollo"
                className="text-sm text-gray-600 border border-gray-200 hover:bg-gray-50 px-5 py-2 rounded-lg transition-colors">
                Apollo Dashboard
              </a>
            </div>
          </div>
        )}

        {/* ── Completed: no contacts ── */}
        {runStatus === 'completed' && contacts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-80 text-center">
            <p className="text-4xl mb-3">😔</p>
            <p className="font-semibold text-gray-700 mb-1">No sales-ready contacts yet</p>
            <p className="text-sm text-gray-400 max-w-sm mb-4">
              {searchedCount > 0
                ? `Found ${searchedCount} candidates but none had both email and phone. Try fewer filters or a broader location.`
                : 'No people matched your filters. Try a broader location or remove the industry filter.'}
            </p>
            <div className="flex gap-2">
              <button onClick={resetToIdle}
                className="text-sm font-semibold text-indigo-600 border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-lg transition-colors">
                🔍 New Search
              </button>
              {apolloRunId && (
                <button onClick={handleManualPoll}
                  className="text-sm text-gray-500 border border-gray-200 bg-white hover:bg-gray-50 px-4 py-2 rounded-lg transition-colors">
                  🔄 Check Again
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Contacts table ── */}
        {contacts.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <p className="text-sm text-gray-600">
                <span className="font-bold text-gray-900">{contacts.length}</span> contacts found
                <span className="text-xs text-gray-400 ml-2">
                  · ✉️ {contacts.filter(c => c.public_email).length} email · 📞 {contacts.filter(c => c.public_phone).length} phone
                </span>
              </p>
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">{selected.size} selected</span>
                  <button onClick={handleBulkApprove} disabled={actionBusy === 'bulk'}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                    ✅ Approve Selected
                  </button>
                </div>
              )}
            </div>

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

            <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-3 text-left">
                      <input type="checkbox" checked={displayContacts.length > 0 && selected.size === displayContacts.length}
                        onChange={toggleAll} className="w-4 h-4 rounded accent-indigo-600"/>
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
                    const score = calcConfidence(c);
                    const st    = confStyle(score);
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
                              <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">LinkedIn</a>
                            )}
                          </div>
                        </div>
                      </td>
                      {/* Last Name */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <p className="text-xs text-gray-700">{last || '—'}</p>
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs max-w-[110px]">{c.job_title || '—'}</td>
                      <td className="px-3 py-3 text-xs">
                        <p className="font-medium text-gray-800">{c.company_name || '—'}</p>
                      </td>
                      {/* Email — show dash if null */}
                      <td className="px-3 py-3 text-xs">
                        {c.public_email
                          ? <span className="text-green-700 bg-green-50 border border-green-200 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">✉️ {c.public_email}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {/* Phone — show dash if null */}
                      <td className="px-3 py-3 text-xs">
                        {c.public_phone
                          ? <span className="text-blue-700 bg-blue-50 border border-blue-200 text-xs px-2 py-1 rounded-full font-medium whitespace-nowrap">📞 {c.public_phone}</span>
                          : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      {/* Confidence score */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col items-center gap-0.5 w-10">
                          <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                                style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                            {score}
                          </span>
                          <span className="text-xs font-medium" style={{ color: st.color }}>{st.label}</span>
                        </div>
                      </td>
                      {/* Actions — context-aware full-text buttons */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1.5 min-w-[120px]">
                          {c.pushed_to_hubspot ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg">
                              🚀 In HubSpot
                            </span>
                          ) : c.status === 'approved' ? (
                            <>
                              <button onClick={() => handlePush(c.id)} disabled={actionBusy === c.id}
                                className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                {actionBusy === c.id ? '⏳ Pushing…' : '🚀 Push to HubSpot'}
                              </button>
                              <button onClick={() => handleReject(c.id)} disabled={actionBusy === c.id}
                                className="inline-flex items-center justify-center gap-1 text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-300 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                                ✕ Reject
                              </button>
                            </>
                          ) : c.status === 'rejected' ? (
                            <button onClick={() => handleApprove(c.id)} disabled={actionBusy === c.id}
                              className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                              {actionBusy === c.id ? '⏳…' : '✅ Approve'}
                            </button>
                          ) : (
                            <>
                              <button onClick={() => handleApprove(c.id)} disabled={actionBusy === c.id}
                                className="inline-flex items-center justify-center gap-1 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
