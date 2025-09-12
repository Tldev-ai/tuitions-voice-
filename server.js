// server.js
// Node 18+ (uses global fetch)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'stream';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

// ---------- Google Drive client ----------
let drive = null;
try {
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
  if (sa.private_key?.includes('\\n')) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  drive = google.drive({ version: 'v3', auth });
  console.log('Drive client OK for:', sa.client_email || '(no SA email)');
} catch (e) {
  console.error('Drive init error:', e?.message || e);
}

// ---------- Realtime session (WebRTC) ----------
app.get('/session', async (_req, res) => {
  try {
    const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
        voice: process.env.REALTIME_VOICE || 'verse', // keep what worked
        instructions: `
You are "iiTuitions Admissions Assistant". Speak warmly and clearly.

FIRST UTTERANCE (exact pattern):
1) Say "Hai."
2) Then say a time-of-day greeting (Good morning / Good afternoon / Good evening).
3) Immediately ask: "Which language would you like to talk in — English, తెలుగు (Telugu), or हिन्दी (Hindi)?"

LANGUAGE:
- Detect their choice and continue ONLY in that language.

TURN-TAKING:
- Ask one question, then wait for the parent's reply.
- If they choose English, next question ONLY: "May I know your name?"

SILENCE:
- If no clear reply for ~10 seconds, say:
  "Sorry, I'm unable to hear you. I'll end this call now."
  Then stop speaking and remain silent.

FINISH:
- Give a short friendly summary and end with:
  "That’s all I need for now. I’ll end this call now."
        `.trim(),
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Realtime /sessions error:', data);
      return res.status(r.status).json(data);
    }
    res.json(data);
  } catch (e) {
    console.error('Failed to create realtime session:', e?.message || e);
    res.status(500).json({ error: { message: String(e?.message || e) } });
  }
});

// ---------- Upload audio + transcript to Drive ----------
app.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    const { transcriptJson } = req.body;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    // 1) audio
    let audioId = null, audioLink = null;
    if (req.file) {
      const audioResp = await drive.files.create({
        requestBody: { name: `iituitions-voice-${ts}.webm`, parents: [process.env.DRIVE_FOLDER_ID] },
        media: { mimeType: req.file.mimetype || 'audio/webm', body: Readable.from(req.file.buffer) },
        fields: 'id, webViewLink'
      });
      audioId  = audioResp.data.id;
      audioLink = audioResp.data.webViewLink;
    }

    // 2) transcript JSON
    const tResp = await drive.files.create({
      requestBody: { name: `iituitions-voice-${ts}.json`, parents: [process.env.DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/json', body: Readable.from(Buffer.from(transcriptJson || '{}')) },
      fields: 'id, webViewLink'
    });

    res.json({ audioFileId: audioId, audioLink, transcriptFileId: tResp.data.id, transcriptLink: tResp.data.webViewLink });
  } catch (e) {
    const details = e?.response?.data || e?.errors || e?.message || e;
    console.error('DRIVE UPLOAD ERROR →', details);
    res.status(500).json({ error: 'Drive upload failed', details: String(details) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
