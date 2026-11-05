import React, { useEffect, useState } from 'react';
import { useLang } from '@/lib/i18n';
import { THEMES, useSession, type Theme } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { ys, type ActivityLog } from '@/lib/yodsalesApi';
import { Badge, Button, Card, Input } from './UI';

const THEME_SWATCH: Record<Theme, string> = {
  Light: 'bg-[#F8FAFC] border-slate-200', Dark: 'bg-[#0B1120] border-slate-700', Ocean: 'bg-[#F0F9FF] border-sky-200',
  Sunset: 'bg-[#FFF7ED] border-orange-200', Forest: 'bg-[#F0FDF4] border-emerald-200', Thai: 'bg-[#FCF9F0] border-[#ED1C24]/30',
};

type Tab = 'account' | 'appearance' | 'targets' | 'activity';

export default function ProfilePage() {
  const { t, lang, setLang } = useLang();
  const { profile, session, theme, setTheme, refreshProfile, userName } = useSession();
  const [tab, setTab] = useState<Tab>('account');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [territory, setTerritory] = useState('');
  const [targets, setTargets] = useState({ daily: 10, weekly: 50, monthly: 200 });
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  useEffect(() => {
    if (!profile) return;
    setName(profile.full_name || '');
    setPhone(profile.phone || '');
    setTerritory(profile.territory || '');
    if (profile.targets) setTargets(prev => ({ ...prev, ...profile.targets }));
  }, [profile]);
  useEffect(() => { if (tab === 'activity') ys.myActivity().then(setLogs).catch(() => {}); }, [tab]);

  const flash = (m: string) => { setMsg(m); setErr(''); setTimeout(() => setMsg(''), 3000); };

  async function saveAccount() {
    setSaving(true);
    try {
      await ys.updateMe({ full_name: name, phone, territory, language: lang });
      await supabase.auth.updateUser({ data: { full_name: name } });
      await refreshProfile();
      flash(t('Profile saved', 'บันทึกโปรไฟล์แล้ว'));
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }

  async function saveTargets() {
    setSaving(true);
    try { await ys.updateMe({ targets }); await refreshProfile(); flash(t('Targets saved', 'บันทึกเป้าหมายแล้ว')); }
    catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }

  async function changePassword() {
    if (pw.length < 8) { setErr(t('Password must be at least 8 characters', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setErr(error.message); else { setPw(''); flash(t('Password updated', 'เปลี่ยนรหัสผ่านแล้ว')); ys.logActivity('Password Changed'); }
  }

  const tabs: { id: Tab; icon: string; en: string; th: string }[] = [
    { id: 'account', icon: '👤', en: 'Account', th: 'บัญชี' },
    { id: 'appearance', icon: '🎨', en: 'Appearance', th: 'ธีมและการแสดงผล' },
    { id: 'targets', icon: '🎯', en: 'Targets', th: 'เป้าหมาย' },
    { id: 'activity', icon: '🕒', en: 'Activity', th: 'ประวัติกิจกรรม' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <div className="lg:col-span-3 space-y-4">
        <div className="bg-white rounded-[2rem] border border-slate-100 p-6 text-center shadow-sm">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-[#242A56] text-white flex items-center justify-center text-3xl font-black shadow-lg">{userName.substring(0, 1).toUpperCase()}</div>
          <p className="mt-4 font-black text-slate-900 truncate">{userName}</p>
          <p className="text-xs text-slate-400 font-semibold truncate">{session?.user?.email}</p>
          <Badge variant={profile?.isAdmin ? 'orange' : 'blue'} className="mt-3 inline-block">{profile?.isAdmin ? 'Admin' : profile?.role || 'Sales Rep'}</Badge>
        </div>
        <div className="space-y-1">
          {tabs.map(x => (
            <button key={x.id} onClick={() => setTab(x.id)}
              className={`w-full text-left px-6 py-3.5 rounded-[1.25rem] font-black text-xs uppercase tracking-widest transition-all ${tab === x.id ? 'bg-[#242A56] text-white shadow-xl translate-x-1' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
              <span className="mr-3">{x.icon}</span>{lang === 'TH' ? x.th : x.en}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-9 space-y-6">
        {msg && <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-bold">{msg}</div>}
        {err && <div className="p-3 rounded-2xl bg-red-50 border border-red-100 text-red-600 text-sm font-bold">{err}</div>}

        {tab === 'account' && (
          <>
            <Card title={t('Account details', 'ข้อมูลบัญชี')}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Input label={t('Full name', 'ชื่อ-นามสกุล')} value={name} onChange={e => setName(e.target.value)} />
                <Input label={t('Email', 'อีเมล')} value={session?.user?.email || ''} disabled />
                <Input label={t('Phone', 'เบอร์โทร')} value={phone} onChange={e => setPhone(e.target.value)} placeholder="08x-xxx-xxxx" />
                <Input label={t('Assigned territory', 'พื้นที่รับผิดชอบ')} value={territory} onChange={e => setTerritory(e.target.value)} placeholder="Bangkok – Watthana" />
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <span className="ys-label !mb-0">{t('Language', 'ภาษา')}</span>
                {(['EN', 'TH'] as const).map(l => (
                  <button key={l} onClick={() => setLang(l)} className={`px-4 py-2 rounded-xl text-xs font-black ${lang === l ? 'bg-[#242A56] text-white' : 'bg-slate-100 text-slate-500'}`}>{l === 'EN' ? 'English' : 'ภาษาไทย'}</button>
                ))}
                <Button className="ml-auto" loading={saving} onClick={saveAccount}>{t('Save', 'บันทึก')}</Button>
              </div>
            </Card>
            <Card title={t('Security', 'ความปลอดภัย')}>
              <div className="flex flex-col md:flex-row gap-4 md:items-end">
                <div className="flex-1"><Input label={t('New password', 'รหัสผ่านใหม่')} type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} /></div>
                <Button variant="secondary" onClick={changePassword}>{t('Change password', 'เปลี่ยนรหัสผ่าน')}</Button>
              </div>
            </Card>
          </>
        )}

        {tab === 'appearance' && (
          <Card title={t('Theme', 'ธีม')}>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {THEMES.map(th => (
                <button key={th} onClick={() => setTheme(th)}
                  className={`p-5 rounded-[1.5rem] border-2 text-left transition-all ${theme === th ? 'border-[#ED1C24] shadow-lg -translate-y-0.5' : 'border-slate-100 hover:border-slate-300'}`}>
                  <div className={`h-16 rounded-xl border ${THEME_SWATCH[th]} flex items-center gap-2 px-3`}>
                    <span className="w-6 h-10 rounded-md bg-[#242A56]" /><span className="flex-1 space-y-1"><span className="block h-2 rounded bg-slate-300/70" /><span className="block h-2 w-2/3 rounded bg-slate-300/50" /></span>
                  </div>
                  <p className="mt-3 text-xs font-black uppercase tracking-widest text-slate-700">{th}{theme === th ? ' ✓' : ''}</p>
                </button>
              ))}
            </div>
          </Card>
        )}

        {tab === 'targets' && (
          <Card title={t('Lead targets', 'เป้าหมายรายชื่อลูกค้า')}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {([['daily', t('Daily', 'รายวัน'), 100], ['weekly', t('Weekly', 'รายสัปดาห์'), 500], ['monthly', t('Monthly', 'รายเดือน'), 2000]] as const).map(([k, label, max]) => (
                <div key={k} className="p-6 rounded-[2rem] border-2 border-slate-100 bg-white">
                  <p className="ys-label">{label}</p>
                  <p className="text-5xl font-black tracking-tighter text-[#242A56]">{targets[k]}</p>
                  <input type="range" min={1} max={max} value={targets[k]} onChange={e => setTargets(s => ({ ...s, [k]: Number(e.target.value) }))} className="w-full mt-4 accent-[#242A56]" />
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end"><Button loading={saving} onClick={saveTargets}>{t('Save targets', 'บันทึกเป้าหมาย')}</Button></div>
          </Card>
        )}

        {tab === 'activity' && (
          <Card title={t('Recent activity', 'กิจกรรมล่าสุด')}>
            {logs.length === 0 ? <p className="text-sm text-slate-400 font-semibold">{t('No activity yet', 'ยังไม่มีกิจกรรม')}</p> : (
              <div className="divide-y divide-slate-100">
                {logs.map(l => (
                  <div key={l.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-1">
                    <div><p className="text-sm font-black text-slate-800">{l.event_type}</p><p className="text-[11px] text-slate-400 font-semibold">{l.location_text || '—'}</p></div>
                    <p className="text-[11px] text-slate-400 font-bold">{new Date(l.created_at).toLocaleString(lang === 'TH' ? 'th-TH' : 'en-GB')} · {l.ip_address || ''}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
