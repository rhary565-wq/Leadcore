// Leadcore AI Sales Assistant — Gemini, called from the server so the API key
// never reaches the browser. The assistant is grounded on the user's real
// LeadGen data (lead counts, hot leads, top industries) and, optionally, one lead.
const router = require('express').Router();
const axios = require('axios');
const { supabase } = require('../db/supabase');

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

async function dataContext(leadId) {
  const parts = [];
  try {
    const { data: leads } = await supabase.from('leads')
      .select('company_name, industry, city, lead_status, lead_score, approval_status')
      .order('created_at', { ascending: false }).limit(500);
    if (leads?.length) {
      const by = (k) => leads.reduce((m, l) => { const v = l[k] || 'Unknown'; m[v] = (m[v] || 0) + 1; return m; }, {});
      const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} (${v})`).join(', ');
      const st = by('lead_status');
      parts.push(`Recent leads in the system: ${leads.length}. Hot ${st.Hot || 0}, Warm ${st.Warm || 0}, Low ${st.Low || 0}.`);
      parts.push(`Top industries: ${top(by('industry'))}.`);
      parts.push(`Top cities: ${top(by('city'))}.`);
      const hot = leads.filter(l => l.lead_status === 'Hot').slice(0, 8).map(l => `${l.company_name} (${l.industry || '-'}, ${l.city || '-'}, score ${l.lead_score})`);
      if (hot.length) parts.push(`Some hot leads: ${hot.join('; ')}.`);
    }
    if (leadId) {
      const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
      if (lead) {
        parts.push(`Focus lead: ${lead.company_name}; industry ${lead.industry || '-'}; address ${lead.address || '-'}; phone ${lead.phone || '-'}; website ${lead.website || '-'}; rating ${lead.rating || '-'} (${lead.reviews_count || 0} reviews); score ${lead.lead_score} ${lead.lead_status}.`);
        const { data: contacts } = await supabase.from('key_contacts')
          .select('person_name, job_title, seniority').eq('lead_id', leadId).limit(10);
        if (contacts?.length) parts.push(`Known contacts: ${contacts.map(c => `${c.person_name} – ${c.job_title || ''}`).join('; ')}.`);
      }
    }
  } catch (e) {
    console.warn('[ai] context failed:', e.message);
  }
  return parts.join('\n');
}

// POST /api/ai/chat  { messages: [{role:'user'|'assistant', content}], lang: 'EN'|'TH', leadId? }
router.post('/chat', async (req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ error: 'AI is not configured (set GEMINI_API_KEY on the backend)' });

    const { messages = [], lang = 'EN', leadId } = req.body || {};
    const history = messages.filter(m => m?.content).slice(-12);
    if (!history.length) return res.status(400).json({ error: 'No message' });

    const ctx = await dataContext(leadId);
    const system = [
      'You are Leadcore Smart Guide, an AI sales assistant for B2B field sales teams in Thailand.',
      'You help with territory planning, prioritising leads, outreach messages (email, LINE, phone scripts), objection handling and next steps.',
      'Be practical, specific and concise. Use the user\'s real data below when it is relevant; never invent numbers that are not in it.',
      lang === 'TH' ? 'Reply in Thai (ภาษาไทย).' : 'Reply in English unless the user writes in Thai.',
      ctx ? `\nUser's LeadGen data:\n${ctx}` : '',
    ].join('\n');

    const contents = history.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content).slice(0, 8000) }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`;
    const { data } = await axios.post(url, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.6, topP: 0.95, maxOutputTokens: 2048 },
    }, { params: { key }, timeout: 60000 });

    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
    if (!text) return res.status(502).json({ error: 'No answer from AI — please try again' });
    res.json({ reply: text });
  } catch (err) {
    const status = err.response?.status;
    console.error('[ai]', status, err.response?.data?.error?.message || err.message);
    if (status === 429) return res.status(429).json({ error: 'AI is busy (rate limit). Please wait a moment.' });
    res.status(500).json({ error: 'AI request failed' });
  }
});

module.exports = router;
