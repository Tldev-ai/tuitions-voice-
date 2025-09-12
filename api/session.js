// /api/session.js  (Vercel serverless function)
export default async function handler(req, res) {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1', // IMPORTANT
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: process.env.REALTIME_VOICE || 'verse',
        turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
        instructions:
          'You are "iiTuitions Admissions Assistant". Ask language (English/తెలుగు/हिन्दी), be brief, end if silent ~10s.',
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // Build ICE list: always include public STUN + optional TURN from env
    const iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    if (process.env.TURN_URLS) {
      iceServers.push({
        urls: process.env.TURN_URLS.split(',').map(s => s.trim()),
        username: process.env.TURN_USERNAME || undefined,
        credential: process.env.TURN_CREDENTIAL || undefined,
      });
    }

    res.status(200).json({ ...data, ice_servers: iceServers });
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message || e) } });
  }
}
