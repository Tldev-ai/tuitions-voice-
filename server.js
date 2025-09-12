// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'stream';

const app = express();
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

// ---------- Google Drive (optional) ----------
let drive = null, DRIVE_OK = false;
try {
  const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (saRaw) {
    const sa = JSON.parse(saRaw);
    if (sa.private_key?.includes('\\n')) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    const auth = new google.auth.GoogleAuth({
      credentials: sa,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    drive = google.drive({ version: 'v3', auth });
    DRIVE_OK = Boolean(process.env.DRIVE_FOLDER_ID);
    console.log('Drive OK:', sa.client_email || '(no SA email)', 'folder:', process.env.DRIVE_FOLDER_ID || '(unset)');
  } else {
    console.log('Drive not configured (no GOOGLE_SERVICE_ACCOUNT_JSON).');
  }
} catch (e) { console.error('Drive init error:', e?.message || e); }

// ---------- Realtime session (ephemeral) ----------
async function createRealtimeSession() {
  const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'realtime=v1',       // REQUIRED
    },
    body: JSON.stringify({
      model: process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview',
      voice: process.env.REALTIME_VOICE || 'verse',
      turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
      instructions: `
You are "iiTuitions Admissions Assistant". Speak warmly and clearly.
Ask which language (English / తెలుగు / हिन्दी). If no reply ~10s, say you can't hear and end the call.
Finish with a short friendly wrap-up.
`.trim(),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`/realtime/sessions ${r.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

app.get(['/session', '/api/session'], async (_req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: { message: 'OPENAI_API_KEY not set' }});
    const data = await createRealtimeSession();
    res.json(data);
  } catch (e) {
    console.error('Realtime session error:', e?.message || e);
    res.status(500).json({ error: { message: String(e?.message || e) } });
  }
});

// ---------- Upload to Drive (optional) ----------
async function handleUpload(req, res) {
  try {
    const { transcriptJson } = req.body;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    if (!DRIVE_OK || !drive) {
      return res.status(200).json({ uploaded: false, reason: 'google_drive_not_configured' });
    }

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

    const tResp = await drive.files.create({
      requestBody: { name: `iituitions-voice-${ts}.json`, parents: [process.env.DRIVE_FOLDER_ID] },
      media: { mimeType: 'application/json', body: Readable.from(Buffer.from(transcriptJson || '{}')) },
      fields: 'id, webViewLink'
    });

    res.json({ uploaded: true, audioFileId: audioId, audioLink, transcriptFileId: tResp.data.id, transcriptLink: tResp.data.webViewLink });
  } catch (e) {
    const details = e?.response?.data || e?.errors || e?.message || e;
    console.error('DRIVE UPLOAD ERROR →', details);
    res.status(500).json({ error: 'Drive upload failed', details: String(details) });
  }
}
app.post(['/upload', '/api/upload'], upload.single('audio'), handleUpload);

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server http://localhost:${PORT}`);
  console.log('CORS origin:', ALLOW_ORIGIN);
});
