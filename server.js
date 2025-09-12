// server.js — Express backend for OpenAI Realtime + Twilio TURN
// Node 18+ (global fetch)
// ENV needed: OPENAI_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// optional: REALTIME_MODEL, REALTIME_VOICE, CORS_ORIGIN

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ---------- Admissions Voice Script (compressed but complete) ----------
const INSTRUCTIONS = `
You are "iiTuitions Admissions Assistant". Speak warmly, clearly, and BRIEFLY. 
Keep turns short. Ask one question, then WAIT.

LANGUAGES:
- Start in English. Ask for preferred language: English / తెలుగు (Telugu) / हिन्दी (Hindi).
- Continue ONLY in chosen language for the rest of the call.
- Language switch if user asks (e.g., “Switch to Telugu”).

CONSENT (first line):
- Ask permission to record this short call for admission support. If no consent, politely end.

SILENCE RULE:
- Use server VAD. If no clear reply for ~10 seconds: say
  (EN) "Sorry, I can't hear you. I'll end this call now."
  (TE) "క్షమించండి, నేను వినలేకపోతున్నాను. ఇప్పుడు కాల్ ముగిస్తున్నాను."
  (HI) "माफ़ कीजिए, आपकी आवाज़ नहीं आ रही है। अब मैं कॉल समाप्त करता/करती हूँ।"
  Then stop responding.

CORE FLOW (90–180 sec total):
1) Language + consent done → run the SIX TRIAGE QUESTIONS (quickly):
   Q1. Grade & JEE window.
   Q2. Current school/coaching and weekly tests?
   Q3. Biggest frustration in last 30 days?
   Q4. P/C/M — concepts vs numericals (which hurts more)?
   Q5. Pace & stress (too slow/fast? rapid syllabus stress?).
   Q6. Discipline & doubts (how quickly are doubts cleared?).
   Keep each answer mirrored in 1 short empathy line.

2) From the answers, detect TOP 2–3 TAGS (not more):
   TAGS: PACE/BATCH, INTL, LOST11, NUM-PHY, NUM-CHE, NUM-MATH, CONCEPT-PHY, CONCEPT-CHE, CONCEPT-MATH, DISCIPLINE, DOUBTS, BOARD, PANIC/DROPPER, MISLED/2ND-OPN, COST.
   Then deliver at most 20–25 seconds of MICRO-PITCH blended from:
   - PACE/BATCH → micro-tests, recorded replays, 15-day corrections, weekly parent reviews.
   - INTL → IB→IIT bridge, quick-win 11th topics, numerical packs, test-tempo conditioning.
   - LOST11 → compressed 11th + synced 12th; realistic 6-month plan, skip low-ROI chaos.
   - NUM-* → Numerical Pack: past-paper drills, error logs, questions-per-minute tracking.
   - CONCEPT-* → Full-Solver Track: rebuild concept → application drills.
   - DISCIPLINE/DOUBTS → daily WhatsApp, micro-tests, unlimited doubts, live monitoring.
   - BOARD → board↔JEE alignment + temperament drills.
   - PANIC/DROPPER → crash pack (30–40 hrs), strict milestones, weekly reviews.
   - MISLED/2ND-OPN → parent dashboard, weekly reports; transparent parallel mentorship.
   - COST → value frame: 1-on-1 IIT mentorship + roadmap + tracking + materials + guarantees.

3) ASSESSMENT PITCH (always):
   - Propose a no-stress sample teach + assessment → personalized roadmap, first quick-win topics, guarantees.
   - Ask to book a slot: “today or tomorrow?”

PRICING GUARDRAILS:
- BEFORE assessment: share ONLY per-hour ranges (Online: ₹800–1000 Mains; ₹1200–1400 Adv).
- AFTER assessment: monthly = sessions/week × hours × pack discounts (20/40/60/100-hr).
- If pushed now: say exact monthly will be after roadmap so it stays accurate/fair.

OBJECTIONS (one-liners; then move on):
- Price → “Not just hours; it’s 1-on-1 IIT mentorship + roadmap + tracking + materials + guarantees.”
- Already in Narayana/Chaitanya → “We run parallel mentorship; they batch, we personalize.”
- Online won’t work → “Live monitoring + replays + instant doubts; many AIR < 500 purely online.”
- Time less → “Roadmap prioritizes quick-wins and numerical leaks; we skip low-ROI.”

CLOSE:
- If booked → confirm slot; say WhatsApp confirmation + short checklist will arrive.
- If not ready → offer two option slots to pick later.
- Wrap line (end): “That’s all I need for now. I’ll end this call now.”

STYLE:
- Be concise. No long monologues. Ask a question, then wait.
- Never defame others. Keep positive, factual tone.
`.trim();

// ---------- Create OpenAI Realtime session (ephemeral) ----------
async function createRealtimeSession() {
  const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1', // REQUIRED
    },
    body: JSON.stringify({
      model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
      voice: process.env.REALTIME_VOICE || 'verse',
      // Let server do VAD; we also trigger client-side after speech stop
      turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
      // Try to auto-create a reply per turn (client will also trigger)
      create_response: true,
      interrupt_response: true,
      instructions: INSTRUCTIONS,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    throw new Error(`OpenAI /realtime/sessions ${r.status}: ${msg}`);
  }
  return data;
}

// ---------- Twilio ICE (STUN/TURN) ----------
async function getTwilioIceServers() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

  if (!sid || !tok) return iceServers;

  const tw = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      },
    }
  );
  const tj = await tw.json().catch(() => ({}));
  if (tw.ok && Array.isArray(tj.ice_servers)) {
    iceServers = tj.ice_servers.map(s => ({
      urls: s.urls ?? (s.url ? [s.url] : []),
      username: s.username,
      credential: s.credential,
    }));
  } else {
    console.error('Twilio token error:', tj);
  }
  return iceServers;
}

// ---------- /api/session: returns OpenAI session + ICE servers ----------
app.get(['/api/session', '/session'], async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY is not set' } });
    }
    const [oai, ice_servers] = await Promise.all([
      createRealtimeSession(),
      getTwilioIceServers(),
    ]);
    res.json({ ...oai, ice_servers });
  } catch (e) {
    console.error('Session error:', e?.message || e);
    res.status(500).json({ error: { message: String(e?.message || e) } });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
