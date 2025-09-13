// /api/answer.js
// Env: OPENAI_API_KEY
// Optional: TEXT_MODEL, TTS_MODEL, TTS_VOICE

export const config = { api: { bodyParser: true } };

const TEXT_MODEL = process.env.TEXT_MODEL || 'gpt-4o-mini';
const TTS_MODEL  = process.env.TTS_MODEL  || 'tts-1';
const TTS_VOICE  = process.env.TTS_VOICE  || 'verse';

function b64FromDataUrl(s) {
  const m = /^data:audio\/[\w.+-]+;base64,(.+)$/i.exec(s || '');
  return m ? m[1] : s;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// --- Playbook prompt (extracted from your PDF) ---
const PLAYBOOK_SYSTEM = `
You are "iiTuitions Admissions Assistant".
Follow this sales playbook, be warm, crisp, and strictly conversational.
Mirror the parent's language (English / తెలుగు / हिन्दी) automatically.

MISSION & POSITIONING:
- 100% 1-on-1 mentorship by IIT/NIT alumni
- Precision assessments → personalised roadmaps
- Daily WhatsApp updates
- Course corrections every 15 days
- Recorded sessions
- *Triple Guarantee*
- Limited intake: 50 students / year

CALL STYLE:
- Ask exactly ONE question at a time; wait for the next voice clip.
- Keep replies short (<= 2 sentences) unless asked.
- If unclear/silent, politely ask them to repeat.

90-SECOND TRIAGE — ask these in order (one by one), capture answers as you go:
1) Grade & target exam window
2) Current school/coaching & weekly tests?
3) Biggest 30-day frustration
4) Subject split (concept vs numericals) across Physics/Chemistry/Math
5) Pace & stress (intl board → fast pace?)
6) Discipline & doubts — are doubts cleared quickly?

TAG DETECTION:
- After each answer, quietly infer up to 2–3 tags from:
  [PACE][BATCH][INTL][LOST11][PANIC][NUM-PHY][NUM-CHE][NUM-MATH]
  [CONCEPT-X][DISCIPLINE][DOUBTS][BOARD][DROPPER][MISLED][2ND-OPN][COST]
- Use tags to pick the next best question or a tiny pitch line.

POLICY:
- Anchor to: assessment → roadmap → guarantees.
- Pricing AFTER a short assessment. (Per-hour only before assessment; monthly only after.)
- Never defame other institutes; use local names only conversationally.
- Close with a clear next step (book a slot or offer 2 options).

When appropriate, suggest: “Shall I book a 15-minute assessment call?”.
`.trim();

// Small helper to synthesize any text
async function tts(key, text) {
  const r = await oaFetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      voice: TTS_VOICE,
      format: 'mp3',
    }),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:audio/mpeg;base64,${buf.toString('base64')}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set' } });

    const { audio, history = [], greet } = req.body || {};

    // --- GREETING path: speak first without user audio ---
    if (greet) {
      const greeting = `Hai. Good ${new Date().getHours()<12?'morning':new Date().getHours()<17?'afternoon':'evening'}!
This is iiTuitions admissions assistant. We offer 1-on-1 mentorship by IIT/NIT alumni with a triple guarantee.
Which language would you like — English, తెలుగు (Telugu), or हिन्दी (Hindi)?
To begin, may I know the student's grade and target exam window?`;
      const audioUrl = await tts(key, greeting);
      return res.status(200).json({ ok: true, userText: '', reply: greeting, audio: audioUrl });
    }

    // --- Regular path requires audio ---
    if (!audio) return res.status(400).json({ error: { message: 'Missing audio' } });

    const b64 = b64FromDataUrl(audio);
    const buf = Buffer.from(b64, 'base64');

    if (buf.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: { message: 'Audio too large (limit ~8MB). Please speak shorter.' } });
    }

    // 1) Transcribe
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

    // 2) Chat (playbook-aware)
    const messages = [
      { role: 'system', content: PLAYBOOK_SYSTEM },
      ...history,
      { role: 'user', content: userText },
    ];

    const cr = await oaFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.4, messages }),
    });
    const cj = await cr.json();
    const reply = (cj.choices?.[0]?.message?.content || '').trim() ||
      'Thanks. Could you please repeat that once more clearly?';

    // 3) TTS
    const audioUrl = await tts(key, reply);

    return res.status(200).json({ ok: true, userText, reply, audio: audioUrl });
  } catch (err) {
    const status = err?.status || 500;
    const message = err?.message || 'Unknown server error';
    return res.status(status).json({ error: { message } });
  }
}
