// /api/session.js
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
  const voice = process.env.REALTIME_VOICE || 'verse';

  const instructions = `
You are the "iiTuitions Admissions Assistant". Speak warmly and concisely.
Language: continue in the language the caller chooses (English, తెలుగు, हिन्दी).
Ask one question at a time and wait. Collect: name, grade+board, subjects & mode (Home/Online), location (if Home), preferred call/demo time, phone, optional budget. Give short fee ranges only if asked. If silent ~10s, say you can't hear and end. Finish with a short recap and end the call.
  `.trim();

  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model,
        voice,
        modalities: ['audio','text'],
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        instructions,
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    res.status(200).json({
      client_secret: data.client_secret,
      model,
      voice,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
