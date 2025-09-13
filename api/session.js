// /api/session.js
// Creates an ephemeral Realtime session token and (optionally) returns ICE/TURN servers.

export const config = { api: { bodyParser: false } };

const MODEL = process.env.REALTIME_MODEL || "gpt-4o-realtime-preview";
const VOICE = process.env.REALTIME_VOICE || "verse";

const PLAYBOOK = `
You are "iiTuitions Admissions Assistant". Be warm and efficient.
Speak only one question at a time; wait for the parent's reply.

Value:
- 1-on-1 IIT/NIT alumni mentorship
- Assessment → personalized roadmap
- Daily WhatsApp updates, corrections every 15 days
- Session recordings, Triple Guarantee, limited 50 intakes/year

Triage (sequential; one question each turn):
1) Grade & exam window?
2) Current school/coaching & weekly tests?
3) Biggest 30-day frustration?
4) Subject split (concept vs numericals) across Phy/Chem/Math?
5) Pace & stress? (intl → fast pace)
6) Discipline & doubts: are doubts cleared quickly?

Pricing policy:
- Before assessment: give only per-hour range; monthly only after assessment.
- Don’t defame competitors.
- Close: “Shall I book a 15-min assessment for you?”
`.trim();

export default async function handler(_req, res) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: { message: "OPENAI_API_KEY missing" } });

    // Create ephemeral session
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        // Keep instructions short to fit session payload
        instructions: PLAYBOOK,
        // You can set output_audio_format if you like; default is fine.
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    // Optional TURN (comma-separated URLs)
    const turnUrls = (process.env.TURN_URLS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    const iceServers = [
      { urls: ["stun:stun.l.google.com:19302"] },
      ...(turnUrls.length
        ? [{ urls: turnUrls, username: process.env.TURN_USERNAME || "", credential: process.env.TURN_CREDENTIAL || "" }]
        : []),
    ];

    return res.status(200).json({
      model: MODEL,
      client_secret: data.client_secret, // .value contains the ephemeral key
      iceServers,
    });
  } catch (e) {
    return res.status(500).json({ error: { message: e?.message || "Failed to create session" } });
  }
}
