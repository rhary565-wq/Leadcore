import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ys, type PipelineItem, type Stage } from '@/lib/yodsalesApi';
import { useLang } from '@/lib/i18n';
import { Badge, Button, Modal } from './UI';

const STAGES: { id: Stage; en: string; th: string; color: string }[] = [
  { id: 'new', en: 'New', th: 'ใหม่', color: 'bg-slate-400' },
  { id: 'contacted', en: 'Contacted', th: 'ติดต่อแล้ว', color: 'bg-blue-500' },
  { id: 'meeting', en: 'Meeting', th: 'นัดพบ', color: 'bg-indigo-500' },
  { id: 'proposal', en: 'Proposal', th: 'เสนอราคา', color: 'bg-amber-500' },
  { id: 'won', en: 'Won', th: 'ปิดการขาย', color: 'bg-emerald-500' },
  { id: 'lost', en: 'Lost', th: 'ไม่สำเร็จ', color: 'bg-red-400' },
];

const thb = (n: number) => `฿${(n || 0).toLocaleString()}`;

export default function SalesHub() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [editing, setEditing] = useState<PipelineItem | null>(null);

  const load = () => {
    setLoading(true);
    ys.pipeline().then(setItems).catch(e => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return items.filter(i => !s || [i.company_name, i.industry, i.city, i.province, i.notes].some(v => (v || '').toLowerCase().includes(s)));
  }, [items, q]);

  const stats = useMemo(() => {
    const open = items.filter(i => !['won', 'lost'].includes(i.stage));
    const won = items.filter(i => i.stage === 'won');
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: items.length,
      openValue: open.reduce((s, i) => s + Number(i.deal_value || 0), 0),
      wonValue: won.reduce((s, i) => s + Number(i.deal_value || 0), 0),
      winRate: won.length + items.filter(i => i.stage === 'lost').length
        ? Math.round((won.length / (won.length + items.filter(i => i.stage === 'lost').length)) * 100) : 0,
      due: items.filter(i => i.next_follow_up && i.next_follow_up <= today && !['won', 'lost'].includes(i.stage)).length,
    };
  }, [items]);

  async function move(item: PipelineItem, stage: Stage) {
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, stage } : i)));
    try { await ys.updatePipeline(item.id, { stage }); ys.logActivity('Pipeline Stage', `${item.company_name} → ${stage}`); }
    catch (e: any) { setError(e.message); load(); }
  }

  async function saveEdit() {
    if (!editing) return;
    const saved = await ys.updatePipeline(editing.id, {
      notes: editing.notes || '', deal_value: Number(editing.deal_value || 0), next_follow_up: editing.next_follow_up || null, stage: editing.stage,
    });
    setItems(prev => prev.map(i => (i.id === saved.id ? saved : i)));
    setEditing(null);
  }

  async function remove(item: PipelineItem) {
    if (!window.confirm(t(`Remove ${item.company_name} from your pipeline?`, `ลบ ${item.company_name} ออกจากไปป์ไลน์?`))) return;
    await ys.removePipeline(item.id);
    setItems(prev => prev.filter(i => i.id !== item.id));
    setEditing(null);
  }

  function exportCsv() {
    const cols: (keyof PipelineItem)[] = ['company_name', 'stage', 'deal_value', 'next_follow_up', 'phone', 'website', 'industry', 'city', 'province', 'lead_score', 'lead_status', 'notes'];
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [cols.join(','), ...filtered.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `sales-hub-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const stageName = (s: Stage) => { const x = STAGES.find(y => y.id === s)!; return lang === 'TH' ? x.th : x.en; };
  const today = new Date().toISOString().slice(0, 10);

  const card = (i: PipelineItem) => (
    <div key={i.id} draggable onDragStart={e => e.dataTransfer.setData('text/plain', i.id)}
      className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing">
      <div className="flex justify-between gap-2">
        <button onClick={() => setEditing(i)} className="text-left font-black text-sm text-slate-900 leading-tight hover:text-[#242A56]">{i.company_name}</button>
        {i.lead_status && <Badge variant={i.lead_status === 'Hot' ? 'red' : i.lead_status === 'Warm' ? 'orange' : 'neutral'} className="!px-2 !py-0.5 !text-[8px] shrink-0">{i.lead_status}</Badge>}
      </div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1 truncate">{[i.industry, i.city].filter(Boolean).join(' · ')}</p>
      <div className="flex items-center justify-between mt-3 text-[11px] font-bold">
        <span className="text-emerald-600">{i.deal_value ? thb(Number(i.deal_value)) : ''}</span>
        {i.next_follow_up && <span className={i.next_follow_up <= today ? 'text-red-500' : 'text-slate-400'}>📅 {i.next_follow_up}</span>}
      </div>
      <div className="flex gap-1 mt-3">
        {i.phone && <a href={`tel:${i.phone}`} className="flex-1 text-center py-1.5 rounded-lg bg-slate-50 text-[10px] font-black hover:bg-blue-50">📞</a>}
        {i.lead_id && <button onClick={() => navigate(`/leads/${i.lead_id}`)} className="flex-1 py-1.5 rounded-lg bg-slate-50 text-[10px] font-black hover:bg-blue-50">🔎</button>}
        <select value={i.stage} onChange={e => move(i, e.target.value as Stage)} className="flex-[2] py-1 rounded-lg bg-slate-50 text-[10px] font-black text-slate-600 outline-none" aria-label="Stage">
          {STAGES.map(s => <option key={s.id} value={s.id}>{lang === 'TH' ? s.th : s.en}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('Sales Hub', 'ศูนย์รวมการขาย')}</h1>
          <p className="text-sm text-slate-400 font-medium mt-1">{t('Your personal pipeline — drag cards between stages.', 'ไปป์ไลน์ส่วนตัวของคุณ — ลากการ์ดเพื่อเปลี่ยนสถานะ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Quick search…', 'ค้นหาด่วน…')} className="h-10 px-4 rounded-xl bg-white border border-slate-200 text-sm font-semibold outline-none" />
          <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl">
            {(['board', 'list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase ${view === v ? 'bg-white shadow text-[#242A56]' : 'text-slate-400'}`}>{v === 'board' ? t('Board', 'บอร์ด') : t('List', 'รายการ')}</button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!items.length}>⬇ CSV</Button>
          <Button size="sm" onClick={() => navigate('/territory')}>＋ {t('Add leads', 'เพิ่มลูกค้า')}</Button>
        </div>
      </div>

      {error && <div className="p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          [t('Opportunities', 'โอกาสการขาย'), stats.total.toLocaleString(), 'bg-blue-50/60 text-blue-900 border-blue-100'],
          [t('Open pipeline', 'มูลค่าที่เปิดอยู่'), thb(stats.openValue), 'bg-indigo-50/60 text-indigo-900 border-indigo-100'],
          [t('Won value', 'มูลค่าที่ปิดได้'), thb(stats.wonValue), 'bg-emerald-50/60 text-emerald-900 border-emerald-100'],
          [t('Win rate', 'อัตราปิดการขาย'), `${stats.winRate}%`, 'bg-amber-50/60 text-amber-900 border-amber-100'],
          [t('Follow-ups due', 'ต้องติดตาม'), String(stats.due), 'bg-red-50/60 text-red-900 border-red-100'],
        ].map(([k, v, c]) => (
          <div key={k} className={`rounded-[1.5rem] p-5 border ${c}`}>
            <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{k}</p>
            <p className="text-2xl font-black tracking-tight mt-1">{v}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="py-24 flex justify-center"><div className="w-10 h-10 border-4 border-[#242A56] border-t-transparent rounded-full animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="py-24 text-center rounded-[2rem] border-2 border-dashed border-slate-200">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-sm font-black uppercase tracking-widest text-slate-400">{t('No leads in your pipeline yet', 'ยังไม่มีลูกค้าในไปป์ไลน์')}</p>
          <Button className="mt-5" onClick={() => navigate('/territory')}>{t('Pick leads from the Territory Map', 'เลือกลูกค้าจากแผนที่พื้นที่')}</Button>
        </div>
      ) : view === 'board' ? (
        <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-4 overflow-x-auto pb-4 scrollbar-thin">
          {STAGES.map(s => {
            const col = filtered.filter(i => i.stage === s.id);
            const value = col.reduce((a, i) => a + Number(i.deal_value || 0), 0);
            return (
              <div key={s.id} onDragOver={e => e.preventDefault()}
                onDrop={e => { const id = e.dataTransfer.getData('text/plain'); const it = items.find(x => x.id === id); if (it && it.stage !== s.id) move(it, s.id); }}
                className="bg-slate-50/80 rounded-[1.5rem] p-3 border border-slate-100 min-h-[300px]">
                <div className="flex items-center justify-between px-2 py-2 mb-2">
                  <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-700"><span className={`w-2.5 h-2.5 rounded-full ${s.color}`} />{lang === 'TH' ? s.th : s.en}</span>
                  <span className="text-[10px] font-black text-slate-400">{col.length}{value ? ` · ${thb(value)}` : ''}</span>
                </div>
                <div className="space-y-2.5">{col.map(card)}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm text-left min-w-[760px]">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
              <tr><th className="px-5 py-3">{t('Company', 'บริษัท')}</th><th className="px-5 py-3">{t('Stage', 'สถานะ')}</th><th className="px-5 py-3">{t('Value', 'มูลค่า')}</th><th className="px-5 py-3">{t('Follow-up', 'นัดติดตาม')}</th><th className="px-5 py-3">{t('Contact', 'ติดต่อ')}</th><th className="px-5 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(i => (
                <tr key={i.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3"><p className="font-black text-slate-900">{i.company_name}</p><p className="text-[10px] text-slate-400 font-bold uppercase">{[i.industry, i.city].filter(Boolean).join(' · ')}</p></td>
                  <td className="px-5 py-3"><Badge>{stageName(i.stage)}</Badge></td>
                  <td className="px-5 py-3 font-bold text-emerald-600">{i.deal_value ? thb(Number(i.deal_value)) : '—'}</td>
                  <td className={`px-5 py-3 text-xs font-bold ${i.next_follow_up && i.next_follow_up <= today ? 'text-red-500' : 'text-slate-500'}`}>{i.next_follow_up || '—'}</td>
                  <td className="px-5 py-3 text-xs">{i.phone ? <a href={`tel:${i.phone}`} className="font-bold text-slate-700">{i.phone}</a> : '—'}</td>
                  <td className="px-5 py-3 text-right"><button onClick={() => setEditing(i)} className="text-[10px] font-black uppercase text-blue-600">{t('Edit', 'แก้ไข')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.company_name || ''}>
        {editing && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="ys-label">{t('Stage', 'สถานะ')}</label>
                <select value={editing.stage} onChange={e => setEditing({ ...editing, stage: e.target.value as Stage })} className="ys-input">
                  {STAGES.map(s => <option key={s.id} value={s.id}>{lang === 'TH' ? s.th : s.en}</option>)}
                </select>
              </div>
              <div>
                <label className="ys-label">{t('Deal value (THB)', 'มูลค่าดีล (บาท)')}</label>
                <input type="number" min={0} value={editing.deal_value || ''} onChange={e => setEditing({ ...editing, deal_value: Number(e.target.value) })} className="ys-input" />
              </div>
              <div>
                <label className="ys-label">{t('Next follow-up', 'นัดติดตามครั้งถัดไป')}</label>
                <input type="date" value={editing.next_follow_up || ''} onChange={e => setEditing({ ...editing, next_follow_up: e.target.value })} className="ys-input" />
              </div>
            </div>
            <div>
              <label className="ys-label">{t('Notes', 'บันทึก')}</label>
              <textarea rows={5} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} className="ys-input" placeholder={t('Call outcome, decision maker, next steps…', 'ผลการโทร ผู้ตัดสินใจ ขั้นตอนถัดไป…')} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-500">
              {editing.phone && <a href={`tel:${editing.phone}`} className="px-3 py-2 rounded-xl bg-slate-50">📞 {editing.phone}</a>}
              {editing.website && <a href={editing.website} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-xl bg-slate-50">🌐 {t('Website', 'เว็บไซต์')}</a>}
              {editing.lead_id && <button onClick={() => navigate(`/leads/${editing.lead_id}`)} className="px-3 py-2 rounded-xl bg-slate-50">🔎 {t('Lead details & contacts', 'รายละเอียดและผู้ติดต่อ')}</button>}
              <button onClick={() => navigate(`/ai?lead=${editing.lead_id || ''}&company=${encodeURIComponent(editing.company_name)}`)} className="px-3 py-2 rounded-xl bg-slate-50">🤖 {t('Draft outreach with AI', 'ร่างข้อความด้วย AI')}</button>
            </div>
            <div className="flex justify-between gap-3 pt-2">
              <Button variant="danger" size="sm" onClick={() => remove(editing)}>{t('Remove', 'ลบ')}</Button>
              <Button onClick={saveEdit}>{t('Save', 'บันทึก')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
