const express = require('express');
const router = express.Router();
const axios = require('axios');
const OpenAI = require('openai');
const { pushContact } = require('../lib/notionClient');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const LP_TYPES = [
  'Institutional Investor', 'Family Office', 'Fund of Funds',
  'Pension Fund', 'Sovereign Wealth Fund', 'Endowment',
  'Corporate VC', 'Angel / HNWI',
];

async function fetchLinkedInProfile(url) {
  const res = await axios.get('https://nubela.co/proxycurl/api/v2/linkedin', {
    params: { url, use_cache: 'if-present' },
    headers: { Authorization: `Bearer ${process.env.PROXYCURL_API_KEY}` },
  });
  return res.data;
}

async function enrichProfile(name, company, title) {
  if (!company && !name) return { lp_type: null, investment_focus: null };
  const prompt = `Classify this LP contact for a VC fund. Return JSON only:
{"lp_type":null,"investment_focus":null}
Person: ${[name, title, company].filter(Boolean).join(' | ')}
lp_type: one of ${LP_TYPES.join('/')} or null. investment_focus: ≤10 words or null. Use null if unsure.`;

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.choices[0].message.content.trim().replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(text);
}

/**
 * POST /api/linkedin/import
 * Body: { urls: string[] }
 */
router.post('/import', express.json(), async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'No URLs provided' });
  }

  const results = [];

  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;

    try {
      const profile = await fetchLinkedInProfile(url);

      const name = profile.full_name || null;
      const title = profile.occupation || profile.experiences?.[0]?.title || null;
      const company = profile.experiences?.[0]?.company || null;
      const geography = [profile.city, profile.country_full_name].filter(Boolean).join(', ') || null;
      const emails = profile.personal_emails?.length ? profile.personal_emails
                   : profile.work_email ? [profile.work_email] : [];
      const notes = [profile.headline, profile.summary].filter(Boolean).join('\n') || null;

      const enriched = await enrichProfile(name, company, title).catch(() => ({ lp_type: null, investment_focus: null }));

      const data = {
        name, title, company, emails, phones: [], address: geography,
        website: null, linkedin: url, notes,
        lp_type: enriched.lp_type, investment_focus: enriched.investment_focus,
        flags: [],
      };

      const { notionUrl } = await pushContact({
        data,
        status: name ? 'Clean' : 'Incomplete',
        flags: name ? [] : ['No Name'],
        missing: name ? '' : 'Missing: name',
        dupeResult: { score: 0 },
        filename: 'LinkedIn import',
      });

      results.push({ success: true, url, name, company, title, notionUrl });
    } catch (err) {
      console.error(`LinkedIn error (${url}):`, err.message);
      results.push({ success: false, url, error: err.response?.data?.description || err.message });
    }
  }

  res.json({ results });
});

module.exports = router;
