import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ys, type ActivityLog, type Profile, type SupportTicket } from '@/lib/yodsalesApi';
import { Badge, Button, Card } from './UI';

const ROLES = ['admin', 'Manager', 'Sales Rep', 'disabled'];

function device(ua: string) {
  if (/iphone|ipad/i.test(ua)) return '📱 iOS';
  if (/android/i.test(ua)) return '📱 Android';
  if (/windows/i.test(ua)) return '💻 Windows';
  if (/mac os/i.test(ua)) return '💻 macOS';
  if (/linux/i.test(ua)) return '💻 Linux';
  return ua ? '🌐 Web' : '—';
}

export default function AdminPortal() {
  const { t, lang } = useLang();
  const { profile } = useSession();
  const [tab, setTab] = useState<'traffic' | 'users' | 'support'>('traffic');
  const [summary, setSummary] = useState<{ users: number; jobs: number; leads: number; events24h: number; openTickets: number } | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');

  const load = () => {
    setErr('');
    Promise.all([ys.admin.summary(), ys.admin.users(), ys.admin.activity(), ys.admin.tickets()])
      .then(([s, u, a, tk]) => { setSummary(s); setUsers(u); setLogs(a); setTickets(tk); })
      .catch(e => setErr(e.message));
  };
  useEffect(load, []);

  const hourly = useMemo(() => {
    const m = new Array(24).fill(0);
    const since = Date.now() - 24 * 3600 * 1000;
    logs.forEach(l => { const d = new Date(l.created_at); if (d.getTime() >= since) m[d.getHours()]++; });
    return m.map((v, h) => ({ h: `${h}:00`, v }));
  }, [logs]);

  const lastSeen = useMemo(() => {
    const m: Record<string, string> = {};
    logs.forEach(l => { if (l.user_id && !m[l.user_id]) m[l.user_id] = l.created_at; });
    return m;
  }, [logs]);

  const filteredLogs = logs.filter(l => !q || [l.user_email, l.event_type, l.location_text, l.ip_address].some(v => (v || '').toLowerCase().includes(q.toLowerCase())));
  const fmt = (d: string) => new Date(d).toLocaleString(lang === 'TH' ? 'th-TH' : 'en-GB');

  async function setRole(u: Profile, role: string) {
    try { const saved = await ys.admin.setRole(u.id, role); setUsers(p => p.map(x => (x.id === u.id ? saved : x))); }
    catch (e: any) { setErr(e.message); }
  }
  async function setTicket(tk: SupportTicket, status: string) {
    const saved = await ys.admin.setTicket(tk.id, status);
    setTickets(p => p.map(x => (x.id === tk.id ? saved : x)));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">🛡️ {t('Admin Portal', 'ระบบผู้ดูแล')}</h1>
          <p className="text-sm text-slate-400 font-medium mt-1">{t('Users, access levels, traffic and support requests.', 'ผู้ใช้ สิทธิ์การเข้าถึง การใช้งาน และคำขอความช่วยเหลือ')}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>🔄 {t('Refresh', 'รีเฟรช')}</Button>
      </div>
      {err && <div className="p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">{err}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          [t('Users', 'ผู้ใช้'), summary?.users, '👥'], [t('Search jobs', 'งานค้นหา'), summary?.jobs, '🚀'],
          [t('Leads', 'รายชื่อ'), summary?.leads, '📈'], [t('Events (24h)', 'กิจกรรม (24 ชม.)'), summary?.events24h, '⚡'],
          [t('Open tickets', 'คำขอที่เปิดอยู่'), summary?.openTickets, '🎧'],
        ].map(([k, v, i]) => (
          <div key={k as string} className="bg-white rounded-[1.5rem] border border-slate-100 p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{k}</p>
            <div className="flex justify-between items-end mt-1"><span className="text-3xl font-black text-[#242A56]">{v === undefined ? '—' : Number(v).toLocaleString()}</span><span className="text-xl">{i}</span></div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-slate-100 p-1 rounded-2xl w-fit">
        {([['traffic', t('Webpage traffic', 'การใช้งานเว็บ')], ['users', t('User directory', 'รายชื่อผู้ใช้')], ['support', t('Support inbox', 'กล่องคำขอ')]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${tab === id ? 'bg-white shadow text-[#242A56]' : 'text-slate-400'}`}>{label}</button>
        ))}
      </div>

      {tab === 'traffic' && (
        <>
          <Card title={t('Activity — last 24 hours (by hour)', 'กิจกรรม 24 ชั่วโมงล่าสุด (รายชั่วโมง)')}>
            <ResponsiveContainer width="99%" height={200}>
              <BarChart data={hourly}><XAxis dataKey="h" fontSize={9} tickLine={false} axisLine={false} interval={2} /><YAxis allowDecimals={false} fontSize={9} width={28} axisLine={false} tickLine={false} /><Tooltip /><Bar dataKey="v" fill="#242A56" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </Card>
          <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100"><input value={q} onChange={e => setQ(e.target.value)} placeholder={t('Filter by user, event, IP…', 'กรองตามผู้ใช้ กิจกรรม IP…')} className="w-full md:w-80 h-10 px-4 rounded-xl bg-slate-50 text-sm font-semibold outline-none" /></div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-sm text-left min-w-[820px]">
                <thead className="sticky top-0 bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <tr><th className="px-5 py-3">{t('User', 'ผู้ใช้')}</th><th className="px-5 py-3">{t('Event', 'กิจกรรม')}</th><th className="px-5 py-3">{t('Detail', 'รายละเอียด')}</th><th className="px-5 py-3">IP</th><th className="px-5 py-3">{t('Device', 'อุปกรณ์')}</th><th className="px-5 py-3">{t('Time', 'เวลา')}</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLogs.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-bold text-slate-700">{l.user_email || '—'}</td>
                      <td className="px-5 py-3"><Badge variant={/login|session/i.test(l.event_type) ? 'green' : /logout/i.test(l.event_type) ? 'neutral' : 'blue'}>{l.event_type}</Badge></td>
                      <td className="px-5 py-3 text-xs text-slate-500 max-w-[260px] truncate">{l.location_text || '—'}</td>
                      <td className="px-5 py-3 text-xs font-mono text-slate-500">{l.ip_address || '—'}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">{device(l.device_info)}</td>
                      <td className="px-5 py-3 text-xs text-slate-400 font-bold whitespace-nowrap">{fmt(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredLogs.length && <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">{t('No activity', 'ไม่มีกิจกรรม')}</p>}
            </div>
          </div>
        </>
      )}

      {tab === 'users' && (
        <div className="bg-white rounded-[2rem] border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm text-left min-w-[720px]">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400">
              <tr><th className="px-5 py-3">{t('User / Identity', 'ผู้ใช้')}</th><th className="px-5 py-3">{t('Access level', 'ระดับสิทธิ์')}</th><th className="px-5 py-3">{t('Language', 'ภาษา')}</th><th className="px-5 py-3">{t('Last active', 'ใช้งานล่าสุด')}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u.id}>
                  <td className="px-5 py-3"><p className="font-black text-slate-900">{u.full_name || '—'}</p><p className="text-xs text-slate-400">{u.email}</p></td>
                  <td className="px-5 py-3">
                    <select value={u.role} onChange={e => setRole(u, e.target.value)} disabled={u.id === profile?.id}
                      className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-black text-slate-700 outline-none disabled:opacity-60">
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-5 py-3 text-xs font-bold text-slate-500">{u.language}</td>
                  <td className="px-5 py-3 text-xs text-slate-400 font-bold">{lastSeen[u.id] ? fmt(lastSeen[u.id]) : u.updated_at ? fmt(u.updated_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-[11px] text-slate-400 font-semibold border-t border-slate-100">{t('Admins listed in ADMIN_EMAILS on the server always keep admin access.', 'อีเมลที่อยู่ใน ADMIN_EMAILS บนเซิร์ฟเวอร์จะเป็นผู้ดูแลเสมอ')}</p>
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-3">
          {tickets.length === 0 && <p className="py-16 text-center text-xs font-black uppercase tracking-widest text-slate-400">{t('No support requests', 'ไม่มีคำขอ')}</p>}
          {tickets.map(tk => (
            <div key={tk.id} className="bg-white rounded-[1.5rem] border border-slate-100 p-5 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                <div><p className="font-black text-slate-900">{tk.subject}</p><p className="text-xs text-slate-400 font-semibold">{tk.name} · <a className="text-blue-600" href={`mailto:${tk.email}`}>{tk.email}</a> · {fmt(tk.created_at)}</p></div>
                <select value={tk.status} onChange={e => setTicket(tk, e.target.value)} className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-black outline-none">
                  <option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option>
                </select>
              </div>
              <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{tk.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
