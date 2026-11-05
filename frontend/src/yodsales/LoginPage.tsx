import React, { useEffect, useMemo, useState } from 'react';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { useLang } from '@/lib/i18n';
import { Button, Input, Modal } from './UI';

const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true';

export default function LoginPage() {
  const { lang, setLang, t } = useLang();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('yodsales_remembered_email');
      if (saved) { setEmail(saved); setRememberMe(true); }
    } catch { /* ignore */ }
  }, []);

  const strength = useMemo(() => {
    if (!password) return { score: 0, label: '', color: 'bg-slate-200' };
    let s = 0;
    if (password.length >= 8) s++;
    if (/[A-Z]/.test(password)) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    const labels = lang === 'TH' ? ['อ่อนแอมาก', 'อ่อนแอ', 'พอใช้', 'ดี', 'แข็งแกร่ง'] : ['Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    return { score: s, label: labels[s], color: ['bg-red-500', 'bg-red-400', 'bg-orange-400', 'bg-blue-500', 'bg-emerald-500'][s] };
  }, [password, lang]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!email || !password) { setError(t('Enter your email and password', 'กรุณากรอกอีเมลและรหัสผ่าน')); return; }
    if (isSignUp && password.length < 8) { setError(t('Password must be at least 8 characters', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')); return; }
    setLoading(true);
    try {
      if (isSignUp) {
        const { data, error: err } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: fullName || email.split('@')[0] }, emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        if (!data.session) {
          setSuccess(t('Account created! Check your email to confirm, then sign in.', 'สร้างบัญชีแล้ว! กรุณายืนยันอีเมลของคุณ แล้วเข้าสู่ระบบ'));
          setIsSignUp(false);
        }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        try {
          if (rememberMe) localStorage.setItem('yodsales_remembered_email', email);
          else localStorage.removeItem('yodsales_remembered_email');
        } catch { /* ignore */ }
      }
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (/invalid login/i.test(msg)) setError(t('Incorrect email or password', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'));
      else if (/not confirmed/i.test(msg)) setError(t('Please confirm your email first', 'กรุณายืนยันอีเมลก่อน'));
      else setError(msg || t('Sign in failed', 'เข้าสู่ระบบไม่สำเร็จ'));
    } finally {
      setLoading(false);
    }
  };

  const google = async () => {
    setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (err) setError(err.message);
  };

  const sendReset = async () => {
    setResetMsg('');
    if (!resetEmail) return;
    const { error: err } = await supabase.auth.resetPasswordForEmail(resetEmail, { redirectTo: `${window.location.origin}/profile` });
    setResetMsg(err ? err.message : t('Reset link sent — check your inbox.', 'ส่งลิงก์รีเซ็ตแล้ว — กรุณาตรวจสอบอีเมล'));
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#F8FAFC]">
      {/* Branding */}
      <div className="hidden md:flex flex-1 bg-[#242A56] p-12 flex-col justify-between text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-[#ED1C24]/20 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl" />
        <div className="relative z-10">
          <div className="flex h-1.5 w-40 mb-8 rounded overflow-hidden">
            <div className="flex-1 bg-[#ED1C24]" /><div className="flex-1 bg-white" /><div className="flex-[2] bg-[#3b4a8c]" /><div className="flex-1 bg-white" /><div className="flex-1 bg-[#ED1C24]" />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-4xl drop-shadow-xl">🇹🇭</span>
            <h1 className="text-5xl font-black italic tracking-tighter [text-shadow:_0_4px_15px_rgba(0,0,0,0.5)]">Leadcore</h1>
          </div>
          <p className="text-blue-200 mt-3 font-black uppercase tracking-[0.3em] text-xs">{t('Peak Sales Performance', 'ขีดสุดแห่งประสิทธิภาพการขาย')}</p>
          <p className="text-emerald-400 mt-1 font-bold italic text-sm">{t('Elevating Every Opportunity', 'ยกระดับทุกโอกาสการขาย')}</p>
        </div>
        <div className="relative z-10 space-y-5 max-w-md">
          {[
            ['🔍', t('Find leads in any province, district or sub-district', 'ค้นหาลูกค้าได้ทุกจังหวัด อำเภอ ตำบล')],
            ['🧠', t('Auto-scored Hot / Warm / Low leads', 'ให้คะแนนลูกค้าอัตโนมัติ Hot / Warm / Low')],
            ['👥', t('Decision-maker contacts via Apollo', 'ค้นหาผู้มีอำนาจตัดสินใจผ่าน Apollo')],
            ['🔗', t('One-click push to HubSpot CRM', 'ส่งเข้า HubSpot CRM ได้ในคลิกเดียว')],
            ['🤖', t('AI sales assistant in Thai & English', 'ผู้ช่วย AI ภาษาไทยและอังกฤษ')],
          ].map(([i, s]) => (
            <div key={s} className="flex items-center gap-4">
              <span className="w-10 h-10 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-lg">{i}</span>
              <span className="text-sm font-semibold text-blue-50">{s}</span>
            </div>
          ))}
        </div>
        <div className="relative z-10 text-xs font-bold text-blue-200/50 uppercase tracking-widest">PDPA-aware · Secure sign-in</div>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md space-y-8">
          <div className="flex justify-between items-center">
            <div className="md:hidden flex items-center gap-2">
              <span className="text-2xl">🇹🇭</span>
              <span className="font-black text-2xl text-slate-800 italic tracking-tighter">Leadcore</span>
            </div>
            <div className="ml-auto flex items-center rounded-full p-1 border bg-slate-100/80 border-slate-200">
              {(['EN', 'TH'] as const).map(l => (
                <button key={l} onClick={() => setLang(l)} className={`px-5 py-1.5 rounded-full text-[10px] font-black uppercase transition-all ${lang === l ? 'bg-white shadow-md text-[#242A56]' : 'text-slate-400'}`}>{l}</button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">
              {isSignUp ? t('Join Leadcore', 'เข้าร่วม Leadcore') : t('Welcome Back', 'ยินดีต้อนรับกลับมา')}
            </h2>
            <p className="text-[#ED1C24] text-xs font-black uppercase tracking-widest">{t('Precision Sales. Peak Results.', 'การขายที่แม่นยำ สู่ผลลัพธ์อันสูงสุด')}</p>
          </div>

          {!supabaseConfigured && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
              Login is not configured yet. Set <b>VITE_SUPABASE_URL</b> and <b>VITE_SUPABASE_ANON_KEY</b> in <code>frontend/.env</code> and restart.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {isSignUp && <Input label={t('Full Name', 'ชื่อ-นามสกุล')} placeholder="Somchai Jaidee" value={fullName} onChange={e => setFullName(e.target.value)} />}
            <Input label={t('Email Address', 'ที่อยู่อีเมล')} type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} />
            <div>
              <div className="flex justify-between items-end mb-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1">{t('Password', 'รหัสผ่าน')}</label>
                {!isSignUp && (
                  <button type="button" onClick={() => { setResetEmail(email); setForgotOpen(true); }} className="text-[10px] font-bold text-blue-600 hover:text-blue-800">
                    {t('Forgot password?', 'ลืมรหัสผ่าน?')}
                  </button>
                )}
              </div>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none pr-12" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Show password">
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              {isSignUp && password && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">
                    <span>{t('Strength', 'ความปลอดภัย')}</span><span>{strength.label}</span>
                  </div>
                  <div className="flex gap-1 h-1.5">{[0, 1, 2, 3].map(i => <div key={i} className={`flex-1 rounded-full ${i < strength.score ? strength.color : 'bg-slate-200'}`} />)}</div>
                </div>
              )}
            </div>

            {!isSignUp && (
              <label className="flex items-center gap-2 text-xs font-bold text-slate-500 cursor-pointer">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="rounded" />
                {t('Remember me', 'จดจำฉัน')}
              </label>
            )}

            {error && <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-xs font-bold">{error}</div>}
            {success && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-bold">{success}</div>}

            <Button type="submit" loading={loading} className="w-full !py-4" disabled={!supabaseConfigured}>
              {isSignUp ? t('Create Account', 'สร้างบัญชี') : t('Sign In', 'เข้าสู่ระบบ')}
            </Button>
          </form>

          {GOOGLE_ENABLED && (
            <>
              <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <div className="h-px flex-1 bg-slate-200" />{t('Or continue with', 'หรือดำเนินการต่อด้วย')}<div className="h-px flex-1 bg-slate-200" />
              </div>
              <Button type="button" variant="secondary" className="w-full" onClick={google}>
                <span className="mr-2 text-base">G</span> Google
              </Button>
            </>
          )}

          <p className="text-center text-xs font-bold text-slate-500">
            {isSignUp ? t('Already have an account?', 'มีบัญชีอยู่แล้วใช่หรือไม่?') : t("Don't have an account?", 'ยังไม่มีบัญชีใช่หรือไม่?')}{' '}
            <button onClick={() => { setIsSignUp(!isSignUp); setError(''); setSuccess(''); }} className="text-[#ED1C24] font-black hover:underline">
              {isSignUp ? t('Sign In', 'เข้าสู่ระบบ') : t('Sign Up', 'ลงทะเบียน')}
            </button>
          </p>
        </div>
      </div>

      <Modal isOpen={forgotOpen} onClose={() => { setForgotOpen(false); setResetMsg(''); }} title={t('Reset Password', 'รีเซ็ตรหัสผ่าน')}>
        <div className="space-y-5">
          <p className="text-sm text-slate-500">{t("Enter your email and we'll send you a reset link.", 'กรอกอีเมลของคุณ แล้วเราจะส่งลิงก์รีเซ็ตรหัสผ่านให้')}</p>
          <Input label={t('Email Address', 'ที่อยู่อีเมล')} type="email" value={resetEmail} onChange={e => setResetEmail(e.target.value)} />
          {resetMsg && <p className="text-xs font-bold text-emerald-600">{resetMsg}</p>}
          <Button className="w-full" onClick={sendReset}>{t('Send Reset Link', 'ส่งลิงก์รีเซ็ต')}</Button>
        </div>
      </Modal>
    </div>
  );
}
