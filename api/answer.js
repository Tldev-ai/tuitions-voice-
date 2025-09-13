// /api/answer.js — Next.js/Vercel API Route
// Env required: OPENAI_API_KEY
// Optional: TEXT_MODEL, TTS_MODEL, TTS_VOICE

export const config = { api: { bodyParser: true } };

const TEXT_MODEL = process.env.TEXT_MODEL || "gpt-4o-mini";
const TTS_MODEL  = process.env.TTS_MODEL  || "tts-1";
const TTS_VOICE  = process.env.TTS_VOICE  || "alloy";

const PLAYBOOK_SYSTEM = `
You are "iiTuitions Admissions Assistant". Be warm, concise, and strictly conversational.
Mirror the parent's language (English/తెలుగు/हिन्दी). Ask ONE question at a time.

Value props to weave in naturally:
- 1-on-1 mentorship by IIT/NIT alumni
- Precision assessment → personalised roadmap
- Daily WhatsApp updates; corrections every 15 days
- Recorded sessions
- Triple Guarantee (performance, attendance, satisfaction)
- Limited intake (50 students/year)

90-second triage (ask in order; one at a time):
1) Grade & target exam window
2) Current school/coaching & weekly tests?
3) Biggest 30-day frustration
4) Subject split (concept vs numericals) across Phy/Che/Math
5) Pace & stress
6) Discipline & doubts

After each parent reply, infer 2–3 lightweight tags privately from:
[PACE][BATCH][INTL][LOST11][PANIC][NUM-PHY][NUM-CHE][NUM-MATH][CONCEPT-X][DISCIPLINE][DOUBTS][BOARD][DROPPER][MISLED][2ND-OPN][COST].

Policy:
- Anchor to assessment → roadmap → guarantees.
- Pricing only after a short assessment (per-hour before, monthly after).
- Never defame competitors.
- Close with the next step: "Shall I book a 15-min assessment for you?"
`.trim();

function b64FromDataUrl(s) {
  const m = /^data:audio\/[\w.+-]+;base64,(.+)$/i.exec(s || "");
  return m ? m[1] : s;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function oaFetch(url, opts, tries = 4, base = 350) {
  let lastErr = null, lastStatus = 0;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, opts);
    lastStatus = r.status;
    if (r.ok) return r;

    let body; try { body = await r.json(); } catch { body = await r.text(); }
    const msg = body?.error?.message || (typeof body === "string" ? body : JSON.stringify(body));

    if (r.status === 429 || r.status >= 500) {
      lastErr = msg;
      const backoff = base * Math.pow(2, i) + Math.random() * 120;
      await sleep(backoff);
      continue;
    }
    const e = new Error(msg || `OpenAI error (${r.status})`); e.status = r.status; throw e;
  }
  const e = new Error(lastErr || `OpenAI error (${lastStatus})`); e.status = lastStatus || 429; throw e;
}

async function tts({ key, text }) {
  const r = await oaFetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, format: "mp3" })
  });
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:audio/mpeg;base64,${buf.toString("base64")}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: { message: "Method not allowed" }});
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: { message: "OPENAI_API_KEY is missing" }});

    const { greet, audio, history = [] } = req.body || {};

    // GREETING
    if (greet) {
      try {
        const h = new Date().getHours();
        const pod = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
        const greeting =
`Hai. Good ${pod}! This is iiTuitions admissions assistant.
We offer 1-on-1 mentorship by IIT/NIT alumni with a triple guarantee.
Which language would you like — English, తెలుగు, or हिन्दी?
To begin, may I know the student's grade and target exam window?`;

        const audioUrl = await tts({ key, text: greeting });
        return res.status(200).json({ ok: true, reply: greeting, audio: audioUrl });
      } catch (e) {
        return res.status(e?.status || 500).json({ error: { message: e?.message || "Greeting TTS failed" }});
      }
    }

    // TURN
    if (!audio) return res.status(400).json({ error: { message: "Missing audio" }});
    const b64 = b64FromDataUrl(audio);
    const buf = Buffer.from(b64, "base64");
    if (buf.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: { message: "Audio too large (max ~8MB). Please speak shorter." }});
    }

    // Transcribe
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/webm" }), "speech.webm");
    form.append("model", "whisper-1");

    const tr = await oaFetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form
    });
    const tj = await tr.json();
    const userText = (tj.text || "").trim();
    if (!userText) return res.status(400).json({ error: { message: "Could not transcribe speech" }});

    // Chat
    const messages = [
      { role: "system", content: PLAYBOOK_SYSTEM },
      ...history,
      { role: "user", content: userText }
    ];
    const cr = await oaFetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: TEXT_MODEL, temperature: 0.4, messages })
    });
    const cj = await cr.json();
    const reply = (cj.choices?.[0]?.message?.content || "").trim()
      || "Thanks. Could you please repeat that once more clearly?";

    // TTS
    const audioUrl = await tts({ key, text: reply });

    return res.status(200).json({ ok: true, userText, reply, audio: audioUrl });
  } catch (err) {
    return res.status(err?.status || 500).json({ error: { message: err?.message || "Unknown server error" }});
  }
}
