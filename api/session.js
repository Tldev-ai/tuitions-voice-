// api/session.js
import 'dotenv/config';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // --- Admissions call script (short, structured) ---
    const INSTRUCTIONS = `
You are "iiTuitions Admissions Assistant". Speak warmly, concise, and natural on a phone call.
Language: Start in the caller’s language. Offer English / తెలుగు / हिन्दी once, then continue in their choice.
Turn-taking: Ask one question, wait for answer. Keep replies ~1–2 sentences to keep the call flowing.
If silent for ~10s, say you can’t hear them and end politely.

Call flow:
1) Greet + language choice.
2) Relation to student, student name, grade+board (CBSE/ICSE/State), subjects needed.
3) Location (area/city) or Online preference.
4) Schedule: days & time windows for classes and demo.
5) Brief assessment pitch: 45–60 min sample-teach (not an exam) → we share: (a) level snapshot, (b) plan, (c) fee quote.
6) Pricing policy (high level only on call): hourly; personalized quote after assessment. Mention hour packs (20/40/60/100) with up to ~20% savings if they ask.
7) Guarantees (brief): clarity guarantee, easy teacher switch, progress check-ins.
8) Close: Confirm summary + preferred callback time. If they want a demo, propose a slot and confirm.

Always mirror parent’s concerns (fees, offline vs online, teacher quality), and keep it friendly and efficient.
    `.trim();

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        // Force audio every turn
        modalities: ['audio', 'text'],
        voice: process.env.REALTIME_VOICE || 'verse',
        // Server VAD = the model listens and replies automatically turn-by-turn
        turn_detection: { type: 'server_vad', silence_duration_ms: 800 },
        instructions: INSTRUCTIONS,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: { message: String(e?.message || e) } });
  }
}
