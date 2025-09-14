// /api/session.js
export const config = { runtime: 'nodejs' };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Minimal, **valid** payload for the sessions API.
// Do NOT include unknown fields like "create_response" (that causes "Unknown parameter" errors).
const SYSTEM_INSTRUCTIONS = `
You are "iiTuitions Admissions Assistant". Speak warmly.
Follow this call flow strictly and be concise:

1) Greet: "Hai." + "Good <time-of-day>." Then ask:
   "Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?"
2) One question at a time. Collect:
   - Student name
   - Grade/board
   - Subjects
   - Online or home-tuition preference and location (if home)
   - Preferred time to call back
   - Budget range (optional)
3) Offer info: course/batch options & fees range; offer a demo time.
4) If silent ~10s, say you can't hear and will end soon.
5) Close politely.

Always switch to the caller's chosen language.
`;

export default async function handler(_req, res) {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: process.env.REALTIME_VOICE || 'verse',
        modalities: ['audio','text'],
        instructions: SYSTEM_INSTRUCTIONS,
        // Helpful defaults:
        turn_detection: { type: 'server_vad', threshold: 0.5, silence_duration_ms: 500 },
        // Let the model actually produce audio:
        output_audio_format: 'pcm16',
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
