// api/upload.js
import Busboy from 'busboy';
import { google } from 'googleapis';
import { Readable } from 'node:stream';

export const config = { runtime: 'nodejs' };

const MAX_BYTES = 25 * 1024 * 1024; // 25MB safety cap

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function requireEnv() {
  const errors = [];
  if (!process.env.DRIVE_FOLDER_ID) errors.push('DRIVE_FOLDER_ID');
  if (!process.env.GSA_JSON_B64 && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    errors.push('GSA_JSON_B64 or GOOGLE_SERVICE_ACCOUNT_JSON');
  }
  if (errors.length) {
    throw new Error(`Missing env vars: ${errors.join(', ')} (set in Vercel → Project → Settings → Environment Variables)`);
  }
}

function getServiceAccountCreds() {
  try {
    if (process.env.GSA_JSON_B64) {
      const json = Buffer.from(process.env.GSA_JSON_B64, 'base64').toString('utf8');
      return JSON.parse(json);
    }
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    throw new Error('Invalid Service Account JSON (check escaping or use Base64 in GSA_JSON_B64)');
  }
}

function parseForm(req) {
  return new Promise((resolve, reject) => {
    // Content-Type check
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) {
      return reject(new Error('Content-Type must be multipart/form-data'));
    }

    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_BYTES } });

    let audioBuffer = Buffer.alloc(0);
    let audioMime = 'audio/webm';
    let transcriptJson = '{}';
    let tooLarge = false;

    busboy.on('file', (_name, file, info) => {
      audioMime = info?.mimeType || 'audio/webm';
      file.on('data', (d) => {
        audioBuffer = Buffer.concat([audioBuffer, d]);
        if (audioBuffer.length > MAX_BYTES) {
          tooLarge = true; // fallback if 'limit' doesn’t trigger
          file.unpipe(); file.resume();
        }
      });
      file.on('limit', () => { tooLarge = true; });
    });

    busboy.on('field', (name, val) => {
      if (name === 'transcriptJson') transcriptJson = String(val ?? '{}');
    });

    busboy.on('error', reject);
    busboy.on('finish', () => {
      if (tooLarge) return reject(Object.assign(new Error('Audio file too large'), { status: 413 }));
      resolve({ audioBuffer, audioMime, transcriptJson });
    });

    req.pipe(busboy);
  });
}

export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    requireEnv();

    // Parse form safely
    const { audioBuffer, audioMime, transcriptJson } = await parseForm(req);

    // Build Google Drive client
    const creds = getServiceAccountCreds();
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });

    // Upload(s)
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const folderId = process.env.DRIVE_FOLDER_ID;

    let audioFileId = null;
    if (audioBuffer.length) {
      const a = await drive.files.create({
        requestBody: { name: `iituitions-voice-${ts}.webm`, parents: [folderId] },
        media: { mimeType: audioMime, body: Readable.from(audioBuffer) },
        fields: 'id',
      });
      audioFileId = a.data.id;
    }

    const t = await drive.files.create({
      requestBody: { name: `iituitions-voice-${ts}.json`, parents: [folderId] },
      media: { mimeType: 'application/json', body: Readable.from(Buffer.from(transcriptJson || '{}')) },
      fields: 'id',
    });

    return res.status(200).json({ audioFileId, transcriptFileId: t.data.id });
  } catch (e) {
    // Surface Google Drive API errors clearly
    const status = e?.status || e?.code || 500;
    const message =
      e?.errors?.[0]?.message ||
      e?.response?.data?.error?.message ||
      e?.message ||
      'Drive upload failed';
    console.error('upload error:', e);
    return res.status(Number.isInteger(status) ? status : 500).json({ error: message });
  }
}
