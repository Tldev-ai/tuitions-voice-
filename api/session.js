// api/session.js
export const config = { runtime: 'nodejs' };

// small CORS helper (handy if you call from the browser)
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY');
    return res.status(500).json({ error: 'Missing OPENAI_API_KEY (set it in Vercel → Settings → Environment Variables)' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000); // 10s safety timeout

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: process.env.REALTIME_VOICE || 'verse',
        instructions: `
You are "iiTuitions Admissions Assistant". Speak warmly.

FIRST: say "Hai.", then a time-of-day greeting, then ask:
"Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?"
Ask one question and wait for a reply. If silent (~10s), say you can’t hear and end.
Finish with a brief wrap-up and end the call.
        `.trim(),
      }),
    });
    clearTimeout(timer);

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    return res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    // AbortError, network, etc.
    console.error('session error:', e);
    const msg = (e && e.name === 'AbortError') ? 'Upstream timeout' : String(e?.message || e);
    return res.status(500).json({ error: msg });
  }
}
