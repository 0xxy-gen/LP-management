const express = require('express');
const router = express.Router();
const multer = require('multer');
const OpenAI = require('openai');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

const EXTRACT_PROMPT = `Extract contact info from this business card. Return JSON only:
{"name":null,"title":null,"company":null,"emails":[],"phones":[],"address":null,"website":null,"linkedin":null,"notes":null,"flags":[]}
- null if not found, [] for empty arrays. All emails→emails, all phones→phones.
- flags: "name_unclear","email_partial","phone_ambiguous","multiple_contacts","card_blurry","text_obscured","non_english","handwritten_additions","not_a_card"`;

const LP_TYPES = [
  'Institutional Investor', 'Family Office', 'Fund of Funds',
  'Pension Fund', 'Sovereign Wealth Fund', 'Endowment',
  'Corporate VC', 'Angel / HNWI',
];

// --- Retry helper for 429 rate limits ---

async function withRetry(fn, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err?.status === 429 || err?.message?.includes('429');
      if (!is429 || i === maxRetries - 1) throw err;
      // Wait at least 10s on rate limit, doubling each retry
      const ms = Math.max(10000, 1000 * 2 ** i);
      console.log(`Rate limited, retrying in ${Math.round(ms / 1000)}s...`);
      await new Promise(r => setTimeout(r, ms));
    }
  }
}

// --- QR Code decoding ---

async function decodeQR(buffer) {
  try {
    const image = await Jimp.read(buffer);
    const { data, width, height } = image.bitmap;
    const code = jsQR(new Uint8ClampedArray(data), width, height);
    return code ? code.data : null;
  } catch {
    return null;
  }
}

function parseVCard(text) {
  const result = {};
  const lines = text.replace(/\r\n /g, '').split(/\r?\n/);
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    const val = rest.join(':').trim();
    const k = key.split(';')[0].toUpperCase();
    if (k === 'FN' && val)                    result.name    = val;
    if (k === 'ORG' && val)                   result.company = val.split(';')[0];
    if (k === 'TITLE' && val)                 result.title   = val;
    if ((k === 'EMAIL' || k.startsWith('EMAIL;')) && val) (result.emails = result.emails || []).push(val);
    if ((k === 'TEL'   || k.startsWith('TEL;'))   && val) (result.phones = result.phones || []).push(val);
    if ((k === 'URL'   || k.startsWith('URL;'))   && val) result.website  = val;
    if (k === 'ADR' && val) result.address = val.replace(/;+/g, ', ').replace(/^,\s*/, '').trim();
    if (k === 'X-SOCIALPROFILE' && key.toLowerCase().includes('linkedin') && val) result.linkedin = val;
  }
  return result;
}

function mergeQRData(card, qrData) {
  if (!qrData) return { card, qrNote: null };

  // vCard
  if (qrData.trim().startsWith('BEGIN:VCARD')) {
    const vcard = parseVCard(qrData);
    const merged = { ...card };
    if (!merged.name     && vcard.name)    merged.name    = vcard.name;
    if (!merged.company  && vcard.company) merged.company = vcard.company;
    if (!merged.title    && vcard.title)   merged.title   = vcard.title;
    if (!merged.website  && vcard.website) merged.website = vcard.website;
    if (!merged.address  && vcard.address) merged.address = vcard.address;
    if (!merged.linkedin && vcard.linkedin) merged.linkedin = vcard.linkedin;
    // Merge emails and phones (deduplicate)
    const allEmails = [...new Set([...(merged.emails || []), ...(vcard.emails || [])])];
    const allPhones = [...new Set([...(merged.phones || []), ...(vcard.phones || [])])];
    if (allEmails.length) merged.emails = allEmails;
    if (allPhones.length) merged.phones = allPhones;
    return { card: merged, qrNote: 'vCard QR decoded' };
  }

  // URL
  if (qrData.startsWith('http://') || qrData.startsWith('https://')) {
    const merged = { ...card };
    if (!merged.website) merged.website = qrData;
    return { card: merged, qrNote: `QR URL: ${qrData}` };
  }

  // Other (plain text, tel:, mailto:, etc.)
  return { card, qrNote: `QR data: ${qrData}` };
}

// --- Enrichment ---

async function enrichContact(name, company, title, existingAddress) {
  if (!company && !name) return { lp_type: null, investment_focus: null, geography: null };

  const prompt = `Classify this LP contact for a VC fund. Return JSON only:
{"lp_type":null,"investment_focus":null,"geography":null}
Person: ${[name, title, company, existingAddress].filter(Boolean).join(' | ')}
lp_type: one of ${LP_TYPES.join('/')} or null. investment_focus: ≤10 words or null. geography: HQ city/country or null. Use null if unsure.`;

  const response = await withRetry(() => openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  }));

  const text = response.choices[0].message.content.trim();
  const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(clean);
}

// --- Route ---

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });

  try {
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Step 1: Decode QR code if present (runs in parallel with vision)
    const [extractRes, qrData] = await Promise.all([
      withRetry(() => openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
            { type: 'text', text: EXTRACT_PROMPT },
          ],
        }],
      })),
      decodeQR(req.file.buffer),
    ]);

    // Step 2: Parse vision result
    const text = extractRes.choices[0].message.content.trim();
    const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    let card = JSON.parse(clean);

    // Step 3: Merge QR data
    const { card: mergedCard, qrNote } = mergeQRData(card, qrData);
    card = mergedCard;
    if (qrNote) card.notes = [card.notes, qrNote].filter(Boolean).join(' | ');

    // Step 4: Enrich with LP type, investment focus, and geography
    let enriched = { lp_type: null, investment_focus: null, geography: null };
    if (!card.flags?.includes('not_a_card')) {
      try {
        enriched = await enrichContact(card.name, card.company, card.title, card.address);
      } catch (e) {
        console.warn('Enrichment failed:', e.message);
      }
    }

    // Use enriched geography only if card didn't have one
    const finalCard = {
      ...card,
      ...enriched,
      address: card.address || enriched.geography,
    };

    res.json({ success: true, data: finalCard, filename: req.file.originalname });
  } catch (err) {
    console.error('Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
