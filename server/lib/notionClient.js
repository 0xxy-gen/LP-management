const { Client } = require('@notionhq/client');

const LP_TYPES = [
  'Institutional Investor', 'Family Office', 'Fund of Funds',
  'Pension Fund', 'Sovereign Wealth Fund', 'Endowment',
  'Corporate VC', 'Angel / HNWI',
];

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.NOTION_DATABASE_ID;

// Rate-limit Notion writes to ~3/s
let lastWrite = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, 340 - (now - lastWrite));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastWrite = Date.now();
}

/**
 * Fetch all existing contacts for cross-batch dedup.
 * Returns array of { id, name, company, emails, phones }
 */
async function fetchExistingContacts() {
  const contacts = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_ID,
      start_cursor: cursor,
      page_size: 100,
      filter_properties: ['LP Name', 'Email', 'Phone', 'Organization'],
    });
    for (const page of res.results) {
      const p = page.properties;
      contacts.push({
        id: page.id,
        name: p['LP Name']?.title?.[0]?.text?.content || null,
        company: p['Organization']?.rich_text?.[0]?.text?.content || null,
        emails: p['Email']?.email ? [p['Email'].email] : [],
        phones: p['Phone']?.phone_number ? [p['Phone'].phone_number] : [],
      });
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return contacts;
}

/**
 * Push a single processed contact to Notion.
 */
async function pushContact({ data, status, flags, missing, dupeResult, filename }) {
  await throttle();

  const safeUrl = (u) => {
    if (!u) return null;
    return u.startsWith('http') ? u : `https://${u}`;
  };

  const properties = {
    'LP Name':     { title: [{ text: { content: data.name || '⚠ Unknown' } }] },
    'Scan Status': { select: { name: status } },
    'Scan Flags':  { multi_select: flags.map(f => ({ name: f })) },
    'Scanned':     { date: { start: new Date().toISOString().split('T')[0] } },
    'Source File': { rich_text: [{ text: { content: filename || '' } }] },
    'Stage':       { status: { name: 'Target Identified' } },
    'Relationship Strength': { select: { name: '1 - New/Cold' } },
  };

  if (data.title)             properties['Title / Role']   = { rich_text: [{ text: { content: data.title } }] };
  if (data.company)           properties['Organization']   = { rich_text: [{ text: { content: data.company } }] };
  if (data.emails?.[0])       properties['Email']          = { email: data.emails[0] };
  if (data.phones?.[0])       properties['Phone']          = { phone_number: data.phones[0] };
  if (safeUrl(data.website))  properties['Website']        = { url: safeUrl(data.website) };
  if (safeUrl(data.linkedin)) properties['LinkedIn']       = { url: safeUrl(data.linkedin) };
  if (data.address)           properties['Geography']      = { rich_text: [{ text: { content: data.address } }] };
  if (data.lp_type && LP_TYPES.includes(data.lp_type)) properties['LP Type'] = { select: { name: data.lp_type } };
  if (data.investment_focus)  properties['Investment Focus'] = { rich_text: [{ text: { content: data.investment_focus } }] };
  if (missing)                properties['Missing Fields'] = { rich_text: [{ text: { content: missing } }] };

  if (dupeResult.score >= 0.40) {
    properties['Dupe Score'] = { number: Math.round(dupeResult.score * 100) };
    // Store as URL link to the matched Notion page
    if (dupeResult.matchId && !dupeResult.matchId.startsWith('batch:')) {
      properties['Duplicate Of'] = { url: `https://notion.so/${dupeResult.matchId.replace(/-/g, '')}` };
    } else if (dupeResult.matchId?.startsWith('batch:')) {
      // Intra-batch: will be resolved to real URL after first push
      if (dupeResult.resolvedUrl) {
        properties['Duplicate Of'] = { url: dupeResult.resolvedUrl };
      }
    }
  }

  const notesContent = [
    data.emails?.length > 1 ? `Extra emails: ${data.emails.slice(1).join(', ')}` : '',
    data.phones?.length > 1 ? `Extra phones: ${data.phones.slice(1).join(', ')}` : '',
    data.notes || '',
    data.flags?.length ? `Claude flags: ${data.flags.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  if (notesContent) properties['Personal Notes'] = { rich_text: [{ text: { content: notesContent } }] };

  const page = await notion.pages.create({
    parent: { database_id: DB_ID },
    properties,
  });

  return { notionId: page.id, notionUrl: page.url };
}

module.exports = { fetchExistingContacts, pushContact };
