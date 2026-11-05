import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ys, type Profile } from './yodsalesApi';
import { useLang } from './i18n';

export type Theme = 'Light' | 'Dark' | 'Ocean' | 'Sunset' | 'Forest' | 'Thai';
export const THEMES: Theme[] = ['Light', 'Dark', 'Ocean', 'Sunset', 'Forest', 'Thai'];

type Ctx = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  profileError: string;
  theme: Theme;
  setTheme: (t: Theme) => void;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
  userName: string;
  isAdmin: boolean;
};

const SessionContext = createContext<Ctx>(null as unknown as Ctx);

function storedTheme(): Theme {
  try { const t = localStorage.getItem('yodsales_theme') as Theme; return THEMES.includes(t) ? t : 'Light'; } catch { return 'Light'; }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { setLang } = useLang();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [theme, setThemeState] = useState<Theme>(storedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme.toLowerCase();
    try { localStorage.setItem('yodsales_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const refreshProfile = useCallback(async () => {
    try {
      const p = await ys.me();
      setProfile(p);
      setProfileError('');
      if (p.theme && THEMES.includes(p.theme as Theme)) setThemeState(p.theme as Theme);
      if (p.language === 'TH' || p.language === 'EN') setLang(p.language);
    } catch (e: any) {
      setProfileError(e.message || 'Could not reach the server');
    }
  }, [setLang]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    const onExpired = () => supabase.auth.getSession().then(({ data }) => { if (!data.session) setSession(null); });
    window.addEventListener('auth-expired', onExpired);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener('auth-expired', onExpired); };
  }, []);

  useEffect(() => {
    if (session) {
      refreshProfile();
      ys.logActivity('Session Active');
    } else setProfile(null);
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (t: Theme) => {
    setThemeState(t);
    if (session) ys.updateMe({ theme: t }).catch(() => {});
  };

  const signOut = async () => {
    await ys.logActivity('Logout');
    await supabase.auth.signOut();
    setSession(null);
  };

  const meta = session?.user?.user_metadata || {};
  const userName = profile?.full_name || meta.full_name || meta.name || session?.user?.email || 'Field Agent';
  const isAdmin = Boolean(profile?.isAdmin || profile?.role === 'admin');

  return (
    <SessionContext.Provider value={{ session, profile, loading, profileError, theme, setTheme, refreshProfile, signOut, userName, isAdmin }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
