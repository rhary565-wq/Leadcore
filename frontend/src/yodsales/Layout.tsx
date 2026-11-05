import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLang } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { API_URL } from '@/lib/http';
import { authDisabled } from '@/lib/supabase';

type NavItem = { to: string; en: string; th: string; icon: string; end?: boolean };
type NavGroup = { en: string; th: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  { en: 'Sales', th: 'การขาย', items: [
    { to: '/', en: 'Home', th: 'หน้าหลัก', icon: '🏠', end: true },
    { to: '/hub', en: 'Sales Hub', th: 'ศูนย์รวมการขาย', icon: '📊' },
    { to: '/territory', en: 'Territory Map', th: 'แผนที่พื้นที่ขาย', icon: '🗺️' },
    { to: '/ai', en: 'AI Assistant', th: 'ผู้ช่วยอัจฉริยะ', icon: '🤖' },
  ]},
  { en: 'Lead Generation', th: 'สร้างรายชื่อลูกค้า', items: [
    { to: '/discover', en: 'Lead Discovery', th: 'ค้นหาผู้มุ่งหวัง', icon: '🔍' },
    { to: '/dashboard', en: 'Search Jobs', th: 'งานค้นหา', icon: '🚀' },
    { to: '/apollo', en: 'Apollo Search', th: 'ค้นหาผู้ติดต่อ Apollo', icon: '🔬' },
    { to: '/contacts/apollo', en: 'Apollo Runs', th: 'ผลการค้นหา Apollo', icon: '👥' },
    { to: '/contacts/all', en: 'All Contacts', th: 'ผู้ติดต่อทั้งหมด', icon: '📇' },
  ]},
  { en: 'Help', th: 'ช่วยเหลือ', items: [
    { to: '/guide', en: 'User Guide', th: 'คู่มือการใช้งาน', icon: '📖' },
    { to: '/support', en: 'Support', th: 'สนับสนุน', icon: '🎧' },
  ]},
];
const ADMIN: NavItem = { to: '/admin', en: 'Admin Portal', th: 'ระบบผู้ดูแล', icon: '🛡️' };

function titleFor(path: string, t: (en: string, th: string) => string) {
  const all = [...GROUPS.flatMap(g => g.items), ADMIN];
  const hit = all.filter(i => (i.end ? path === i.to : path.startsWith(i.to) && i.to !== '/')).sort((a, b) => b.to.length - a.to.length)[0];
  if (hit) return t(hit.en, hit.th);
  if (path.startsWith('/jobs')) return t('Job Progress', 'ความคืบหน้างาน');
  if (path.startsWith('/approval')) return t('Lead Approval', 'อนุมัติรายชื่อ');
  if (path.startsWith('/leads')) return t('Lead Review', 'ตรวจสอบรายชื่อ');
  if (path.startsWith('/contacts')) return t('Contacts', 'ผู้ติดต่อ');
  if (path.startsWith('/profile')) return t('Profile', 'โปรไฟล์');
  if (path.startsWith('/fair-usage')) return t('Fair Use', 'นโยบาย');
  return t('Home', 'หน้าหลัก');
}

export default function Layout() {
  const { lang, setLang, t } = useLang();
  const { userName, isAdmin, signOut, profile } = useSession();
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const loc = useLocation();
  const navigate = useNavigate();

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    let stop = false;
    const check = () => fetch(`${API_URL}/health`).then(r => !stop && setOnline(r.ok)).catch(() => !stop && setOnline(false));
    check();
    const id = setInterval(check, 30_000);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const changeLang = (l: 'EN' | 'TH') => {
    setLang(l);
    import('@/lib/yodsalesApi').then(({ ys }) => ys.updateMe({ language: l }).catch(() => {}));
  };

  const groups = isAdmin ? [...GROUPS, { en: 'Admin', th: 'ผู้ดูแล', items: [ADMIN] }] : GROUPS;

  return (
    <div className="flex h-screen overflow-hidden">
      {open && <div className="fixed inset-0 bg-slate-900/60 z-[100] lg:hidden backdrop-blur-sm" onClick={() => setOpen(false)} />}

      <aside className={`ys-nav fixed lg:static inset-y-0 left-0 z-[110] w-72 text-white flex flex-col shadow-2xl transform transition-transform duration-300 ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        {/* Thai flag accent */}
        <div className="flex h-1.5 w-full shrink-0">
          <div className="flex-1 bg-[#ED1C24]" /><div className="flex-1 bg-white" /><div className="flex-[2] bg-[#242A56]" /><div className="flex-1 bg-white" /><div className="flex-1 bg-[#ED1C24]" />
        </div>

        <div className="px-7 pt-7 pb-5">
          <button className="flex flex-col text-left group" onClick={() => navigate('/')}>
            <span className="flex items-center gap-3">
              <span className="text-3xl drop-shadow-md group-hover:scale-110 transition-transform">🇹🇭</span>
              <span className="text-3xl font-black italic tracking-tighter [text-shadow:_0_2px_8px_rgba(0,0,0,0.45)]">Leadcore</span>
            </span>
            <span className="text-[9px] text-blue-200 mt-2 font-black uppercase tracking-[0.3em] opacity-80 pl-1">
              {t('Peak Sales Performance', 'ขีดสุดแห่งประสิทธิภาพการขาย')}
            </span>
            <span className="text-[10px] text-emerald-400 mt-1 font-bold italic pl-1">{t('Lead Intelligence × Sales Hub', 'ข้อมูลผู้มุ่งหวัง × ศูนย์การขาย')}</span>
          </button>
        </div>

        <nav className="flex-1 px-4 pb-4 overflow-y-auto scrollbar-hide space-y-5">
          {groups.map(g => (
            <div key={g.en}>
              <p className="px-4 mb-2 text-[9px] font-black uppercase tracking-[0.3em] text-white/35">{t(g.en, g.th)}</p>
              <div className="space-y-1">
                {g.items.map(item => (
                  <NavLink key={item.to} to={item.to} end={item.end}
                    className={({ isActive }) => `w-full flex items-center gap-4 px-5 py-3 rounded-2xl transition-all duration-200 border-l-4 ${
                      isActive ? 'bg-white shadow-xl text-[#242A56] font-black translate-x-1 border-[#ED1C24]' : 'text-white/70 hover:bg-white/5 hover:text-white border-transparent'}`}>
                    <span className="text-xl">{item.icon}</span>
                    <span className="text-[11px] uppercase tracking-widest font-black">{t(item.en, item.th)}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-5 border-t border-white/5">
          <NavLink to="/profile" className={({ isActive }) => `w-full flex items-center gap-4 bg-white/5 p-4 rounded-[1.5rem] border border-white/5 transition-all ${isActive ? 'bg-white/10 ring-1 ring-[#ED1C24]/50' : 'hover:bg-white/10'}`}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-black border-2 border-white/20 shadow-lg shrink-0 ${isAdmin ? 'bg-amber-500' : 'bg-[#ED1C24]'}`}>
              {userName.substring(0, 2).toUpperCase()}
            </div>
            <div className="text-left overflow-hidden">
              <p className="text-xs font-black leading-none truncate">{userName}</p>
              <p className="text-[9px] text-blue-200 font-bold uppercase mt-1.5 tracking-tight">{isAdmin ? t('System Admin', 'ผู้ดูแลระบบ') : (profile?.role || t('Sales Rep', 'พนักงานขาย'))}</p>
            </div>
          </NavLink>
          {authDisabled ? (
            <p className="w-full mt-3 py-2 text-center text-[10px] font-black uppercase text-amber-300 tracking-[0.2em]">No-login mode</p>
          ) : <button onClick={signOut} className="w-full mt-3 py-2 text-[10px] font-black uppercase text-white/40 hover:text-[#ED1C24] transition-colors tracking-[0.2em]">
            {t('Sign Out', 'ออกจากระบบ')}
          </button>}
          <span className="text-[9px] text-white/20 font-bold uppercase tracking-widest block text-center">© 2026 Leadcore Thailand</span>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="ys-header h-16 bg-white/80 backdrop-blur-xl border-b border-slate-200 px-4 md:px-8 flex items-center justify-between shrink-0 z-[90]">
          <div className="flex items-center gap-4 min-w-0">
            <button onClick={() => setOpen(true)} className="lg:hidden p-2.5 rounded-2xl bg-slate-100 text-slate-600" aria-label="Menu">☰</button>
            <h2 className="text-[12px] font-black uppercase tracking-[0.25em] text-slate-800 truncate">{titleFor(loc.pathname, t)}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span title={online ? 'API online' : 'API offline'}
              className={`hidden sm:flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full border ${
                online === null ? 'text-slate-400 border-slate-200' : online ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-emerald-500 animate-pulse' : online === false ? 'bg-red-500' : 'bg-slate-300'}`} />
              {online === false ? 'API Offline' : 'API Live'}
            </span>
            <div className="flex items-center rounded-full p-1 border bg-slate-100/80 border-slate-200">
              {(['EN', 'TH'] as const).map(l => (
                <button key={l} onClick={() => changeLang(l)}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${lang === l ? 'bg-white shadow text-[#242A56]' : 'text-slate-400'}`}>{l}</button>
              ))}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1500px] mx-auto px-4 py-6 md:px-8 md:py-8 min-h-full flex flex-col">
            <div className="flex-1 pb-12"><Outlet /></div>
            <footer className="py-6 border-t border-slate-200 flex justify-end gap-6 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
              <NavLink to="/support" className="hover:text-[#242A56]">{t('Support', 'สนับสนุน')}</NavLink>
              <NavLink to="/fair-usage" className="hover:text-[#242A56]">{t('Fair Usage Policy', 'นโยบายการใช้งานที่เป็นธรรม')}</NavLink>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
