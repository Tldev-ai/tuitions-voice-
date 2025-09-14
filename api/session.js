// /api/session.js
export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // Create an ephemeral client secret for WebRTC
    const r = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1",
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || "gpt-4o-realtime-preview",
        voice: process.env.REALTIME_VOICE || "verse",
        // DO NOT set output_audio_format for WebRTC; RTP is used automatically.
        // Default session modalities is ['text','audio'] – that’s fine.
        instructions: `
You are iiTuitions' Admissions Assistant. Speak warmly and concisely.

Script:
1) Greet + time-of-day, then: “Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?”
2) Ask one question at a time. Wait for the reply.
3) Collect: student name, grade/board, subjects, city or Online, preferred time to call back, budget (optional).
4) Offer demo class when appropriate.
5) If silent ~10s: “Sorry, I’m unable to hear you. I’ll end this call now.” then finish.

Always answer by voice and text. Keep replies short (8–12s).
        `.trim(),
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    return res.status(200).json(data);
  } catch (e) {
    console.error("session error", e);
    return res.status(500).json({ error: "FUNCTION_INVOCATION_FAILED" });
  }
}
