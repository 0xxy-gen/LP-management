const DEDUP_THRESHOLD = parseFloat(process.env.DEDUP_THRESHOLD || '0.60');
const POSSIBLE_DUPE_THRESHOLD = parseFloat(process.env.POSSIBLE_DUPE_THRESHOLD || '0.40');

/**
 * Compute the Status select value.
 */
function computeStatus(data, dupeResult) {
  if (data.flags?.includes('not_a_card') || data._extractionError) return 'Error';
  if (dupeResult.score >= DEDUP_THRESHOLD) return 'Duplicate';
  if (dupeResult.score >= POSSIBLE_DUPE_THRESHOLD) return 'Possible Dupe';
  const hasName = !!data.name;
  const hasContact = (data.emails?.length > 0) || (data.phones?.length > 0);
  if (!hasName || !hasContact) return 'Incomplete';
  return 'Clean';
}

/**
 * Build the Flags multi-select array.
 */
function buildFlagTags(data, dupeResult) {
  const tags = [];

  // Missing fields
  if (!data.name) tags.push('No Name');
  if (!data.emails?.length) tags.push('No Email');
  if (!data.phones?.length) tags.push('No Phone');
  if (!data.company) tags.push('No Company');

  // Claude-reported flags → map to Notion tag names
  const claudeFlagMap = {
    name_unclear: 'Name Unclear',
    email_partial: 'Email Partial',
    phone_ambiguous: 'Phone Ambiguous',
    card_blurry: 'Card Blurry',
    text_obscured: 'Text Obscured',
    multiple_contacts: 'Multiple Contacts',
    non_english: 'Non English',
    handwritten_additions: 'Handwritten',
    not_a_card: 'Not A Card',
  };
  for (const f of (data.flags || [])) {
    const mapped = claudeFlagMap[f];
    if (mapped && !tags.includes(mapped)) tags.push(mapped);
  }

  // Dupe flags
  if (dupeResult.score >= POSSIBLE_DUPE_THRESHOLD) {
    if (dupeResult.isIntraBatch) tags.push('Dupe: Intra-Batch');
    else tags.push('Dupe: Existing');
  }

  return tags;
}

/**
 * Build a human-readable "Missing: email, phone" string.
 */
function listMissing(data) {
  const missing = [];
  if (!data.name) missing.push('name');
  if (!data.emails?.length) missing.push('email');
  if (!data.phones?.length) missing.push('phone');
  if (!data.company) missing.push('company');
  if (!data.title) missing.push('title');
  return missing.length ? `Missing: ${missing.join(', ')}` : '';
}

/**
 * Build the Notes overflow string (extra emails/phones + Claude flags).
 */
function buildNotes(data) {
  const parts = [];
  if (data.emails?.length > 1) parts.push(`Extra emails: ${data.emails.slice(1).join(', ')}`);
  if (data.phones?.length > 1) parts.push(`Extra phones: ${data.phones.slice(1).join(', ')}`);
  if (data.notes) parts.push(data.notes);
  if (data.flags?.length) parts.push(`Claude flags: ${data.flags.join(', ')}`);
  return parts.join('\n');
}

module.exports = { computeStatus, buildFlagTags, listMissing, buildNotes };
