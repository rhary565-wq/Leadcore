import React, { createContext, useContext, useEffect, useState } from 'react';

export type Lang = 'EN' | 'TH';
type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (en: string, th: string) => string };

const LangContext = createContext<Ctx>({ lang: 'EN', setLang: () => {}, t: (en) => en });

function readStored(): Lang {
  try { return (localStorage.getItem('yodsales_lang') as Lang) === 'TH' ? 'TH' : 'EN'; } catch { return 'EN'; }
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('yodsales_lang', l); } catch { /* private mode */ }
  };
  useEffect(() => { document.documentElement.lang = lang === 'TH' ? 'th' : 'en'; }, [lang]);
  const t = (en: string, th: string) => (lang === 'TH' ? th : en);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
