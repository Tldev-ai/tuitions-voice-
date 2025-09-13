// /api/session.js
// Vercel/Node 18+ (uses global fetch)

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    return;
  }

  const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
  const voice = process.env.REALTIME_VOICE || 'verse';

  // Short, strict “call flow” script (from your PDF condensed)
  const instructions = `
You are the "iiTuitions Admissions Assistant". Speak **warmly** and **briefly**.
Rules:
- Use natural pauses. Keep replies under 12 seconds.
- Continue in the language the caller chooses (English, తెలుగు (Telugu), or हिन्दी (Hindi)).
- Always wait for the parent to finish; use server VAD (no barge-in).

Call flow:
1) Greet: "Hai. Good <morning/afternoon/evening>. Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?"
2) Collect, one by one (one question at a time):
   • Parent/Student name
   • Grade & Board (CBSE/ICSE/State)
   • Subjects and mode (Home tutoring or Online)
   • Location (if home tutoring) OR confirm "Online"
   • Preferred time to call back / demo slot
   • Phone number
   • Any budget range (optional)
3) Fees: give a tight range only if asked; avoid long monologues.
4) If demo requested, confirm a tentative slot.
5) End: Short recap + "That’s all I need for now. I’ll end this call now."

If there is 10 seconds of silence, say:
"Sorry, I’m not able to hear you. I’ll end this call now."
Then stop speaking.
  `.trim();

  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model,
        voice,
        modalities: ['audio', 'text'],
        // Tell the server to use its VAD for turns
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        // Keep these simple; the browser handles SDP codecs.
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        instructions,
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json(data);
    }
    // Return the ephemeral client secret to the browser
    res.status(200).json({
      client_secret: data.client_secret,
      model,
      voice,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
