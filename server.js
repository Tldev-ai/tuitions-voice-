// server.js
// Node 18+ (uses global fetch)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'stream';

const app = express();

// ---- CORS ----
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: ALLOW_ORIGIN }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } });

// ========================
// Google Drive (optional)
// ========================
let drive = null;
let DRIVE_OK = false;
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
    console.log('Drive client OK for:', sa.client_email || '(no SA email)', 'folder:', process.env.DRIVE_FOLDER_ID || '(unset)');
  } else {
    console.log('Drive not configured: GOOGLE_SERVICE_ACCOUNT_JSON is empty.');
  }
} catch (e) {
  console.error('Drive init error:', e?.message || e);
}

// ========================
// OpenAI Realtime (WebRTC)
// ========================
async function createRealtimeSession() {
  const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';
  const voice = process.env.REALTIME_VOICE || 'verse';

  const r = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      // REQUIRED for Realtime
      'OpenAI-Beta': 'realtime=v1',
    },
    body: JSON.stringify({
      model,
      voice,
      turn_detection: { type: 'server_vad', silence_duration_ms: 500 },
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

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || JSON.stringify(data);
    throw new Error(`OpenAI /realtime/sessions ${r.status}: ${msg}`);
  }
  return data;
}

// Support both /session and /api/session (client uses /api/session)
app.get(['/session', '/api/session'], async (_req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY is not set' } });
    }
    const data = await createRealtimeSession();
    res.json(data);
  } catch (e) {
    console.error('Failed to create realtime session:', e?.message || e);
    res.status(500).json({ error: { message: String(e?.message || e) } });
  }
});

// ========================
// Upload audio + transcript to Drive (optional)
// ========================
async function handleUpload(req, res) {
  try {
    const { transcriptJson } = req.body;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    if (!DRIVE_OK || !drive) {
      // No-op, but don't error—avoids 404 noise in client
      return res.status(200).json({
        uploaded: false,
        reason: 'google_drive_not_configured',
        transcriptJsonLength: (transcriptJson || '').length,
      });
    }

    // Audio
    let audioId = null, audioLink = null;
    if (req.file) {
      const audioResp = await drive.files.create({
        requestBody: {
          name: `iituitions-voice-${ts}.webm`,
          parents: [process.env.DRIVE_FOLDER_ID],
        },
        media: { mimeType: req.file.mimetype || 'audio/webm', body: Readable.from(req.file.buffer) },
        fields: 'id, webViewLink',
      });
      audioId = audioResp.data.id;
      audioLink = audioResp.data.webViewLink;
    }

    // Transcript JSON
    const tResp = await drive.files.create({
      requestBody: {
        name: `iituitions-voice-${ts}.json`,
        parents: [process.env.DRIVE_FOLDER_ID],
      },
      media: { mimeType: 'application/json', body: Readable.from(Buffer.from(transcriptJson || '{}')) },
      fields: 'id, webViewLink',
    });

    res.json({
      uploaded: true,
      audioFileId: audioId,
      audioLink,
      transcriptFileId: tResp.data.id,
      transcriptLink: tResp.data.webViewLink,
    });
  } catch (e) {
    const details = e?.response?.data || e?.errors || e?.message || e;
    console.error('DRIVE UPLOAD ERROR →', details);
    res.status(500).json({ error: 'Drive upload failed', details: String(details) });
  }
}

// expose both paths so client `/api/upload` works
app.post(['/upload', '/api/upload'], upload.single('audio'), handleUpload);

// health
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('CORS origin:', ALLOW_ORIGIN);
});
