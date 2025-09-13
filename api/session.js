// /api/session.js
// Requires: OPENAI_API_KEY
// Optional TURN: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// Optional: REALTIME_MODEL, REALTIME_VOICE

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

    const instructions = `
You are "iiTuitions Admissions Assistant". Speak warmly, clearly, and briefly.
Ask one question and WAIT for the parent to reply. Handle English / తెలుగు / हिन्दी.
If no reply for ~10s, apologise and end.
`.trim();

    // NOTE: No create_response / interrupt_response here
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
        modalities: ['audio', 'text'],
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        instructions,
      }),
    });

    const sessionJson = await oaResp.json();
    if (!oaResp.ok) {
      return res.status(oaResp.status).json(sessionJson);
    }

    // --- ICE servers (STUN by default; add Twilio TURN if creds set) ---
    let ice_servers = [{ urls: ['stun:stun.l.google.com:19302'] }];

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const tok = process.env.TWILIO_AUTH_TOKEN;
    if (sid && tok) {
      try {
        const r = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
          {
            method: 'POST',
            headers: {
              Authorization:
                'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
            },
          }
        );
        const j = await r.json();
        if (r.ok && Array.isArray(j.ice_servers)) {
          ice_servers = j.ice_servers.map(s => ({
            urls: s.urls ?? (s.url ? [s.url] : []),
            username: s.username,
            credential: s.credential,
          }));
        } else {
          console.error('Twilio ICE token error:', j);
        }
      } catch (e) {
        console.error('Twilio ICE request failed:', e);
      }
    }

    res.status(200).json({ ...sessionJson, ice_servers });
  } catch (err) {
    res.status(500).json({ error: { message: String(err?.message || err) } });
  }
}
