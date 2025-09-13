// /api/session.js
export default async function handler(req, res) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set' } });
    }

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
   Deliver <= 25s MICRO-PITCH tailored to those tags.

4) ASSESSMENT PITCH (always):
   Offer no-stress sample teach + assessment → personalised roadmap; ask to book a slot today/tomorrow.

5) PRICING GUARDRAILS:
   Before assessment → only per-hour ranges (Online: ₹800–1000 Mains; ₹1200–1400 Adv).
   After assessment → monthly = sessions/week × hours × pack discounts.

6) OBJECTIONS (one-liners):
   Price / Already in Narayana/Chaitanya / Online won’t work / Time less → brief, positive.

7) CLOSE:
   If booked → confirm slot; say WhatsApp confirmation + checklist will arrive.
   Else → offer two option slots to pick later. Wrap up politely.

SILENCE (~10s):
(EN) “Sorry, I can’t hear you. I’ll end this call now.”
(TE) “క్షమించండి, నేను వినలేకపోతున్నాను. ఇప్పుడు కాల్ ముగిస్తున్నాను.”
(HI) “माफ़ कीजिए, आपकी आवाज़ नहीं आ रही है। अब मैं कॉल समाप्त करता/करती हूँ।”
`.trim();

    // Create ephemeral OpenAI Realtime session
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
        create_response: true,        // <-- server auto-replies after each utterance
        interrupt_response: true,
        output_audio_format: 'pcm16',
        instructions: INSTRUCTIONS,
      }),
    });
    const oaJson = await oa.json();
    if (!oa.ok) return res.status(oa.status).json(oaJson);

    // Optional TURN via Twilio (if env set)
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

    res.status(200).json({ ...oaJson, ice_servers: iceServers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: String(err?.message || err) } });
  }
}
