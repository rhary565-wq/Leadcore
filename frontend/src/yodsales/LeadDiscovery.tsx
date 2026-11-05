// Lead Discovery — YodSales search bar (sector + Province → District → Sub-district)
// driving the LeadGen pipeline: Scrape (Apify / Google Maps engine) → Score → Approve
// → Apollo contacts → HubSpot. Options match the LeadGen "Launch Job" form.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createJob, getJobs, type Job, type JobConfig } from '@/lib/api';
import { ys, type Location, type SearchTemplate } from '@/lib/yodsalesApi';
import { useLang } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import StatusBadge from '@/components/StatusBadge';
import { Badge, Button, Card } from './UI';
import { INDUSTRIES, SECTOR_PRESETS } from './constants';

const LANGUAGES = [{ v: 'en', l: 'English' }, { v: 'th', l: 'ไทย (Thai)' }, { v: 'zh', l: '中文' }, { v: 'ja', l: '日本語' }, { v: 'ko', l: '한국어' }];
const ENGINES = [
  { v: 'apify', en: 'Apify (cloud, recommended)', th: 'Apify (คลาวด์ แนะนำ)' },
  { v: 'gosom', en: 'Google Maps engine (self-hosted, Docker)', th: 'Google Maps (ติดตั้งเอง Docker)' },
  { v: 'demo', en: 'Demo data (test the flow)', th: 'ข้อมูลตัวอย่าง (ทดสอบระบบ)' },
] as const;

function stepFor(v: number) { return v <= 500 ? 10 : v <= 2000 ? 100 : v <= 10000 ? 500 : 1000; }

export default function LeadDiscovery() {
  const { t, lang } = useLang();
  const { userName } = useSession();
  const navigate = useNavigate();

  // Location master
  const [provinces, setProvinces] = useState<Location[]>([]);
  const [districts, setDistricts] = useState<Location[]>([]);
  const [subs, setSubs] = useState<Location[]>([]);
  const [provinceId, setProvinceId] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [subId, setSubId] = useState('');

  // Search
  const [queries, setQueries] = useState('');
  const [industry, setIndustry] = useState('Any Industry');
  const [language, setLanguage] = useState('en');
  const [maxResults, setMaxResults] = useState(50);
  const [minRating, setMinRating] = useState(0);
  const [engine, setEngine] = useState<'apify' | 'gosom' | 'demo'>('apify');
  const [apolloEnabled, setApolloEnabled] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  const [maxContacts, setMaxContacts] = useState(100);
  const [extractEmail, setExtractEmail] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<SearchTemplate[]>([]);
  const [recent, setRecent] = useState<Job[]>([]);

  useEffect(() => {
    ys.provinces().then(setProvinces).catch(e => setError(e.message));
    ys.templates().then(setTemplates).catch(() => {});
    getJobs().then(j => setRecent(j.slice(0, 6))).catch(() => {});
  }, []);

  useEffect(() => {
    setDistricts([]); setDistrictId(''); setSubs([]); setSubId('');
    if (provinceId && provinceId !== 'ALL') ys.districts(provinceId).then(setDistricts).catch(() => {});
  }, [provinceId]);

  useEffect(() => {
    setSubs([]); setSubId('');
    if (districtId) ys.subDistricts(districtId).then(setSubs).catch(() => {});
  }, [districtId]);

  const name = (l?: Location) => (l ? (lang === 'TH' ? l.nameTh : l.nameEn) : '');
  const province = provinces.find(p => p.id === provinceId);
  const district = districts.find(d => d.id === districtId);
  const sub = subs.find(s => s.id === subId);
  const queryList = useMemo(() => queries.split(/\n|,/).map(q => q.trim()).filter(Boolean), [queries]);

  const locationLabel = provinceId === 'ALL'
    ? t('All Thailand', 'ทั่วประเทศไทย')
    : [name(sub), name(district), name(province)].filter(Boolean).join(', ') || t('Select a province', 'เลือกจังหวัด');

  function buildConfig(): JobConfig {
    // Apify / Google Maps need English place names
    const provinceEn = provinceId === 'ALL' ? 'All Thailand' : province?.nameEn || 'Bangkok';
    return {
      queries: queryList,
      province: provinceEn,
      district: district?.nameEn || undefined,
      subDistrict: sub?.nameEn || undefined,
      location: provinceEn === 'All Thailand' ? 'Thailand' : provinceEn,
      country: 'Thailand',
      language,
      industryFilter: industry === 'Any Industry' ? '' : industry,
      maxResults, minRating, engine, extractEmail,
      apolloEnabled, autoApprove, maxContacts,
      createdBy: userName,
    };
  }

  async function launch() {
    setError('');
    if (!queryList.length) { setError(t('Add at least one business keyword (e.g. "printer shop")', 'กรุณาใส่คำค้นหาอย่างน้อย 1 คำ (เช่น "ร้านพิมพ์เอกสาร")')); return; }
    if (!provinceId) { setError(t('Please select a province (or All Thailand)', 'กรุณาเลือกจังหวัด (หรือทั่วประเทศ)')); return; }
    setLoading(true);
    try {
      const job = await createJob(buildConfig());
      ys.logActivity('Lead Search', `${queryList.join(', ')} @ ${locationLabel}`);
      navigate(`/jobs/${job.jobId}`);
    } catch (e: any) {
      setError(e.message || 'Failed to launch search');
      setLoading(false);
    }
  }

  async function saveTemplate() {
    if (!queryList.length) return;
    const nm = window.prompt(t('Template name', 'ชื่อเทมเพลต'), `${queryList[0]} – ${locationLabel}`);
    if (!nm) return;
    const tpl = await ys.saveTemplate(nm, { ...buildConfig(), _ids: { provinceId, districtId, subId } });
    setTemplates(prev => [tpl, ...prev]);
  }

  async function applyTemplate(tpl: SearchTemplate) {
    const c = tpl.config || {};
    setQueries((c.queries || []).join('\n'));
    setIndustry(c.industryFilter || 'Any Industry');
    setLanguage(c.language || 'en');
    setMaxResults(c.maxResults || 50);
    setMinRating(c.minRating || 0);
    setEngine(c.engine || 'apify');
    setApolloEnabled(c.apolloEnabled ?? true);
    setAutoApprove(!!c.autoApprove);
    setMaxContacts(c.maxContacts || 100);
    setExtractEmail(!!c.extractEmail);
    const ids = c._ids || {};
    setProvinceId(ids.provinceId || '');
    // district/sub lists load asynchronously; restore after they arrive
    if (ids.districtId) {
      const d = await ys.districts(ids.provinceId);
      setDistricts(d); setTimeout(() => setDistrictId(ids.districtId), 0);
      if (ids.subId) {
        const s = await ys.subDistricts(ids.districtId);
        setTimeout(() => { setSubs(s); setSubId(ids.subId); }, 50);
      }
    }
  }

  const sel = 'appearance-none bg-transparent h-12 px-3 text-xs font-black outline-none cursor-pointer w-full text-slate-700 disabled:opacity-30';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('Lead Discovery', 'การค้นหาผู้มุ่งหวัง')}</h1>
          <p className="text-sm text-slate-400 font-medium mt-1">{t('Pick a sector and territory — we scrape Google Maps, score every business, find decision-makers and prepare them for HubSpot.', 'เลือกธุรกิจและพื้นที่ ระบบจะค้นหาจาก Google Maps ให้คะแนน หาผู้ติดต่อ และเตรียมส่งเข้า HubSpot')}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest">
          {[['⚙️', t('Configure', 'ตั้งค่า')], ['🌐', t('Scrape', 'ค้นหา')], ['🧠', t('Score', 'ให้คะแนน')], ['✅', t('Approve', 'อนุมัติ')], ['🔗', 'HubSpot']].map(([i, s], idx) => (
            <span key={s} className={`px-3 py-2 rounded-xl border ${idx === 0 ? 'bg-[#242A56] text-white border-[#242A56]' : 'bg-white text-slate-400 border-slate-100'}`}>{i} {s}</span>
          ))}
        </div>
      </div>

      {/* Search bar (YodSales style) */}
      <div className="sticky top-0 z-20">
        <div className="flex flex-col xl:flex-row items-stretch gap-2 p-2 rounded-[1.75rem] shadow-2xl border bg-white/95 backdrop-blur border-slate-100">
          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-1 md:divide-x divide-slate-200">
            <div className="flex items-center px-2"><span className="text-slate-400">🏢</span>
              <select value={industry} onChange={e => setIndustry(e.target.value)} className={sel} aria-label="Industry">
                {INDUSTRIES.map(i => <option key={i} value={i}>{i === 'Any Industry' ? t('All Sectors', 'ทุกกลุ่มธุรกิจ') : i}</option>)}
              </select>
            </div>
            <div className="flex items-center px-2"><span className="text-slate-400">📍</span>
              <select value={provinceId} onChange={e => setProvinceId(e.target.value)} className={sel} aria-label="Province">
                <option value="">{t('Select Province', 'เลือกจังหวัด')}</option>
                <option value="ALL">🇹🇭 {t('All Thailand', 'ทั่วประเทศไทย')}</option>
                {provinces.map(p => <option key={p.id} value={p.id}>{name(p)}</option>)}
              </select>
            </div>
            <div className="flex items-center px-2">
              <select value={districtId} onChange={e => setDistrictId(e.target.value)} disabled={!districts.length} className={sel} aria-label="District">
                <option value="">{t('All Districts', 'ทุกอำเภอ/เขต')}</option>
                {districts.map(d => <option key={d.id} value={d.id}>{name(d)}</option>)}
              </select>
            </div>
            <div className="flex items-center px-2">
              <select value={subId} onChange={e => setSubId(e.target.value)} disabled={!subs.length} className={sel} aria-label="Sub-district">
                <option value="">{t('All Sub-districts', 'ทุกตำบล/แขวง')}</option>
                {subs.map(s => <option key={s.id} value={s.id}>{name(s)}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setQueries(''); setProvinceId(''); setIndustry('Any Industry'); setError(''); }} className="!px-5 h-12 !rounded-2xl" title={t('Reset', 'ล้างค่า')}>🔄</Button>
            <Button loading={loading} onClick={launch} className="flex-1 xl:flex-none !px-8 h-12 !rounded-2xl">🔍 {t('Start Search', 'เริ่มค้นหา')}</Button>
          </div>
        </div>
      </div>

      {error && <div className="p-4 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-6">
          <Card title={t('What are you looking for?', 'คุณกำลังมองหาธุรกิจแบบไหน?')} allowOverflow>
            <label className="ys-label">{t('Business keywords — one per line', 'คำค้นหาธุรกิจ — บรรทัดละ 1 คำ')}</label>
            <textarea value={queries} onChange={e => setQueries(e.target.value)} rows={4}
              placeholder={'printer shop\noffice supplies\nร้านถ่ายเอกสาร'} className="ys-input resize-y font-mono" />
            <div className="flex flex-wrap gap-2 mt-3">
              {SECTOR_PRESETS.map(p => (
                <button key={p.en} type="button" onClick={() => setQueries(q => (q ? q.trimEnd() + '\n' : '') + p.query)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 hover:border-[#242A56] hover:text-[#242A56] bg-white">
                  + {lang === 'TH' ? p.th : p.en}
                </button>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className="ys-label">{t('Max results', 'จำนวนสูงสุด')}: <span className="text-[#242A56]">{maxResults.toLocaleString()}</span></label>
                <input type="range" min={10} max={25000} step={stepFor(maxResults)} value={maxResults} onChange={e => setMaxResults(Number(e.target.value))} className="w-full accent-[#242A56]" />
              </div>
              <div>
                <label className="ys-label">{t('Minimum rating', 'คะแนนขั้นต่ำ')}: <span className="text-[#242A56]">{minRating ? `${minRating}★` : t('Any', 'ทั้งหมด')}</span></label>
                <input type="range" min={0} max={5} step={0.5} value={minRating} onChange={e => setMinRating(Number(e.target.value))} className="w-full accent-[#242A56]" />
              </div>
              <div>
                <label className="ys-label">{t('Result language', 'ภาษาของผลลัพธ์')}</label>
                <select value={language} onChange={e => setLanguage(e.target.value)} className="ys-input !py-2.5">
                  {LANGUAGES.map(l => <option key={l.v} value={l.v}>{l.l}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
              <Toggle on={apolloEnabled} set={setApolloEnabled} title={t('Find decision-makers (Apollo)', 'หาผู้มีอำนาจตัดสินใจ (Apollo)')} desc={t('Owner / Director / Manager contacts with email & phone', 'ผู้ติดต่อระดับเจ้าของ/ผู้อำนวยการ/ผู้จัดการ พร้อมอีเมลและเบอร์โทร')} />
              <Toggle on={autoApprove} set={setAutoApprove} title={t('Auto-approve & push to HubSpot', 'อนุมัติอัตโนมัติและส่งเข้า HubSpot')} desc={t('Skip manual review — use with care', 'ข้ามการตรวจสอบ — โปรดใช้อย่างระมัดระวัง')} warn />
            </div>

            <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="mt-5 text-[11px] font-black uppercase tracking-widest text-slate-400 hover:text-[#242A56]">
              {showAdvanced ? '▾' : '▸'} {t('Advanced', 'ตั้งค่าขั้นสูง')}
            </button>
            {showAdvanced && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="ys-label">{t('Search engine', 'เครื่องมือค้นหา')}</label>
                  <select value={engine} onChange={e => setEngine(e.target.value as any)} className="ys-input !py-2.5">
                    {ENGINES.map(en => <option key={en.v} value={en.v}>{lang === 'TH' ? en.th : en.en}</option>)}
                  </select>
                </div>
                <div>
                  <label className="ys-label">{t('Max Apollo contacts per job', 'จำนวนผู้ติดต่อ Apollo สูงสุดต่องาน')}</label>
                  <input type="number" min={0} max={5000} value={maxContacts} onChange={e => setMaxContacts(Number(e.target.value))} disabled={!apolloEnabled} className="ys-input !py-2.5" />
                </div>
                {engine === 'gosom' && (
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                    <input type="checkbox" checked={extractEmail} onChange={e => setExtractEmail(e.target.checked)} /> {t('Also extract emails from websites (slower)', 'ดึงอีเมลจากเว็บไซต์ด้วย (ช้ากว่า)')}
                  </label>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="xl:col-span-4 space-y-6">
          <div className="rounded-[2rem] bg-gradient-to-br from-[#242A56] to-[#3b4a8c] p-7 text-white shadow-2xl">
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-200">{t('Search summary', 'สรุปการค้นหา')}</p>
            <div className="mt-4 space-y-3 text-sm">
              <Row k={t('Keywords', 'คำค้นหา')} v={queryList.length ? queryList.slice(0, 3).join(', ') + (queryList.length > 3 ? ` +${queryList.length - 3}` : '') : '—'} />
              <Row k={t('Territory', 'พื้นที่')} v={locationLabel} />
              <Row k={t('Sector filter', 'กลุ่มธุรกิจ')} v={industry === 'Any Industry' ? t('All', 'ทั้งหมด') : industry} />
              <Row k={t('Max results', 'จำนวนสูงสุด')} v={maxResults.toLocaleString()} />
              <Row k="Apollo" v={apolloEnabled ? `✓ ${t('up to', 'สูงสุด')} ${maxContacts}` : '✕'} />
              <Row k={t('Engine', 'เครื่องมือ')} v={engine === 'apify' ? 'Apify' : engine === 'gosom' ? 'Google Maps (Docker)' : 'Demo'} />
            </div>
            <div className="mt-6 flex gap-2">
              <Button variant="success" className="flex-1" loading={loading} onClick={launch}>🚀 {t('Launch', 'เริ่ม')}</Button>
              <Button variant="secondary" onClick={saveTemplate} title={t('Save as template', 'บันทึกเป็นเทมเพลต')}>💾</Button>
            </div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-3">💾 {t('Saved templates', 'เทมเพลตที่บันทึกไว้')}</h4>
            {templates.length === 0 ? (
              <p className="text-[11px] text-slate-400 font-semibold">{t('Save a search to reuse it in one click.', 'บันทึกการค้นหาเพื่อใช้ซ้ำได้ในคลิกเดียว')}</p>
            ) : templates.map(tpl => (
              <div key={tpl.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-50 last:border-0">
                <button onClick={() => applyTemplate(tpl)} className="text-left text-sm font-bold text-slate-700 hover:text-[#242A56] truncate">{tpl.name}</button>
                <button onClick={async () => { await ys.deleteTemplate(tpl.id); setTemplates(p => p.filter(x => x.id !== tpl.id)); }} className="text-slate-300 hover:text-red-500 text-xs" aria-label="Delete">✕</button>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">⏳ {t('Recent searches', 'การค้นหาล่าสุด')}</h4>
              <button onClick={() => navigate('/dashboard')} className="text-[10px] font-black uppercase text-blue-600">{t('All', 'ทั้งหมด')} →</button>
            </div>
            {recent.length === 0 ? <p className="text-[11px] text-slate-400 font-semibold">{t('No searches yet', 'ยังไม่มีการค้นหา')}</p> : recent.map(j => (
              <button key={j.id} onClick={() => navigate(`/jobs/${j.id}`)} className="w-full flex items-center justify-between gap-2 py-2.5 border-b border-slate-50 last:border-0 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-700 truncate">{(j.config?.queries || []).join(', ')}</span>
                  <span className="block text-[10px] text-slate-400 font-bold uppercase">{[j.config?.district, j.config?.province].filter(Boolean).join(', ')} · {j.total_records || 0} {t('leads', 'ราย')}</span>
                </span>
                <StatusBadge status={j.status} />
              </button>
            ))}
          </div>

          <div className="bg-blue-50/60 rounded-[2rem] p-6 text-xs text-slate-600 font-semibold space-y-2">
            <p className="font-black uppercase tracking-widest text-[10px] text-blue-500">{t('How leads are scored', 'วิธีให้คะแนน')}</p>
            {[['Industry match', '+30'], ['Has website', '+20'], ['Has phone', '+10'], ['20+ reviews', '+10'], ['Rating ≥ 3.5★', '+10']].map(([k, v]) => (
              <div key={k} className="flex justify-between"><span>{k}</span><Badge variant="blue">{v}</Badge></div>
            ))}
            <p className="text-[10px] text-slate-400">Hot ≥ 70 · Warm 40–69 · Low &lt; 40</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4"><span className="text-blue-200 text-xs font-bold">{k}</span><span className="font-black text-right truncate">{v}</span></div>;
}

function Toggle({ on, set, title, desc, warn }: { on: boolean; set: (v: boolean) => void; title: string; desc: string; warn?: boolean }) {
  return (
    <button type="button" onClick={() => set(!on)}
      className={`text-left p-4 rounded-2xl border-2 transition-all flex gap-3 items-start ${on ? (warn ? 'border-amber-400 bg-amber-50' : 'border-[#242A56] bg-[#242A56]/5') : 'border-slate-100 bg-white hover:border-slate-200'}`}>
      <span className={`mt-0.5 w-9 h-5 rounded-full relative shrink-0 transition-all ${on ? (warn ? 'bg-amber-500' : 'bg-[#242A56]') : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span><span className="block text-xs font-black text-slate-800">{title}</span><span className="block text-[11px] text-slate-500 font-medium mt-0.5">{desc}</span></span>
    </button>
  );
}
