const express = require('express');
const router = express.Router();
const { pushContact } = require('../lib/notionClient');

/**
 * POST /api/linkedin/import
 * Body: { urls: string[] }
 * Just saves the LinkedIn URL to Notion — no external API needed.
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
      // Derive a display name from the URL slug (e.g. "john-doe" → "John Doe")
      const slug = url.replace(/\/$/, '').split('/in/')[1]?.split('?')[0] || '';
      const name = slug
        ? slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        : null;

      const { notionUrl } = await pushContact({
        data: {
          name,
          title: null, company: null, emails: [], phones: [],
          address: null, website: null, linkedin: url, notes: null,
          lp_type: null, investment_focus: null, flags: [],
        },
        status: 'Incomplete',
        flags: ['LinkedIn Only'],
        missing: 'Missing: title, company, email, phone',
        dupeResult: { score: 0 },
        filename: 'LinkedIn import',
      });

      results.push({ success: true, url, name, notionUrl });
    } catch (err) {
      console.error(`LinkedIn error (${url}):`, err.message);
      results.push({ success: false, url, error: err.message });
    }
  }

  res.json({ results });
});

module.exports = router;
