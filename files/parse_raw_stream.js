const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'raw_discover_source.html'), 'utf8');

// Match all JSON objects that have "id", "title", "brand" or "companyId"
// In Next.js streaming, quotes inside strings are escaped as \"
// Let's unescape HTML & string quotes or match cleanly
const campaigns = [];
const seenIds = new Set();

// Let's find all chunks that look like: {"id":"...","title":"...","brand":"..."}
// or escaped: \"id\":\"...\",\"title\":\"...\",\"brand\":\"...\"
const regex = /(?:\\"id\\"|"id"):(?:\\"|")([0-9a-f-]{36})(?:\\"|")[^{}]*?(?:\\"title\\"|"title"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/g;

let m;
while ((m = regex.exec(html)) !== null) {
  const id = m[1];
  let title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  
  if (!seenIds.has(id) && title.length > 0) {
    seenIds.add(id);
    
    // Find the surrounding chunk for this ID to get brand, cpm, total, etc.
    const pos = m.index;
    const chunk = html.slice(pos, pos + 2500);

    const brandMatch = chunk.match(/(?:\\"brand\\"|"brand"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const brand = brandMatch ? brandMatch[1].replace(/\\"/g, '"').trim() : "Independent";

    const cpmMatch = chunk.match(/(?:\\"pricePerView\\"|"pricePerView"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const cpm = cpmMatch ? parseFloat(cpmMatch[1].replace(/[$,]/g, '')) || 1.5 : 1.5;

    const totalMatch = chunk.match(/(?:\\"totalBudget\\"|"totalBudget"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const total = totalMatch ? parseFloat(totalMatch[1].replace(/[$,]/g, '')) || 0 : 0;

    const spentMatch = chunk.match(/(?:\\"budgetSpent\\"|"budgetSpent"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const spent = spentMatch ? parseFloat(spentMatch[1].replace(/[$,]/g, '')) || 0 : 0;

    const fundedMatch = chunk.match(/(?:\\"fundedAt\\"|"fundedAt"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const fundedAt = fundedMatch ? fundedMatch[1] : null;

    const catMatch = chunk.match(/(?:\\"category\\"|"category"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const category = catMatch ? catMatch[1].replace(/\\"/g, '"').trim() : "General";

    const descMatch = chunk.match(/(?:\\"description\\"|"description"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const description = descMatch ? descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim() : `${brand} clipping campaign.`;

    const routeMatch = chunk.match(/(?:\\"whopProductRoute\\"|"whopProductRoute"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
    const whopProductRoute = routeMatch ? routeMatch[1] : null;

    campaigns.push({
      id,
      title,
      agency: brand,
      category,
      cpm,
      total,
      spent,
      fundedAt,
      description,
      whopProductRoute
    });
  }
}

console.log(`Parsed ${campaigns.length} pure authentic campaigns from stream!`);
console.log("Sample 10 items:");
campaigns.slice(0, 10).forEach((c, idx) => {
  console.log(`[${idx + 1}] "${c.title}" | Agency: "${c.agency}" | CPM: $${c.cpm} | Total: $${c.total}`);
});

fs.writeFileSync(path.join(__dirname, 'pure_stream_campaigns.json'), JSON.stringify(campaigns, null, 2), 'utf8');
