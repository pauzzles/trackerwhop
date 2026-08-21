const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'raw_discover_source.html'), 'utf8');

// Look for all document, rules, guidelines, asset links, and detailed brief fields in the stream
const campaignsWithDocs = [];

// Match all campaigns with full description and extract any links (Google Drive, Notion, PandaDoc, Docs, Dropbox, Whop links)
const idRegex = /(?:\\"id\\"|"id"):(?:\\"|")([0-9a-f-]{36})(?:\\"|")/g;
let m;

while ((m = idRegex.exec(html)) !== null) {
  const pos = m.index;
  const chunk = html.slice(pos, pos + 3500);

  const titleMatch = chunk.match(/(?:\\"title\\"|"title"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const brandMatch = chunk.match(/(?:\\"brand\\"|"brand"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const descMatch = chunk.match(/(?:\\"description\\"|"description"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);

  if (titleMatch && descMatch) {
    const title = titleMatch[1].replace(/\\"/g, '"').trim();
    const brand = brandMatch ? brandMatch[1].replace(/\\"/g, '"').trim() : 'Independent';
    const rawDesc = descMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();

    // Extract any document links (HTTP/HTTPS)
    const urlMatches = rawDesc.match(/https?:\/\/[^\s"',]+/g) || [];

    campaignsWithDocs.push({
      title,
      brand,
      descriptionLength: rawDesc.length,
      documentLinks: urlMatches,
      sampleBrief: rawDesc.slice(0, 150)
    });
  }
}

console.log(`Found ${campaignsWithDocs.length} campaigns with creative briefs and documents!`);
console.log("Sample extracted campaigns with document/brief info:");
campaignsWithDocs.slice(0, 8).forEach((c, idx) => {
  console.log(`\n[${idx + 1}] "${c.title}" (${c.brand})`);
  console.log(`  Brief Length: ${c.descriptionLength} chars`);
  if (c.documentLinks.length > 0) {
    console.log(`  📎 Document/Asset Links: ${c.documentLinks.join(', ')}`);
  } else {
    console.log(`  📄 Text Brief: "${c.sampleBrief}..."`);
  }
});
