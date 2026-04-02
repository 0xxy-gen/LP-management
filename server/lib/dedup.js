/**
 * Duplicate detection scoring.
 * Score = (nameSim × 0.35) + (emailOverlap × 0.35) + (phoneOverlap × 0.20) + (companyMatch × 0.10)
 */

function normalizeStr(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
}

function tokenSet(s) {
  return new Set(normalizeStr(s).split(/\s+/).filter(Boolean));
}

function jaccardSim(a, b) {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

function normalizePhone(p) {
  return (p || '').replace(/\D/g, '');
}

function normalizeEmail(e) {
  return (e || '').toLowerCase().trim();
}

function phoneOverlap(a, b) {
  const pa = normalizePhone(a);
  const pb = normalizePhone(b);
  if (!pa || !pb) return 0;
  // Exact match on last 8 digits (international prefix tolerance)
  const ta = pa.slice(-8);
  const tb = pb.slice(-8);
  return ta === tb ? 1 : 0;
}

function emailOverlap(emailsA, emailsB) {
  const sa = new Set((emailsA || []).map(normalizeEmail).filter(Boolean));
  const sb = new Set((emailsB || []).map(normalizeEmail).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  if (sa.size === 0 || sb.size === 0) return 0;
  for (const e of sa) if (sb.has(e)) return 1;
  return 0;
}

/**
 * Score two extracted contacts against each other.
 * Returns score 0–1.
 */
function scoreContact(a, b) {
  const nameSim = jaccardSim(a.name, b.name);
  const emailSim = emailOverlap(a.emails, b.emails);
  const phoneSim = phoneOverlap(
    (a.phones || [])[0],
    (b.phones || [])[0]
  );
  const companySim = jaccardSim(a.company, b.company);

  return (nameSim * 0.35) + (emailSim * 0.35) + (phoneSim * 0.20) + (companySim * 0.10);
}

/**
 * Convert a Notion page's properties into the same shape as extracted contact data.
 */
function notionPageToContact(page) {
  const p = page.properties || {};
  const getText = (prop) => prop?.rich_text?.[0]?.text?.content || null;
  const getTitle = (prop) => prop?.title?.[0]?.text?.content || null;

  return {
    id: page.id,
    name: getTitle(p['Name']),
    company: getText(p['Company']),
    emails: p['Email']?.email ? [p['Email'].email] : [],
    phones: p['Phone']?.phone_number ? [p['Phone'].phone_number] : [],
  };
}

/**
 * Find the best duplicate match for a contact within a list of existing contacts.
 * Returns { matchId, score } or { matchId: null, score: 0 }
 */
function findDuplicate(contact, existingContacts, dupeThreshold = 0.60) {
  let best = { matchId: null, score: 0 };
  for (const existing of existingContacts) {
    const score = scoreContact(contact, existing);
    if (score > best.score) {
      best = { matchId: existing.id, score };
    }
  }
  if (best.score < 0.40) return { matchId: null, score: 0 };
  return best;
}

/**
 * Run intra-batch dedup. Returns an array parallel to `contacts` where each
 * entry is { matchId, score, isIntraBatch }.
 * The first occurrence of a pair is always the canonical one (matchId: null).
 */
function intraBatchDedup(contacts, dupeThreshold = 0.60) {
  const results = contacts.map(() => ({ matchId: null, score: 0, isIntraBatch: false }));

  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const score = scoreContact(contacts[i], contacts[j]);
      if (score >= 0.40 && score > results[j].score) {
        // j is a duplicate of i (i is canonical)
        results[j] = { matchId: `batch:${i}`, score, isIntraBatch: true };
      }
    }
  }
  return results;
}

module.exports = { scoreContact, findDuplicate, intraBatchDedup, notionPageToContact };
