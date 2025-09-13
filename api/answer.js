// /api/answer.js
// Env needed: OPENAI_API_KEY
// Optional: TEXT_MODEL, TTS_MODEL, TTS_VOICE
//
// Client POSTs JSON: { audio: "data:audio/webm;base64,...", history: [{role, content}, ...] }
// Returns: { ok:true, userText, reply, audio: "data:audio/mpeg;base64,..." }

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set' } });
    }

    const { audio, history = [] } = req.body || {};
    if (!audio || typeof audio !== 'string') {
      return res.status(400).json({ error: { message: 'Missing audio data URL' } });
    }

    // ---- Decode base64 audio (data URL or raw base64) ----
    const m = audio.match(/^data:audio\/[\w.+-]+;base64,(.+)$/);
    const b64 = m ? m[1] : audio;
    const buf = Buffer.from(b64, 'base64');

    // ---- 1) Transcribe with Whisper ----
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/webm' }), 'speech.webm');
    form.append('model', 'whisper-1');

    const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const tj = await tr.json();
    if (!tr.ok) {
      return res.status(tr.status).json(tj);
    }
    const userText = (tj.text || '').trim();
    if (!userText) {
      return res.status(400).json({ error: { message: 'Could not transcribe speech' } });
    }

    // ---- 2) Generate reply (Chat Completions) ----
    const systemPrompt = `
You are "iiTuitions Admissions Assistant". Be warm, concise, and helpful.
Support English / తెలుగు / हिन्दी — mirror the parent's language.
Ask one question at a time, wait for the parent's next recording.
If they ask about fees, give ranges; say exact amount after a short assessment.
If silence/unclear, ask them to repeat briefly.
`.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userText },
    ];

    const textModel = process.env.TEXT_MODEL || 'gpt-4o-mini';
    const cr = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: textModel,
        temperature: 0.5,
        messages,
      }),
    });
    const cj = await cr.json();
    if (!cr.ok) {
      return res.status(cr.status).json(cj);
    }
    const reply = (cj.choices?.[0]?.message?.content || '').trim();

    // ---- 3) Text-to-Speech ----
    const ttsModel = process.env.TTS_MODEL || 'gpt-4o-mini-tts'; // fallback to 'tts-1' if needed
    const voice = process.env.TTS_VOICE || 'verse';

    const tts = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ttsModel,
        input: reply,
        voice,
        format: 'mp3',
      }),
    });

    if (!tts.ok) {
      const err = await tts.json().catch(() => ({}));
      return res.status(tts.status).json(err);
    }

    const audioBuf = Buffer.from(await tts.arrayBuffer());
    const audioDataUrl = `data:audio/mpeg;base64,${audioBuf.toString('base64')}`;

    return res.status(200).json({ ok: true, userText, reply, audio: audioDataUrl });
  } catch (e) {
    return res.status(500).json({ error: { message: String(e?.message || e) } });
  }
}
