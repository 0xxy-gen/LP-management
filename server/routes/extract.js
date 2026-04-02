const express = require('express');
const router = express.Router();
const multer = require('multer');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

const EXTRACT_PROMPT = `Extract contact information from this business card image.
Return ONLY valid JSON — no markdown, no explanation:
{
  "name": null,
  "title": null,
  "company": null,
  "emails": [],
  "phones": [],
  "address": null,
  "website": null,
  "linkedin": null,
  "notes": null,
  "flags": []
}
Rules:
- Use null for any field you cannot find. Use [] for empty arrays.
- Put ALL emails in "emails", ALL phone numbers in "phones".
- In "flags", list issues as strings. Use only these values:
  "name_unclear", "email_partial", "phone_ambiguous",
  "multiple_contacts", "card_blurry", "text_obscured",
  "non_english", "handwritten_additions"
- If the image is not a business card, set all fields to null/[]
  and add "not_a_card" to flags.`;

const LP_TYPES = [
  'Institutional Investor', 'Family Office', 'Fund of Funds',
  'Pension Fund', 'Sovereign Wealth Fund', 'Endowment',
  'Corporate VC', 'Angel / HNWI',
];

async function enrichContact(name, company, title) {
  if (!company && !name) return { lp_type: null, investment_focus: null };

  const prompt = `You are classifying a potential LP (Limited Partner) for a venture capital fund.

Person: ${name || 'Unknown'}
Title: ${title || 'Unknown'}
Company: ${company || 'Unknown'}

Based on your knowledge of this organization, return ONLY valid JSON:
{
  "lp_type": null,
  "investment_focus": null
}

Rules:
- "lp_type" must be exactly one of: ${LP_TYPES.map(t => `"${t}"`).join(', ')}, or null if unknown.
- "investment_focus" is a short phrase (max 15 words) describing what they invest in, e.g. "Space tech, deep tech, climate" or null if unknown.
- Use null if you are not confident. Do not guess.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.choices[0].message.content.trim();
  const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(clean);
}

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });

  try {
    const base64 = req.file.buffer.toString('base64');
    const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

    // Step 1: Extract card data from image
    const extractRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          { type: 'text', text: EXTRACT_PROMPT },
        ],
      }],
    });

    const text = extractRes.choices[0].message.content.trim();
    const clean = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    const data = JSON.parse(clean);

    // Step 2: Enrich with LP type + investment focus using GPT knowledge
    let enriched = { lp_type: null, investment_focus: null };
    if (!data.flags?.includes('not_a_card')) {
      try {
        enriched = await enrichContact(data.name, data.company, data.title);
      } catch (e) {
        console.warn('Enrichment failed:', e.message);
      }
    }

    res.json({
      success: true,
      data: { ...data, ...enriched },
      filename: req.file.originalname,
    });
  } catch (err) {
    console.error('Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
