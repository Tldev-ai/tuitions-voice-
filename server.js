// /api/session.js
// Node 18+ (global fetch). Serverless-friendly.

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { message: 'Method not allowed' } });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY is not set' } });
    }

    const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';
    const voice = process.env.REALTIME_VOICE || 'verse';

    // --- Your assistant script / behavior ---
    const INSTRUCTIONS = `
You are "iiTuitions Admissions Assistant". Speak warmly, clearly, and briefly.
Ask one question, then WAIT for the parent to reply. Switch language if they ask
(English / తెలుగు / हिन्दी). If you can't hear the user for ~10 seconds, apologise
and end politely.

Flow:
1) Ask consent to record for admission support. If No → end.
2) Quick triage (short questions, one at a time):
   - Grade & JEE window
   - Current school/coaching & weekly tests?
   - Biggest frustration in last 30 days?
   - P/C/M: concepts vs numericals (what’s harder?)
   - Pace & stress (too slow/fast? rapid syllabus?)
   - Discipline & doubts (how quickly are doubts cleared?)
3) Reflect top pains in one short line each.
4) Offer sample teach + assessment → personalised roadmap; ask to book today/tomorrow.
5) Pricing guardrails (ranges only before assessment; after, compute from sessions/week × hours × pack discounts).
6) Objections: reply in one line (price, already enrolled, online doubt, time).
7) Close: confirm slot or propose two options; say WhatsApp confirmation will arrive.

Silence lines (~10s):
EN: "Sorry, I can’t hear you. I’ll end this call now."
TE: "క్షమించండి, నేను వినలేకపోతున్నాను. ఇప్పుడు కాల్ ముగిస్తున్నాను."
HI: "माफ़ कीजिए, आपकी आवाज़ नहीं आ रही है। अब मैं कॉल समाप्त करता/करती हूँ।"
`.trim();

    // --- Create ephemeral OpenAI Realtime session ---
    const oaResp = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model,
        voice,
        // Let the server auto-generate a reply after each user utterance.
        create_response: true,
        interrupt_response: true,
        // Server VAD handles turn-taking.
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        // Realtime now requires audio+text (or text only) — never ['audio'] alone.
        modalities: ['audio', 'text'],
        instructions: INSTRUCTIONS,
      }),
    });

    const sessionJson = await oaResp.json();
    if (!oaResp.ok) {
      return res.status(oaResp.status).json(sessionJson);
    }

    // --- Optional: add TURN from Twilio to improve connectivity behind NAT ---
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      try {
        const twResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Tokens.json`,
          {
            method: 'POST',
            headers: {
              Authorization:
                'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
            },
          }
        );
        const twJson = await twResp.json();
        if (twResp.ok && Array.isArray(twJson.ice_servers)) {
          iceServers = twJson.ice_servers.map(s => ({
            urls: s.urls ?? (s.url ? [s.url] : []),
            username: s.username,
            credential: s.credential,
          }));
        } else {
          console.error('Twilio ICE token error:', twJson);
        }
      } catch (e) {
        console.error('Twilio request failed:', e);
      }
    }

    // Send session + ICE back to the client
    res.status(200).json({ ...sessionJson, ice_servers: iceServers });
  } catch (err) {
    console.error('Session API error:', err);
    res.status(500).json({ error: { message: String(err?.message || err) } });
  }
}
