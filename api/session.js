// /api/session.js
export default async function handler(req, res) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // === iiTuitions Admissions Assistant — Operating Instructions ===
    const INSTRUCTIONS = `
You are iiTuitions' Admissions Assistant. Speak warmly, confidently, and concisely (8–12s per turn).
Goal: qualify parent, book a no-stress assessment/demo, capture structured lead data.

Start by asking: “Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?”

Flow:
1) 90-second triage (one question at a time):
   a) Grade & exam window?
   b) Current school/coaching & weekly tests?
   c) Biggest 30-day frustration?
   d) P/C/M split — concepts vs numericals?
   e) Pace & stress?
   f) Doubts & discipline?
2) Internally tag top 2–3 themes: [PACE][BATCH][INTL][LOST11][PANIC][NUM-PHY][NUM-CHE][NUM-MATH][CONCEPT-X][DISCIPLINE][DOUBTS][BOARD][DROPPER][MISLED][SECOND-OPINION][COST]
3) Plug-in pitch blocks (choose relevant only): micro-tests, recorded sessions, 15-day corrections, weekly parent reviews; IB→IIT bridge; compressed 11th catch-up; numerical packs; full-solver concept track; daily WA updates & unlimited doubts; board↔JEE alignment; crash packs; transparent dashboard + guarantees.
4) Pricing (strict): before assessment give **range/hr** only.
   Online Mains ₹800–₹1000/hr; Online Adv ₹1200–₹1400/hr; offline higher. Pack discounts up to ~20% (20/40/60/100 hrs).
   Monthly = sessions/week × hours/session × 4 × ₹/hr (then discount).
5) Close: propose free assessment/demo; confirm slot & WhatsApp number.
6) Silence (~10s): “I’m not able to hear you. I’ll send a quick WhatsApp follow-up. Thank you!” End call.

Always output voice + text. Keep turns short. When ready, summarise and ask to book.
Provide a final JSON summary with parent/student, grade/board/exam, subjects, mode, city, WhatsApp, preferred slots, tags, notes, and next step.
`.trim();

    // Create ephemeral session (valid ~1 minute) — MUST be called right before WebRTC connect.
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
        modalities: ["text", "audio"],           // <- be explicit
        instructions: INSTRUCTIONS,
      }),
    });

    const text = await r.text();                 // capture raw for better errors
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      // Bubble up helpful diagnostics to the client UI
      return res.status(r.status).json({
        error: "OPENAI_SESSION_ERROR",
        status: r.status,
        details: data || text,
      });
    }

    // Normal success path — contains client_secret.value
    return res.status(200).json(data);
  } catch (e) {
    console.error("session error", e);
    return res.status(500).json({
      error: "FUNCTION_INVOCATION_FAILED",
      details: String(e?.message || e),
    });
  }
}
