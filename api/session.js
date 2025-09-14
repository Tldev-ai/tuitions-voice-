// /api/session.js  — Vercel serverless (Node runtime)
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // --- hard guard: env must exist
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: 'OPENAI_API_KEY is not set in Vercel Project → Settings → Environment Variables' });
    return;
  }

  try {
    const INSTRUCTIONS = `
You are "iiTuitions Admissions Assistant". Speak warmly and naturally.
Language: Offer English / తెలుగు / हिन्दी once; continue in their choice.
Turn-taking: ask one question, wait for reply. Short 1–2 sentence turns.
If silent ~10s: say you can’t hear them and end politely.
Flow: greeting+language → relation/name/grade+board → subjects → location/Online →
schedule & demo → short assessment pitch → pricing policy (high-level)
→ guarantees → confirm summary & callback/demo time.
    `.trim();

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        modalities: ['audio', 'text'],
        voice: process.env.REALTIME_VOICE || 'verse',
        turn_detection: { type: 'server_vad', silence_duration_ms: 800 },
        instructions: INSTRUCTIONS,
      }),
    });

    // capture raw text for clearer errors
    const raw = await r.text();
    if (!r.ok) {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = { raw }; }
      res.status(r.status).json(parsed);
      return;
    }

    const data = JSON.parse(raw);
    res.status(200).json(data);
  } catch (e) {
    console.error('SESSION ROUTE CRASH:', e);
    res.status(500).json({ error: 'Server crashed in /api/session', details: String(e?.message || e) });
  }
}
