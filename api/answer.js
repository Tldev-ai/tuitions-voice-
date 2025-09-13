// /api/answer.js
// Env: OPENAI_API_KEY
// Optional: TEXT_MODEL, TTS_MODEL, TTS_VOICE

export const config = { api: { bodyParser: true } };

const TEXT_MODEL = process.env.TEXT_MODEL || 'gpt-4o-mini';
const TTS_MODEL  = process.env.TTS_MODEL  || 'tts-1';           // robust TTS model
const TTS_VOICE  = process.env.TTS_VOICE  || 'verse';

function b64FromDataUrl(s) {
  const m = /^data:audio\/[\w.+-]+;base64,(.+)$/i.exec(s || '');
  return m ? m[1] : s;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Generic OpenAI fetch with retries on 429/5xx
async function oaFetch(url, opts, tries = 4, base = 350) {
  let lastErr, lastStatus = 0;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, opts);
    lastStatus = r.status;
    if (r.ok) return r;
    let body;
    try { body = await r.json(); } catch { body = await r.text(); }
    // retry only on 429 or 5xx
    if (r.status !== 429 && r.status < 500) {
      const err = new Error((body?.error?.message) || JSON.stringify(body));
      err.status = r.status;
      throw err;
    }
    lastErr = (body?.error?.message) || JSON.stringify(body);
    const jitter = Math.random() * 120;
    await sleep(base * Math.pow(2, i) + jitter);
  }
  const e = new Error(lastErr || `OpenAI error (status ${lastStatus})`);
  e.status = lastStatus || 429;
  throw e;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set' } });

    const { audio, history = [] } = req.body || {};
    if (!audio) return res.status(400).json({ error: { message: 'Missing audio' } });

    const b64 = b64FromDataUrl(audio);
    const buf = Buffer.from(b64, 'base64');

    // Quick size guard (avoid huge clips hammering Whisper)
    if (buf.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: { message: 'Audio too large (limit ~8MB). Please speak shorter.' } });
    }

    // 1) Transcribe (Whisper)
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/webm' }), 'speech.webm');
    form.append('model', 'whisper-1');

    const tr = await oaFetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form
    });

    const tj = await tr.json();
    const userText = (tj.text || '').trim();
    if (!userText) {
      return res.status(400).json({ error: { message: 'Could not transcribe speech' } });
    }

    // 2) Chat
    const systemPrompt = `
You are "iiTuitions Admissions Assistant". Be warm, concise, and helpful.
Support English / తెలుగు / हिन्दी — mirror the parent's language.
Ask one question at a time, then wait for the next recording.
If silence/unclear, ask them to repeat briefly.
`.trim();

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userText },
    ];

    const cr = await oaFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.5, messages }),
    });

    const cj = await cr.json();
    const reply = (cj.choices?.[0]?.message?.content || '').trim();

    // 3) TTS
    const tts = await oaFetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: reply || 'Sorry, I could not process that. Please try again.',
        voice: TTS_VOICE,
        format: 'mp3',
      }),
    });

    const audioBuf = Buffer.from(await tts.arrayBuffer());
    const audioDataUrl = `data:audio/mpeg;base64,${audioBuf.toString('base64')}`;

    return res.status(200).json({ ok: true, userText, reply, audio: audioDataUrl });
  } catch (err) {
    const status = err?.status || 500;
    const message =
      err?.message ||
      (typeof err === 'string' ? err : 'Unknown server error');
    return res.status(status).json({ error: { message } });
  }
}
