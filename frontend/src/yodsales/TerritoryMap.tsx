// Territory Map — every LeadGen lead on a map + filterable table (YodSales "Lead Discovery"
// map/table idea + the Cipher "Leads" table). Select leads → Sales Hub, export CSV/JSON.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Lead } from '@/lib/api';
import { ys, type Location } from '@/lib/yodsalesApi';
import { useLang } from '@/lib/i18n';
import { Badge, Button } from './UI';

const STATUS_COLOR: Record<string, string> = { Hot: '#ED1C24', Warm: '#f59e0b', Low: '#64748b' };
type SortKey = 'company_name' | 'lead_score' | 'rating' | 'reviews_count' | 'city';

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(points, { padding: [30, 30], maxZoom: 15 });
  }, [points, map]);
  return null;
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => { if (target) map.flyTo(target, Math.max(map.getZoom(), 15), { duration: 0.6 }); }, [target, map]);
  return null;
}

export default function TerritoryMap() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [provinces, setProvinces] = useState<Location[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<'split' | 'table' | 'map'>('split');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'lead_score', dir: -1 });
  const [filters, setFilters] = useState({ hasPhone: false, hasWebsite: false, minRating: 0 });
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const province = params.get('province') || '';
  const status = params.get('status') || '';
  const approval = params.get('approval') || '';
  const q = params.get('q') || '';
  const [qInput, setQInput] = useState(q);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => { ys.provinces().then(setProvinces).catch(() => {}); }, []);
  useEffect(() => {
    setLoading(true); setError('');
    ys.leads({ province, status, approval, q, limit: '2000' })
      .then(l => { setLeads(l); setSelected(new Set()); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [province, status, approval, q]);
  useEffect(() => { const id = setTimeout(() => { if (qInput !== q) setParam('q', qInput); }, 400); return () => clearTimeout(id); }, [qInput]); // eslint-disable-line

  const rows = useMemo(() => {
    const r = leads.filter(l =>
      (!filters.hasPhone || l.phone) && (!filters.hasWebsite || l.website) && (Number(l.rating || 0) >= filters.minRating));
    return [...r].sort((a, b) => {
      const av = a[sort.k] ?? '', bv = b[sort.k] ?? '';
      return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * sort.dir;
    });
  }, [leads, filters, sort]);

  const points = useMemo(() => rows.filter(l => l.latitude && l.longitude).map(l => [Number(l.latitude), Number(l.longitude)] as [number, number]), [rows]);
  const highlighted = rows.find(r => r.id === highlight);
  const flyTarget: [number, number] | null = highlighted?.latitude ? [Number(highlighted.latitude), Number(highlighted.longitude)] : null;

  const toggleAll = () => setSelected(s => (s.size === rows.length ? new Set() : new Set(rows.map(r => r.id))));
  const toggle = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function addToHub() {
    if (!selected.size) return;
    const r = await ys.addToPipeline([...selected]);
    setToast(t(`${r.added} lead(s) added to Sales Hub`, `เพิ่ม ${r.added} รายการเข้าศูนย์การขายแล้ว`));
    setSelected(new Set());
    setTimeout(() => setToast(''), 3000);
  }

  const th = (k: SortKey, label: string, cls = '') => (
    <th className={`px-4 py-3 cursor-pointer select-none whitespace-nowrap ${cls}`} onClick={() => setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      {label} {sort.k === k ? (sort.dir === 1 ? '▲' : '▼') : ''}
    </th>
  );

  const table = (
    <div className="overflow-auto max-h-[640px] scrollbar-thin">
      <table className="w-full text-left text-sm min-w-[860px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
          <tr>
            <th className="px-4 py-3 w-8"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} aria-label="Select all" /></th>
            {th('company_name', t('Business', 'ชื่อธุรกิจ'))}
            <th className="px-4 py-3">{t('Contact', 'การติดต่อ')}</th>
            {th('city', t('Territory', 'พื้นที่'))}
            {th('rating', t('Rating', 'คะแนน'))}
            {th('lead_score', t('Score', 'คะแนนลูกค้า'), 'text-center')}
            <th className="px-4 py-3 text-center">{t('Action', 'จัดการ')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(l => (
            <tr key={l.id} ref={el => { if (el) rowRefs.current.set(l.id, el); }} onClick={() => setHighlight(l.id)}
              className={`cursor-pointer transition-colors ${highlight === l.id ? 'bg-blue-50/70' : 'hover:bg-slate-50/70'}`}>
              <td className="px-4 py-3" onClick={e => e.stopPropagation()}><input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} aria-label="Select" /></td>
              <td className="px-4 py-3 max-w-[260px]">
                <p className="font-black text-slate-900 truncate">{l.company_name}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider truncate">{l.industry || '—'}</p>
              </td>
              <td className="px-4 py-3 text-xs">
                {l.phone ? <a href={`tel:${l.phone}`} onClick={e => e.stopPropagation()} className="block font-bold text-slate-700 hover:text-blue-600">{l.phone}</a> : <span className="text-slate-300 italic">{t('No phone', 'ไม่มีเบอร์')}</span>}
                {l.website && <a href={l.website} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="block text-blue-600 truncate max-w-[180px]">{l.website.replace(/^https?:\/\/(www\.)?/, '')}</a>}
              </td>
              <td className="px-4 py-3 text-xs">
                <p className="font-bold text-slate-700">{l.district || l.city || '—'}</p>
                <p className="text-[10px] text-slate-400 font-bold uppercase">{l.province || ''}</p>
              </td>
              <td className="px-4 py-3 text-xs font-bold text-slate-600 whitespace-nowrap">{l.rating ? `${l.rating}★` : '—'} <span className="text-slate-400">({l.reviews_count || 0})</span></td>
              <td className="px-4 py-3 text-center">
                <Badge variant={l.lead_status === 'Hot' ? 'red' : l.lead_status === 'Warm' ? 'orange' : 'neutral'}>{l.lead_score} · {l.lead_status}</Badge>
              </td>
              <td className="px-4 py-3 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                <button onClick={() => navigate(`/leads/${l.id}`)} className="px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-black uppercase hover:border-[#242A56]">{t('Open', 'เปิด')}</button>
                {l.google_maps_url && <a href={l.google_maps_url} target="_blank" rel="noreferrer" className="ml-1 text-lg" title="Google Maps">📍</a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && (
        <div className="py-24 text-center text-[12px] font-black uppercase tracking-[0.2em] text-slate-400">
          {t('No leads match. Run a Lead Discovery search to fill this territory.', 'ไม่พบข้อมูล เริ่มค้นหาลูกค้าเพื่อเติมพื้นที่นี้')}
        </div>
      )}
    </div>
  );

  const map = (
    <div className="h-[640px] relative">
      <MapContainer center={[13.7563, 100.5018]} zoom={6} className="w-full h-full" scrollWheelZoom>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitBounds points={points} />
        <FlyTo target={flyTarget} />
        {rows.filter(l => l.latitude && l.longitude).map(l => (
          <CircleMarker key={l.id} center={[Number(l.latitude), Number(l.longitude)]}
            radius={highlight === l.id ? 11 : 7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: STATUS_COLOR[l.lead_status] || '#242A56', fillOpacity: highlight === l.id ? 1 : 0.85 }}
            eventHandlers={{ click: () => { setHighlight(l.id); rowRefs.current.get(l.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }}>
            <Popup>
              <div className="text-xs space-y-1 min-w-[180px]">
                <p className="font-black text-sm text-slate-900">{l.company_name}</p>
                <p className="text-slate-500">{l.industry}</p>
                <p className="font-bold">{l.lead_score} · {l.lead_status} {l.rating ? `· ${l.rating}★` : ''}</p>
                {l.phone && <p>📞 {l.phone}</p>}
                <button onClick={() => navigate(`/leads/${l.id}`)} className="mt-1 text-blue-600 font-bold">{t('Open lead →', 'เปิดรายละเอียด →')}</button>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      {!loading && points.length === 0 && rows.length > 0 && (
        <div className="absolute inset-x-0 top-4 mx-auto w-fit z-[500] px-4 py-2 rounded-xl bg-white/95 shadow text-[11px] font-bold text-slate-500">
          {t('These leads have no coordinates yet (older searches). New searches appear on the map.', 'รายการเหล่านี้ยังไม่มีพิกัด (การค้นหาเก่า) การค้นหาใหม่จะแสดงบนแผนที่')}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('Territory Map', 'แผนที่พื้นที่ขาย')}</h1>
          <p className="text-sm text-slate-400 font-medium mt-1">{t('All discovered businesses — filter, map, and move the best ones into your Sales Hub.', 'ธุรกิจทั้งหมดที่ค้นพบ — กรอง ดูบนแผนที่ และย้ายรายที่ดีที่สุดเข้าศูนย์การขาย')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => ys.exportLeads({ province, status, approval }, 'csv')}>⬇ CSV</Button>
          <Button variant="secondary" size="sm" onClick={() => ys.exportLeads({ province, status, approval }, 'json')}>⬇ JSON</Button>
          <Button size="sm" disabled={!selected.size} onClick={addToHub}>🚀 {t('Add to Sales Hub', 'เพิ่มเข้าศูนย์การขาย')} {selected.size ? `(${selected.size})` : ''}</Button>
        </div>
      </div>

      {toast && <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-bold">{toast}</div>}
      {error && <div className="p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">{error}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 p-2 rounded-[1.5rem] bg-white border border-slate-100 shadow-sm">
        <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder={t('Search name, address, sector…', 'ค้นหาชื่อ ที่อยู่ ประเภทธุรกิจ…')} className="flex-1 min-w-[200px] h-10 px-4 rounded-xl bg-slate-50 text-sm font-semibold outline-none" />
        <select value={province} onChange={e => setParam('province', e.target.value)} className="h-10 px-3 rounded-xl bg-slate-50 text-xs font-black text-slate-700 outline-none">
          <option value="">{t('All provinces', 'ทุกจังหวัด')}</option>
          {provinces.map(p => <option key={p.id} value={p.nameEn}>{lang === 'TH' ? p.nameTh : p.nameEn}</option>)}
        </select>
        <select value={status} onChange={e => setParam('status', e.target.value)} className="h-10 px-3 rounded-xl bg-slate-50 text-xs font-black text-slate-700 outline-none">
          <option value="">{t('All scores', 'ทุกระดับ')}</option><option value="Hot">🔥 Hot</option><option value="Warm">🌤 Warm</option><option value="Low">Low</option>
        </select>
        <select value={approval} onChange={e => setParam('approval', e.target.value)} className="h-10 px-3 rounded-xl bg-slate-50 text-xs font-black text-slate-700 outline-none">
          <option value="">{t('Any approval', 'ทุกสถานะ')}</option><option value="pending">{t('Pending', 'รออนุมัติ')}</option><option value="approved">{t('Approved', 'อนุมัติแล้ว')}</option><option value="rejected">{t('Rejected', 'ปฏิเสธ')}</option>
        </select>
        <label className="flex items-center gap-1.5 px-2 text-[11px] font-bold text-slate-600"><input type="checkbox" checked={filters.hasPhone} onChange={e => setFilters(f => ({ ...f, hasPhone: e.target.checked }))} />📞</label>
        <label className="flex items-center gap-1.5 px-2 text-[11px] font-bold text-slate-600"><input type="checkbox" checked={filters.hasWebsite} onChange={e => setFilters(f => ({ ...f, hasWebsite: e.target.checked }))} />🌐</label>
        <select value={filters.minRating} onChange={e => setFilters(f => ({ ...f, minRating: Number(e.target.value) }))} className="h-10 px-3 rounded-xl bg-slate-50 text-xs font-black text-slate-700 outline-none">
          <option value={0}>★ {t('Any', 'ทั้งหมด')}</option><option value={3.5}>3.5★+</option><option value={4}>4★+</option><option value={4.5}>4.5★+</option>
        </select>
      </div>

      <div className="rounded-[2rem] shadow-xl border border-slate-100 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{t('Lead insights', 'ข้อมูลผู้มุ่งหวัง')}</span>
            <p className="text-xl font-black text-slate-900">{loading ? '…' : rows.length.toLocaleString()} {t('leads', 'ราย')} <span className="text-xs text-slate-400 font-bold">· {points.length} {t('on map', 'บนแผนที่')}</span></p>
          </div>
          <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl">
            {(['split', 'table', 'map'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${view === v ? 'bg-white shadow text-[#242A56]' : 'text-slate-400'}`}>
                {v === 'split' ? t('Split', 'แบ่งจอ') : v === 'table' ? t('Table', 'ตาราง') : t('Map', 'แผนที่')}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-[600] flex flex-col items-center justify-center">
              <div className="w-10 h-10 border-4 border-[#242A56] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {view === 'table' && table}
          {view === 'map' && map}
          {view === 'split' && <div className="grid grid-cols-1 xl:grid-cols-2 xl:divide-x divide-slate-100">{table}{map}</div>}
        </div>
      </div>
    </div>
  );
}
