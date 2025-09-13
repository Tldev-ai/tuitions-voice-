// server.js
// Node 18+ (global fetch). Run with:  node server.js
// Env required: OPENAI_API_KEY
// Optional: REALTIME_MODEL, REALTIME_VOICE
// Optional TURN (recommended on NAT/Wi-Fi): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// Optional Drive upload: GOOGLE_SERVICE_ACCOUNT_JSON, DRIVE_FOLDER_ID

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { google } from 'googleapis';

// ---------- App & middleware ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// serve static site from ./public
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// uploads held in memory (we stream them to Drive)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ---------- Google Drive (optional) ----------
let drive = null;
(() => {
  try {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      console.log('Drive: no GOOGLE_SERVICE_ACCOUNT_JSON set (upload endpoint will 501).');
      return;
    }
    const creds = JSON.parse(raw);
    if (creds.private_key?.includes('\\n')) {
      creds.private_key = creds.private_key.replace(/\\n/g, '\n');
    }
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    drive = google.drive({ version: 'v3', auth });
    console.log('Drive client ready for:', creds.client_email);
  } catch (e) {
    console.error('Drive init error:', e?.message || e);
    drive = null;
  }
})();

// ---------- Helpers ----------
async function getIceServers() {
  // Default STUN always present
  let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return iceServers; // TURN not configured

  try {
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
        },
      }
    );
    const j = await r.json();
    if (r.ok && Array.isArray(j.ice_servers)) {
      iceServers = j.ice_servers.map(s => ({
        urls: s.urls ?? (s.url ? [s.url] : []),
        username: s.username,
        credential: s.credential,
      }));
      console.log('Using Twilio ICE (TURN enabled).');
    } else {
      console.error('Twilio ICE token error:', j);
    }
  } catch (e) {
    console.error('Twilio ICE request failed:', e?.message || e);
  }
  return iceServers;
}

function buildInstructions() {
  return `
You are "iiTuitions Admissions Assistant". Speak warmly, clearly, and briefly.
Ask one question and WAIT for the parent to reply. Switch language if they ask
(English / తెలుగు / हिन्दी). If you can't hear the user for ~10 seconds, apologise
and end politely.

Flow:
1) Ask consent to record for admission support. If No → end.
2) Quick triage (one at a time):
   - Grade & JEE window
   - Current school/coaching & weekly tests?
   - Biggest frustration in last 30 days?
   - P/C/M: concepts vs numericals (what’s harder?)
   - Pace & stress (too slow/fast? rapid syllabus?)
   - Discipline & doubts (how quickly are doubts cleared?)
3) Reflect top pains in one short line each.
4) Offer sample teach + assessment → personalised roadmap; ask to book today/tomorrow.
5) Pricing guardrails (ranges only before assessment; after, compute from sessions/week × hours × pack discounts).
6) Objections: reply in one line (price, already enrolled, online doubt, time).
7) Close: confirm slot or propose two options; say WhatsApp confirmation will arrive.

Silence lines (~10s):
EN: "Sorry, I can’t hear you. I’ll end this call now."
TE: "క్షమించండి, నేను వినలేకపోతున్నాను. ఇప్పుడు కాల్ ముగిస్తున్నాను."
HI: "माफ़ कीजिए, आपकी आवाज़ नहीं आ रही है। अब मैं कॉल समाप्त करता/करती हूँ।"
`.trim();
}

// ---------- OpenAI Realtime session ----------
async function sessionHandler(_req, res) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY is not set' } });
    }
    const model = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview';
    const voice = process.env.REALTIME_VOICE || 'verse';

    const oa = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify({
        model,
        voice,
        modalities: ['audio', 'text'],
        create_response: true,               // let server auto-reply each turn
        interrupt_response: true,
        turn_detection: { type: 'server_vad', silence_duration_ms: 700 },
        instructions: buildInstructions(),
      }),
    });

    const oaJson = await oa.json();
    if (!oa.ok) {
      console.error('Realtime /sessions error:', oaJson);
      return res.status(oa.status).json(oaJson);
    }

    const iceServers = await getIceServers();
    // Return OpenAI session JSON plus ICE servers for the browser peerconnection
    return res.status(200).json({ ...oaJson, ice_servers: iceServers });
  } catch (e) {
    console.error('Failed to create realtime session:', e?.message || e);
    return res.status(500).json({ error: { message: String(e?.message || e) } });
  }
}

// Mount on both paths (client might call either)
app.get('/api/session', sessionHandler);
app.get('/session', sessionHandler);

// ---------- Upload audio + transcript to Google Drive ----------
async function uploadHandler(req, res) {
  try {
    if (!drive) {
      return res.status(501).json({ error: 'Drive not configured' });
    }
    const folderId = process.env.DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(501).json({ error: 'DRIVE_FOLDER_ID not set' });
    }

    const { transcriptJson } = req.body;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');

    let audioId = null, audioLink = null;
    if (req.file?.buffer?.length) {
      const aResp = await drive.files.create({
        requestBody: { name: `iituitions-voice-${ts}.webm`, parents: [folderId] },
        media: { mimeType: req.file.mimetype || 'audio/webm', body: Readable.from(req.file.buffer) },
        fields: 'id, webViewLink',
      });
      audioId = aResp.data.id;
      audioLink = aResp.data.webViewLink;
    }

    const tResp = await drive.files.create({
      requestBody: { name: `iituitions-voice-${ts}.json`, parents: [folderId] },
      media: { mimeType: 'application/json', body: Readable.from(Buffer.from(transcriptJson || '{}')) },
      fields: 'id, webViewLink',
    });

    return res.json({
      audioFileId: audioId,
      audioLink,
      transcriptFileId: tResp.data.id,
      transcriptLink: tResp.data.webViewLink,
    });
  } catch (e) {
    const details = e?.response?.data || e?.errors || e?.message || e;
    console.error('DRIVE UPLOAD ERROR →', details);
    return res.status(500).json({ error: 'Drive upload failed', details: String(details) });
  }
}

app.post('/api/upload', upload.single('audio'), uploadHandler);
app.post('/upload', upload.single('audio'), uploadHandler); // alias

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nServer running on http://localhost:${PORT}`);
  console.log(`Static site → http://localhost:${PORT}/`);
  console.log(`Session API → GET /api/session`);
  console.log(`Upload API  → POST /api/upload`);
});
