import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ys } from '@/lib/yodsalesApi';
import { useLang } from '@/lib/i18n';

type Msg = { id: string; role: 'user' | 'assistant'; content: string };
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const STORE = 'yodsales_ai_chat';

// Minimal, safe formatting: **bold**, bullet lines, line breaks (no HTML injection)
function Formatted({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const bullet = /^\s*[-*•]\s+/.test(line);
        const parts = line.replace(/^\s*[-*•]\s+/, '').split(/(\*\*[^*]+\*\*)/g);
        const content = parts.map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <React.Fragment key={j}>{p}</React.Fragment>));
        if (!line.trim()) return <div key={i} className="h-2" />;
        return bullet ? <div key={i} className="flex gap-2"><span>•</span><span>{content}</span></div> : <div key={i}>{content}</div>;
      })}
    </>
  );
}

export default function AIAssistant() {
  const { t, lang } = useLang();
  const [params] = useSearchParams();
  const leadId = params.get('lead') || undefined;
  const company = params.get('company') || '';

  const welcome: Msg = { id: 'welcome', role: 'assistant', content: t(
    "Hi! I'm YodSales Smart Guide. I can see your LeadGen results — ask me which leads to call first, draft a LINE or email message, or plan a territory visit.",
    'สวัสดีครับ! ผม YodSales Smart Guide ผมเห็นข้อมูลลูกค้าจาก LeadGen ของคุณ — ถามได้เลยว่าควรโทรหาใครก่อน ให้ช่วยร่างข้อความ LINE/อีเมล หรือวางแผนลงพื้นที่') };

  const [messages, setMessages] = useState<Msg[]>(() => {
    try { const s = sessionStorage.getItem(STORE); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return [];
  });
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ } }, [messages]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => {
    if (company && !input) setInput(t(`Write a short first-contact message (LINE and email) for ${company}, and suggest who to ask for.`, `ช่วยร่างข้อความติดต่อครั้งแรก (LINE และอีเมล) สำหรับ ${company} และแนะนำว่าควรขอคุยกับใคร`));
  }, [company]); // eslint-disable-line

  const chips = useMemo(() => [
    { label: t('Who to call first?', 'ควรโทรหาใครก่อน?'), text: t('Looking at my hot leads, which 5 should I call first today and why?', 'จากลูกค้ากลุ่ม Hot ของฉัน ควรโทรหา 5 รายไหนก่อนวันนี้ และเพราะอะไร?') },
    { label: t('LINE message', 'ข้อความ LINE'), text: t('Write a polite Thai LINE message to introduce our printer rental service to a new business lead.', 'ช่วยเขียนข้อความ LINE ภาษาไทยแบบสุภาพ เพื่อแนะนำบริการเช่าเครื่องพิมพ์ให้ลูกค้าใหม่') },
    { label: t('Objection handling', 'รับมือข้อโต้แย้ง'), text: t('A customer says "we already have a supplier". Give me 3 good responses (Thai + English).', 'ลูกค้าบอกว่า "เรามีซัพพลายเออร์อยู่แล้ว" ช่วยให้คำตอบดีๆ 3 แบบ (ไทย + อังกฤษ)') },
    { label: t('Territory plan', 'วางแผนพื้นที่'), text: t('Based on my data, which provinces and sectors should I focus on this month?', 'จากข้อมูลของฉัน เดือนนี้ควรโฟกัสจังหวัดและกลุ่มธุรกิจไหน?') },
  ], [t]);

  async function send(text?: string) {
    const question = (text ?? input).trim();
    if (!question || loading) return;
    setError('');
    const next: Msg[] = [...messages, { id: uid(), role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { reply } = await ys.aiChat(next.map(m => ({ role: m.role, content: m.content })), lang, leadId);
      setMessages(m => [...m, { id: uid(), role: 'assistant', content: reply }]);
    } catch (e: any) {
      setError(e.message || 'AI request failed');
    } finally {
      setLoading(false);
    }
  }

  const shown = messages.length ? messages : [welcome];

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] min-h-[520px] bg-white rounded-[2rem] border border-slate-100 shadow-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#242A56] text-white flex items-center justify-center text-lg">🤖</div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#242A56]">{t('AI Sales Assistant', 'ผู้ช่วยฝ่ายขาย AI')}</p>
            <p className="text-[10px] font-bold text-slate-400">{company ? `${t('Focus', 'เน้น')}: ${company}` : t('Grounded on your LeadGen data', 'อ้างอิงข้อมูล LeadGen ของคุณ')}</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setError(''); }} className="text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500">{t('New chat', 'แชทใหม่')}</button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-auto p-6 space-y-4 bg-slate-50/40">
        {shown.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-5 py-3.5 rounded-2xl text-sm leading-relaxed shadow-sm ${m.role === 'user' ? 'bg-[#242A56] text-white font-medium rounded-br-md' : 'bg-white text-slate-800 border border-slate-100 rounded-bl-md'}`}>
              <Formatted text={m.content} />
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-widest pl-2">
            <span className="w-2 h-2 bg-[#ED1C24] rounded-full animate-pulse" /> {t('Thinking…', 'กำลังคิด…')}
          </div>
        )}
      </div>

      <div className="p-5 border-t border-slate-100">
        {error && <div className="text-red-500 text-[11px] font-black mb-3 px-2">⚠️ {error}</div>}
        <div className="relative">
          <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={t('Ask about leads, outreach, territories… (Enter to send)', 'ถามเรื่องลูกค้า การติดต่อ พื้นที่ขาย… (Enter เพื่อส่ง)')}
            className="w-full rounded-2xl px-5 py-4 pr-28 text-sm font-medium outline-none resize-none border-2 bg-white border-slate-100 text-slate-900 focus:border-[#242A56]/30" />
          <button onClick={() => send()} disabled={loading || !input.trim()}
            className="absolute right-3 bottom-3 bg-[#242A56] text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg active:scale-95 disabled:opacity-50">
            {t('Send', 'ส่ง')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {chips.map(c => (
            <button key={c.label} onClick={() => send(c.text)} disabled={loading}
              className="px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest bg-white border-slate-200 text-slate-500 hover:text-[#242A56] hover:border-[#242A56]">
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
