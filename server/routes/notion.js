const express = require('express');
const router = express.Router();
const { fetchExistingContacts, pushContact } = require('../lib/notionClient');
const { findDuplicate, intraBatchDedup } = require('../lib/dedup');
const { computeStatus, buildFlagTags, listMissing } = require('../lib/flags');

const DEDUP_THRESHOLD = parseFloat(process.env.DEDUP_THRESHOLD || '0.60');
const POSSIBLE_DUPE_THRESHOLD = parseFloat(process.env.POSSIBLE_DUPE_THRESHOLD || '0.40');

// GET /api/notion/contacts — fetch existing for cross-batch dedup
router.get('/contacts', async (req, res) => {
  try {
    const contacts = await fetchExistingContacts();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notion/push
 * Body: { cards: Array<{ data, filename }>, existingContacts: Array }
 * Runs intra-batch dedup, then cross-batch dedup, then pushes all to Notion.
 * Returns array of results in same order as input.
 */
router.post('/push', express.json({ limit: '50mb' }), async (req, res) => {
  const { cards, existingContacts = [] } = req.body;
  if (!Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ error: 'No cards provided' });
  }

  try {
    const contacts = cards.map(c => c.data);

    // Intra-batch dedup
    const intraDupes = intraBatchDedup(contacts, DEDUP_THRESHOLD);

    // Track newly pushed pages so intra-batch dupes can link to real Notion IDs
    const pushedIds = []; // index → notionId

    const results = [];

    for (let i = 0; i < cards.length; i++) {
      const { data, filename } = cards[i];
      let dupeResult = intraDupes[i];

      // If this is an intra-batch dupe, resolve the batch index to a real Notion ID
      if (dupeResult.isIntraBatch && dupeResult.matchId?.startsWith('batch:')) {
        const batchIdx = parseInt(dupeResult.matchId.split(':')[1]);
        const resolvedId = pushedIds[batchIdx];
        const resolvedUrl = resolvedId ? `https://notion.so/${resolvedId.replace(/-/g, '')}` : null;
        dupeResult = { ...dupeResult, matchId: resolvedId || dupeResult.matchId, resolvedUrl };
      }

      // Cross-batch dedup (only if not already flagged intra-batch)
      if (!dupeResult.isIntraBatch && existingContacts.length > 0) {
        const crossDupe = findDuplicate(data, existingContacts, DEDUP_THRESHOLD);
        if (crossDupe.score > dupeResult.score) {
          dupeResult = { ...crossDupe, isIntraBatch: false };
        }
      }

      const status = computeStatus(data, dupeResult);
      const flags = buildFlagTags(data, dupeResult);
      const missing = listMissing(data);

      try {
        const { notionId, notionUrl } = await pushContact({
          data, status, flags, missing, dupeResult, filename,
        });
        pushedIds[i] = notionId;
        results.push({ success: true, status, flags, notionUrl, name: data.name });
      } catch (err) {
        pushedIds[i] = null;
        results.push({ success: false, error: err.message, name: data.name });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
