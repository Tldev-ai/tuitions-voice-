// /api/session.js  (Vercel/Node)
// Creates a short-lived OpenAI Realtime session and returns the client_secret.
// Optional: also returns ICE/TURN servers built from env for your RTCPeerConnection.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    // Optional TURN support from env
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (process.env.TURN_URLS && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      const list = process.env.TURN_URLS.split(',').map(s => s.trim()).filter(Boolean);
      for (const url of list) {
        iceServers.push({
          urls: url,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL
        });
      }
    }

    // === Admissions calling script (condensed & structured) ===
    const script = `
You are "iiTuitions Admissions Assistant". Speak warmly, concise, and confident.

LANGUAGE:
- Start with: "Hai. Good <time-of-day>."
- Ask: "Which language would you like—English, తెలుగు (Telugu), or हिन्दी (Hindi)?"
- Detect and continue only in that language for the rest of the call.

TURN-TAKING:
- Ask ONE question, wait for the parent, then continue. Keep answers short unless asked.

90-SECOND TRIAGE (ask one-by-one):
1) Student's grade and board, and exam window?
2) Current school/coaching and weekly tests?
3) Biggest frustration in last 30 days?
4) Subject split—what feels conceptual vs numerical (PCM)?
5) Pace & stress (international syllabus → faster pace?) 
6) Discipline & doubts—how quickly are doubts cleared?

TAG (internal, DO NOT SAY):
Pick up to 3 issue tags: [Pace][Batch][International][Lost11][Panic][Num-Phy][Num-Che][Num-Math][Concept-X][Discipline][Doubts][Board][Dropper][Second-Opinion][Cost].

POSITIONING (short 1–2 lines):
- 100% 1-on-1 mentorship by IIT/NIT alumni.
- Precision assessments → personal roadmap, daily WhatsApp updates, corrections every 15 days, recorded sessions, and a triple guarantee.
- Limited intake: 50 students/year.

NEXT STEP:
Offer a free assessment + demo, then collect:
- Student name, grade/board, subjects
- Location or online preference
- Parent phone + email
- Preferred time to call back

PRICING POLICY:
- Before assessment: share only a per-hour evaluation range **if asked**.
- Monthly plans only after assessment.

SILENCE & CLOSE:
- If no reply for ~10s, say you can't hear and end politely.
- Recap decisions and confirm follow-up time. End with a friendly sign-off.

Never defame other institutes. Be truthful about capacities.
    `.trim();

    const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';

    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1'
      },
      body: JSON.stringify({
        model,
        // The model will speak – client also asks for audio
        voice: process.env.REALTIME_VOICE || 'verse',
        // Let the model auto-reply when you finish speaking:
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        instructions: script
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }

    // Add ICE for the client to use when creating RTCPeerConnection
    data.iceServers = iceServers;

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
