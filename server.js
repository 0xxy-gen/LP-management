const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { Client } = require('@notionhq/client');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Load .env if present
if (fs.existsSync(path.join(__dirname, '.env'))) {
  require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...vals] = line.split('=');
      if (key && vals.length) process.env[key.trim()] = vals.join('=').trim();
    });
}

const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '31b91a1c-e62c-805e-b39a-fa8053d7828a';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files allowed'));
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/scan', upload.single('namecard'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  try {
    // Step 1: Extract contact info using Claude
    const base64Image = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype;

    const extraction = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64Image }
          },
          {
            type: 'text',
            text: `Extract all contact information from this business namecard image.
Return ONLY a JSON object with these fields (use null if not found):
{
  "fullName": "string",
  "organization": "string",
  "jobTitle": "string",
  "email": "string",
  "phone": "string",
  "website": "string",
  "linkedin": "string",
  "geography": "string (city/country if present on card)",
  "notes": "string (address, other social handles, or any other info on the card)"
}
Return only the JSON, no other text.`
          }
        ]
      }]
    });

    let contactData;
    try {
      const jsonText = extraction.content[0].text.trim();
      contactData = JSON.parse(jsonText);
    } catch {
      return res.status(422).json({ error: 'Could not parse contact info from image. Is this a namecard?' });
    }

    // Step 2: Create Notion page mapped to Beyond Earth Ventures LP database schema
    const safeUrl = url => url && (url.startsWith('http') ? url : `https://${url}`);

    const properties = {
      'LP Name': { title: [{ text: { content: contactData.fullName || 'Unknown' } }] },
      'Stage': { status: { name: 'Target Identified' } },
      'Relationship Strength': { select: { name: '1 - New/Cold' } }
    };

    if (contactData.organization) properties['Organization'] = { rich_text: [{ text: { content: contactData.organization } }] };
    if (contactData.jobTitle) properties['Title / Role'] = { rich_text: [{ text: { content: contactData.jobTitle } }] };
    if (contactData.email) properties['Email'] = { email: contactData.email };
    if (contactData.phone) properties['Phone'] = { phone_number: contactData.phone };
    if (contactData.website) properties['Website'] = { url: safeUrl(contactData.website) };
    if (contactData.linkedin) properties['LinkedIn'] = { url: safeUrl(contactData.linkedin) };
    if (contactData.geography) properties['Geography'] = { rich_text: [{ text: { content: contactData.geography } }] };

    const notesLines = [];
    if (contactData.notes) notesLines.push(contactData.notes);
    if (req.body.source) notesLines.push(`Met at: ${req.body.source}`);
    if (notesLines.length) properties['Personal Notes'] = { rich_text: [{ text: { content: notesLines.join('\n') } }] };

    if (req.body.source) properties['Event Opportunities'] = { rich_text: [{ text: { content: req.body.source } }] };

    const notionPage = await notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties
    });

    res.json({
      success: true,
      contact: contactData,
      notionUrl: notionPage.url
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to process namecard' });
  }
});

app.listen(PORT, () => {
  console.log(`Namecard scanner running at http://localhost:${PORT}`);
});
