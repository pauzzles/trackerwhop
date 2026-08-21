const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let rawText = '';
  page.on('response', async (res) => {
    if (res.url().includes('discover') || res.url().includes('_next')) {
      try {
        const t = await res.text();
        if (t.includes('ROOBET') || t.includes('Call of Duty') || t.includes('694c6333') || t.includes('title')) {
          rawText += '\n' + t;
        }
      } catch (e) {}
    }
  });

  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);
  const html = await page.content();
  rawText += '\n' + html;

  const idMap = new Map();

  // Pattern 1: unescaped "id":"UUID" ... "title":"..."
  const regex1 = /"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^}]*?"title":"([^"]+)"/g;
  let m;
  while ((m = regex1.exec(rawText)) !== null) {
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').trim();
    if (!idMap.has(title.toLowerCase())) {
      idMap.set(title.toLowerCase(), id);
    }
  }

  // Pattern 2: escaped \"id\":\"UUID\" ... \"title\":\"...\"
  const regex2 = /\\"id\\":\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\"[^}]*?\\"title\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/g;
  while ((m = regex2.exec(rawText)) !== null) {
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (!idMap.has(title.toLowerCase())) {
      idMap.set(title.toLowerCase(), id);
    }
  }

  // Pattern 3: \"title\":\"...\" ... \"id\":\"UUID\"
  const regex3 = /\\"title\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"[^}]*?\\"id\\":\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\"/g;
  while ((m = regex3.exec(rawText)) !== null) {
    const id = m[2];
    const title = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (!idMap.has(title.toLowerCase())) {
      idMap.set(title.toLowerCase(), id);
    }
  }

  console.log(`Successfully mapped ${idMap.size} exact campaign titles to direct UUID URLs!`);
  
  // Now let's update campaigns.json with the direct URL for each campaign!
  const campaignsPath = 'campaigns.json';
  if (fs.existsSync(campaignsPath)) {
    const campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
    let matchedCount = 0;
    campaigns.forEach(c => {
      const cleanTitle = (c.title || '').trim().toLowerCase();
      // Try exact title, or title slice
      let matchedId = idMap.get(cleanTitle);
      if (!matchedId) {
        for (const [t, id] of idMap.entries()) {
          if (cleanTitle.includes(t) || t.includes(cleanTitle)) {
            matchedId = id;
            break;
          }
        }
      }
      if (matchedId) {
        c.id = matchedId;
        c.url = `https://contentrewards.com/discover/${matchedId}`;
        matchedCount++;
      } else {
        c.url = `https://contentrewards.com/discover`;
      }
    });

    console.log(`Enriched ${matchedCount} / ${campaigns.length} campaigns with 100% direct URLs!`);
    fs.writeFileSync('campaigns.json', JSON.stringify(campaigns, null, 2));
    fs.writeFileSync('../campaigns.json', JSON.stringify(campaigns, null, 2));
    fs.writeFileSync('campaign_id_map.json', JSON.stringify(Array.from(idMap.entries()), null, 2));
  }

  await browser.close();
})();
