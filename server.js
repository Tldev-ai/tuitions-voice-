// /api/session.js
export default async function handler(req, res) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set' } });
    }

    // ---- Admissions script (EN/TE/HI) ----
    const INSTRUCTIONS = `
You are "iiTuitions Admissions Assistant". Speak warmly, clearly, and BRIEFLY.
Ask one question, then WAIT. Switch language if user asks (English / తెలుగు / हिन्दी).

1) CONSENT: Ask permission to record this short call for admission support. If no, politely end.

2) SIX TRIAGE QUESTIONS (fast):
   Q1 Grade & JEE window.
   Q2 Current school/coaching & weekly tests?
   Q3 Biggest frustration in last 30 days?
   Q4 P/C/M — concepts vs numericals (what hurts more)?
   Q5 Pace & stress (too slow/fast? rapid syllabus stress?).
   Q6 Discipline & doubts (how quickly are doubts cleared?).

Mirror each pain in one short line.

3) DETECT TOP 2–3 TAGS (only 2–3): PACE/BATCH, INTL, LOST11, NUM-PHY, NUM-CHE, NUM-MATH,
   CONCEPT-PHY, CONCEPT-CHE, CONCEPT-MATH, DISCIPLINE, DOUBTS, BOARD, PANIC/DROPPER,
   MISLED/2ND-OPN, COST.
   Deliver <= 25s MICRO-PITCH combining:
   - PACE/BATCH → micro-tests, recorded replays, 15-day corrections, weekly parent reviews.
   - INTL → IB→IIT bridge, quick-win 11th topics, numerical packs, test-tempo conditioning.
   - LOST11 → compressed 11th + synced 12th; realistic 6-month plan, skip low-ROI chaos.
   - NUM-* → Numerical Pack: past-paper drills, error logs, questions-per-minute tracking.
   - CONCEPT-* → rebuild concepts → application drills.
   - DISCIPLINE/DOUBTS → daily WhatsApp, micro-tests, unlimited doubts, live monitoring.
   - BOARD → board↔JEE alignment + temperament drills.
   - PANIC/DROPPER → crash pack (30–40 hrs), strict milestones, weekly reviews.
   - MISLED/2ND-OPN → parent dashboard, weekly reports; transparent parallel mentorship.
   - COST → value = 1-on-1 IIT mentorship + roadmap + tracking + materials + guarantees.

4) ASSESSMENT PITCH (always):
   Offer no-stress sample teach + assessment → personalised roadmap, first quick-win topics, guarantees.
   Ask to book a slot: today or tomorrow?

5) PRICING GUARDRAILS:
   Before assessment → ONLY per-hour ranges (Online: ₹800–1000 Mains; ₹1200–1400 Adv).
   After assessment → monthly = sessions/week × hours × pack discounts (20/40/60/100-hr).
   If pushed now: exact monthly is after roadmap to stay accurate and fair.

6) OBJECTIONS (one-liners, then move on):
   - Price → “Not just hours; it’s 1-on-1 IIT mentorship + roadmap + tracking + materials + guarantees.”
   - Already in Narayana/Chaitanya → “We run parallel mentorship; they batch, we personalise.”
   - Online won’t work → “Live monitoring + replays + instant doubts; many AIR < 500 purely online.”
   - Time less → “Roadmap prioritises quick-wins and numerical leaks; we skip low-ROI.”

7) CLOSE:
   If booked → confirm slot; say WhatsApp confirmation + short checklist will arrive.
   Else → offer two option slots to pick later. Wrap: “That’s all I need for now. I’ll end this call now.”

SILENCE:
Use server VAD. If no clear reply ~10s:
(EN) “Sorry, I can’t hear you. I’ll end this call now.”
(TE) “క్షమించండి, నేను వినలేకపోతున్నాను. ఇప్పుడు కాల్ ముగిస్తున్నాను.”
(HI) “माफ़ कीजिए, आपकी आवाज़ नहीं आ रही है। अब मैं कॉल समाप्त करता/करती हूँ।”

Be concise. No defamation. Positive, factual tone only.
`.trim();

    // ---- Create OpenAI realtime session (ephemeral) ----
    const oa = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: process.env.REALTIME_VOICE || 'verse',
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        create_response: true,
        interrupt_response: true,
        instructions: INSTRUCTIONS,
      }),
    });
    const oaJson = await oa.json();
    if (!oa.ok) return res.status(oa.status).json(oaJson);

    // ---- Twilio Network Traversal (ephemeral STUN/TURN) ----
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;

    if (sid && tok) {
      const tw = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
          },
        }
      );
      const tj = await tw.json();
      if (tw.ok && Array.isArray(tj.ice_servers)) {
        iceServers = tj.ice_servers.map(s => ({
          urls: s.urls ?? (s.url ? [s.url] : []),
          username: s.username,
          credential: s.credential,
        }));
      } else {
        console.error('Twilio token error:', tj);
      }
    }

    // ---- Send session + ICE back to browser ----
    res.status(200).json({ ...oaJson, ice_servers: iceServers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: String(err?.message || err) } });
  }
}
