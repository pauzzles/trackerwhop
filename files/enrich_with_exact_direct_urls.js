const fs = require('fs');

const raw = fs.readFileSync('campaign_direct_urls.json', 'utf8');

// Match all JSON objects in raw text
const itemRegex = /\{"avatar":.*?"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})".*?"title":"([^"]+)".*?\}/g;

const campaigns = [];
const seenIds = new Set();

// Split chunks by object delimiter
const chunks = raw.split(/\{(?="avatar":|"id":)/);

chunks.forEach(chunk => {
  const jsonText = '{' + chunk;
  const idM = jsonText.match(/"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
  const titleM = jsonText.match(/"title":"([^"]+)"/);
  const brandM = jsonText.match(/"brand":"([^"]+)"/);
  const catM = jsonText.match(/"category":"([^"]+)"/);
  const totalM = jsonText.match(/"totalBudget":"([^"]+)"/);
  const spentM = jsonText.match(/"budgetSpent":"([^"]+)"/);
  const cpmM = jsonText.match(/"pricePerView":"([^"]+)"/);
  const descM = jsonText.match(/"description":"([^"]*)"/);
  const countM = jsonText.match(/"creators":(\d+)/);

  if (idM && titleM) {
    const id = idM[1];
    if (!seenIds.has(id)) {
      seenIds.add(id);

      const title = titleM[1].replace(/\\"/g, '"').trim();
      const agency = brandM ? brandM[1].replace(/\\"/g, '"').trim() : "Featured Agency";
      const category = catM ? catM[1].trim() : "Entertainment";
      const total = totalM ? parseInt(totalM[1].replace(/[^\d.]/g, ''), 10) : 15000;
      const spent = spentM ? parseInt(spentM[1].replace(/[^\d.]/g, ''), 10) : 1000;
      const cpm = cpmM ? parseFloat(cpmM[1].replace(/[^\d.]/g, '')) : 1.5;
      const desc = descM ? descM[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim() : `${agency} ${category} campaign.`;
      const count = countM ? countM[1] : "350";

      campaigns.push({
        id,
        url: `https://contentrewards.com/discover/${id}`,
        title,
        agency,
        category,
        description: desc,
        total: total || 10000,
        spent: spent || 0,
        cpm: cpm || 1.5,
        age: "Active",
        count,
        key: `${agency}::${title}`
      });
    }
  }
});

console.log(`Extracted ${campaigns.length} campaigns directly from raw dump!`);

// Let's also load the existing 509 campaigns in campaigns.json and map them to their exact IDs
const oldCampaigns = JSON.parse(fs.readFileSync('../campaigns.json', 'utf8'));
const titleIdMap = new Map();
campaigns.forEach(c => {
  titleIdMap.set(c.title.toLowerCase(), c.id);
  titleIdMap.set(c.title.slice(0, 20).toLowerCase(), c.id);
});

let exactMatchCount = 0;
oldCampaigns.forEach(c => {
  const cleanTitle = (c.title || '').trim().toLowerCase();
  let matchedId = titleIdMap.get(cleanTitle);
  if (!matchedId) {
    for (const [t, id] of titleIdMap.entries()) {
      if (cleanTitle.includes(t) || t.includes(cleanTitle)) {
        matchedId = id;
        break;
      }
    }
  }

  if (matchedId) {
    c.id = matchedId;
    c.url = `https://contentrewards.com/discover/${matchedId}`;
    exactMatchCount++;
  } else if (!c.id) {
    // If not matched, keep discover
    c.url = `https://contentrewards.com/discover`;
  }
});

console.log(`Enriched ${exactMatchCount} / ${oldCampaigns.length} existing campaigns with direct UUID URLs!`);

fs.writeFileSync('../campaigns.json', JSON.stringify(oldCampaigns, null, 2));
fs.writeFileSync('campaigns.json', JSON.stringify(oldCampaigns, null, 2));
