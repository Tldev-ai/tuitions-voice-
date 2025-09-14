// /api/answer.js
export const config = { api: { bodyParser: { sizeLimit: '25mb' } } };

const SYSTEM_PROMPT = `
You are iiTuitions' Admissions Assistant. Speak warmly and concisely.

Flow:
1) Greet + time-of-day, then: “Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?”
2) Ask one question at a time. Collect: student name, grade/board, subjects, city or Online, preferred time to call back, budget (optional).
3) Offer demo class when appropriate.
4) Keep replies short (8–12 seconds). Use the same language as the caller.
5) If they stop replying for ~10s, say you'll end and keep it brief.
`;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const { audioBase64, mime, history = [] } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: 'Missing audioBase64' });

    // ---------- 1) Transcribe with Whisper ----------
    const audioBuf = Buffer.from(audioBase64, 'base64');

    // Node 18 fetch has FormData/File built-in
    const fd = new FormData();
    fd.append('model', 'whisper-1');

    // Pick a reasonable extension for Whisper
    const ext = mime?.includes('mp4') ? 'mp4' : mime?.includes('webm') ? 'webm' : 'wav';
    const file = new File([audioBuf], `speech.${ext}`, { type: mime || 'audio/webm' });
    fd.append('file', file);

    const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd
    });

    const trJson = await tr.json();
    if (!tr.ok) return res.status(tr.status).json({ error: 'transcription_failed', details: trJson });
    const transcript = trJson.text?.trim() || '';

    // ---------- 2) Get a reply (chat completion) ----------
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(Array.isArray(history) ? history : []),
      { role: 'user', content: transcript || '(no speech detected)' }
    ];

    const cr = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.6,
        messages
      })
    });

    const crJson = await cr.json();
    if (!cr.ok) return res.status(cr.status).json({ error: 'chat_failed', details: crJson });

    const replyText = crJson?.choices?.[0]?.message?.content?.trim() || 'Okay.';

    // ---------- 3) TTS (synthesize to MP3) ----------
    const sr = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'verse',
        input: replyText,
        format: 'mp3'
      })
    });

    if (!sr.ok) {
      const errText = await sr.text();
      return res.status(sr.status).json({ error: 'speech_failed', details: errText });
    }

    const mp3Buf = Buffer.from(await sr.arrayBuffer());
    const mp3Base64 = mp3Buf.toString('base64');

    return res.status(200).json({
      transcript,
      reply: replyText,
      audio: { format: 'mp3', data: mp3Base64 }
    });
  } catch (e) {
    console.error('ANSWER ERROR:', e);
    return res.status(500).json({ error: 'server_error', details: String(e?.message || e) });
  }
}
