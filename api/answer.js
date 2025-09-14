// /api/answer.js
export const config = { runtime: 'nodejs' };

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Helper to call Chat Completions (gpt-4o-mini) then TTS (tts-1)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const { history } = await readJson(req);
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: 'history[] required' });
    }

    // 1) Text reply
    const chat = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: toOpenAIMessages(history),
        temperature: 0.6,
      }),
    });
    const chatJson = await chat.json();
    if (!chat.ok) return res.status(chat.status).json(chatJson);

    const replyText = chatJson.choices?.[0]?.message?.content?.trim() || 'Okay.';
    // 2) TTS audio
    const tts = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: process.env.REALTIME_VOICE || 'alloy', // "verse" may not be available on tts-1
        input: replyText,
        format: 'mp3',
      }),
    });
    if (!tts.ok) {
      const tErr = await tts.text();
      return res.status(tts.status).json({ error: 'TTS failed', details: tErr });
    }
    const audioArrayBuffer = await tts.arrayBuffer();
    const b64 = Buffer.from(audioArrayBuffer).toString('base64');

    res.status(200).json({ replyText, audioBase64: b64, mime: 'audio/mpeg' });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}

// ---- helpers ----
function toOpenAIMessages(msgs){
  // convert your {role, content:[{type:'text',text}]} to {role, content}
  return msgs.map(m => ({
    role: m.role,
    content: m.content?.map?.(c => c.text).join('\n') ?? ''
  }));
}

function readJson(req){
  return new Promise((resolve,reject)=>{
    let data=''; req.on('data', chunk=> data += chunk);
    req.on('end', ()=> { try{ resolve(JSON.parse(data||'{}')); }catch(e){ reject(e); }});
    req.on('error', reject);
  });
}
