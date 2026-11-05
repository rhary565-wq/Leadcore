import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLang } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { ys, type Summary } from '@/lib/yodsalesApi';
import StatusBadge from '@/components/StatusBadge';
import { Badge, Button, Card } from './UI';
import { CHART_COLORS } from './constants';

export default function SalesHome() {
  const { t } = useLang();
  const { userName, profile, profileError } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { ys.summary().then(setData).catch(e => setErr(e.message)); }, []);

  const T = data?.totals;
  const monthlyTarget = profile?.targets?.monthly || 200;
  const pct = T ? Math.min(100, Math.round((T.leads / monthlyTarget) * 100)) : 0;
  const topIndustry = data?.byIndustry?.[0]?.name;
  const topCity = data?.byCity?.[0]?.name;

  const stat = (label: string, value: number | undefined, icon: string, tone: string, to?: string) => (
    <button onClick={() => to && navigate(to)} className={`text-left rounded-[1.75rem] p-5 border transition-all hover:-translate-y-0.5 hover:shadow-lg ${tone}`}>
      <p className="text-[10px] font-black uppercase tracking-widest opacity-70">{label}</p>
      <div className="flex items-end justify-between mt-2">
        <span className="text-3xl font-black tracking-tighter">{value === undefined ? '—' : value.toLocaleString()}</span>
        <span className="text-xl">{icon}</span>
      </div>
    </button>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-200 pb-7">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-[#242A56] text-white flex items-center justify-center text-2xl font-black shadow-lg">{userName.substring(0, 1).toUpperCase()}</div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t(`Welcome back, ${userName}`, `ยินดีต้อนรับกลับ คุณ ${userName}`)}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <Badge variant="green">{profile?.role === 'admin' ? t('System Admin', 'ผู้ดูแลระบบ') : t('Field Representative', 'ตัวแทนภาคสนาม')}</Badge>
              <span className="text-slate-400 text-sm font-medium">{t('Your territory insights and pipeline, live from LeadGen.', 'ข้อมูลพื้นที่และไปป์ไลน์ของคุณ แบบเรียลไทม์จาก LeadGen')}</span>
            </div>
          </div>
        </div>
        <Button onClick={() => navigate('/discover')} className="!rounded-2xl">🔍 {t('New Lead Search', 'ค้นหาลูกค้าใหม่')}</Button>
      </div>

      {(err || profileError) && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold">
          {t('Could not load live data: ', 'ไม่สามารถโหลดข้อมูลได้: ')}{err || profileError}. {t('Check that the backend is running and the database migration has been applied.', 'ตรวจสอบว่า backend ทำงานอยู่และรัน SQL migration แล้ว')}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stat(t('Leads (30 days)', 'ลูกค้า (30 วัน)'), T?.leads, '📈', 'bg-blue-50/60 border-blue-100 text-blue-900', '/territory')}
        {stat(t('Hot Leads', 'ลูกค้าร้อนแรง'), T?.hot, '🔥', 'bg-red-50/60 border-red-100 text-red-900', '/territory?status=Hot')}
        {stat(t('Awaiting Approval', 'รออนุมัติ'), T?.pending, '⏳', 'bg-amber-50/60 border-amber-100 text-amber-900', '/dashboard')}
        {stat(t('Pushed to HubSpot', 'ส่งเข้า HubSpot แล้ว'), T?.pushed, '🔗', 'bg-emerald-50/60 border-emerald-100 text-emerald-900', '/contacts/all')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-8">
          <div className="relative rounded-[2rem] bg-gradient-to-br from-[#242A56] to-[#1E40AF] p-9 text-white overflow-hidden shadow-2xl">
            <div className="absolute -top-6 right-6 opacity-10 text-[10rem] select-none">📍</div>
            <div className="relative z-10 max-w-xl space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-2xl border border-white/10">✨</div>
                <div>
                  <h3 className="text-2xl font-black tracking-tight">{t('Territory Intelligence', 'ข้อมูลอัจฉริยะพื้นที่')}</h3>
                  <p className="text-xs font-bold text-blue-200 uppercase tracking-widest">{t('Last 30 days', '30 วันล่าสุด')}</p>
                </div>
              </div>
              <p className="text-lg font-medium text-blue-50 leading-relaxed">
                {T && T.leads > 0
                  ? t(`${T.hot} hot and ${T.warm} warm leads found. Strongest sector: ${topIndustry || '—'}, busiest area: ${topCity || '—'}.`,
                      `พบลูกค้าร้อนแรง ${T.hot} ราย และอบอุ่น ${T.warm} ราย ธุรกิจเด่น: ${topIndustry || '—'} พื้นที่เด่น: ${topCity || '—'}`)
                  : t('No leads yet — run your first Lead Discovery search to fill your territory.', 'ยังไม่มีข้อมูล — เริ่มค้นหาลูกค้ารายแรกของคุณได้เลย')}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="success" onClick={() => navigate('/ai')} className="!rounded-2xl">⚡ {t('Ask Sales Assistant', 'ถามผู้ช่วยฝ่ายขาย')}</Button>
                <Button variant="secondary" onClick={() => navigate('/territory')} className="!rounded-2xl">🗺️ {t('Open Map', 'เปิดแผนที่')}</Button>
              </div>
            </div>
          </div>

          <Card title={t('Territory Analytics', 'การวิเคราะห์พื้นที่')}>
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
              <div className="lg:col-span-2 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('Sector distribution', 'สัดส่วนกลุ่มธุรกิจ')}</p>
                {data?.byIndustry?.length ? (
                  <>
                    <ResponsiveContainer width="99%" height={200}>
                      <PieChart>
                        <Pie data={data.byIndustry} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                          {data.byIndustry.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / .1)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 mt-2">
                      {data.byIndustry.slice(0, 5).map((s, i) => (
                        <div key={s.name} className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                          <span className="flex items-center gap-2 truncate"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i] }} />{s.name}</span><span>{s.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <Empty t={t} />}
              </div>
              <div className="lg:col-span-3 min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{t('Discovery trend (14 days)', 'แนวโน้มการค้นพบ (14 วัน)')}</p>
                <ResponsiveContainer width="99%" height={240}>
                  <AreaChart data={data?.trend || []}>
                    <defs>
                      <linearGradient id="ysTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#242A56" stopOpacity={0.25} /><stop offset="95%" stopColor="#242A56" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="day" fontSize={10} fontWeight="bold" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} />
                    <YAxis allowDecimals={false} fontSize={10} axisLine={false} tickLine={false} tick={{ fill: '#94a3b8' }} width={30} />
                    <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / .1)' }} />
                    <Area type="monotone" dataKey="leads" stroke="#242A56" strokeWidth={3} fill="url(#ysTrend)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm">
            <div className="flex justify-between items-center mb-2">
              <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">🎯 {t('Monthly target', 'เป้าหมายรายเดือน')}</h4>
              <button onClick={() => navigate('/profile')} className="text-[10px] font-black uppercase text-blue-600">{t('Edit', 'แก้ไข')}</button>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-3xl font-black text-[#242A56]">{T?.leads ?? 0}<span className="text-sm text-slate-400"> / {monthlyTarget}</span></span>
              <span className="text-sm font-black text-emerald-600">{pct}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full mt-3 overflow-hidden"><div className="h-full bg-gradient-to-r from-[#242A56] to-[#ED1C24] rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-3">🏆 {t('Top territories', 'พื้นที่ยอดนิยม')}</h4>
            {(data?.byProvince?.filter(p => p.name !== 'Unknown').length ? data.byProvince.filter(p => p.name !== 'Unknown') : data?.byCity || []).slice(0, 5).map(p => (
              <button key={p.name} onClick={() => navigate(`/territory?province=${encodeURIComponent(p.name)}`)} className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-slate-50 group">
                <span className="text-sm font-extrabold text-slate-700">{p.name}</span>
                <span className="text-xs font-black text-slate-400 group-hover:text-[#242A56]">{p.value} →</span>
              </button>
            ))}
            {!data?.byCity?.length && <Empty t={t} />}
          </div>

          <div className="bg-white rounded-[2rem] border border-slate-100 p-6 shadow-sm">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest mb-3">⏳ {t('Recent searches', 'การค้นหาล่าสุด')}</h4>
            {(data?.recentJobs || []).slice(0, 5).map(j => (
              <button key={j.id} onClick={() => navigate(`/jobs/${j.id}`)} className="w-full flex items-center justify-between gap-2 py-2.5 border-b border-slate-50 last:border-0 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-slate-700 truncate">🔍 {(j.config?.queries || []).join(', ')}</span>
                  <span className="block text-[10px] font-bold uppercase text-slate-400">{[j.config?.district, j.config?.province].filter(Boolean).join(', ')}</span>
                </span>
                <StatusBadge status={j.status} />
              </button>
            ))}
            {!data?.recentJobs?.length && <Empty t={t} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Empty({ t }: { t: (a: string, b: string) => string }) {
  return <p className="text-[10px] font-bold text-slate-400 uppercase text-center py-6">{t('No data yet', 'ยังไม่มีข้อมูล')}</p>;
}
