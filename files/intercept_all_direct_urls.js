const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  let allTextChunks = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('contentrewards.com/discover') || url.includes('_next')) {
      try {
        const text = await res.text();
        allTextChunks.push(text);
      } catch (e) {}
    }
  });

  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();
  allTextChunks.push(rawHtml);

  const fullPayload = allTextChunks.join('\n');
  console.log("Full intercepted payload length:", fullPayload.length);

  // Extract all JSON objects with id, title, totalBudget, pricePerView
  // Pattern: "id":"UUID" ... "title":"..."
  const uuidRegex = /"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g;
  let match;
  const campaigns = [];
  const seenIds = new Set();

  // Find all JSON object slices
  const chunks = fullPayload.split('{"avatar":');
  console.log("Avatar chunks found:", chunks.length);

  for (let i = 1; i < chunks.length; i++) {
    const rawChunk = '{"avatar":' + chunks[i].slice(0, 3000);
    // Find the end of the JSON object
    const idM = rawChunk.match(/"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
    const titleM = rawChunk.match(/"title":"([^"]+)"/);
    const brandM = rawChunk.match(/"brand":"([^"]+)"/);
    const catM = rawChunk.match(/"category":"([^"]+)"/);
    const totalM = rawChunk.match(/"totalBudget":"([^"]+)"/);
    const spentM = rawChunk.match(/"budgetSpent":"([^"]+)"/);
    const cpmM = rawChunk.match(/"pricePerView":"([^"]+)"/);
    const descM = rawChunk.match(/"description":"([^"]*)"/);
    const countM = rawChunk.match(/"creators":(\d+)/);

    if (idM && titleM) {
      const id = idM[1];
      if (!seenIds.has(id)) {
        seenIds.add(id);
        const title = titleM[1].replace(/\\"/g, '"').trim();
        const agency = brandM ? brandM[1].replace(/\\"/g, '"').trim() : "Featured Agency";
        const category = catM ? catM[1].trim() : "Entertainment";
        const total = totalM ? parseInt(totalM[1].replace(/[^\d.]/g, ''), 10) : 10000;
        const spent = spentM ? parseInt(spentM[1].replace(/[^\d.]/g, ''), 10) : 0;
        const cpm = cpmM ? parseFloat(cpmM[1].replace(/[^\d.]/g, '')) : 1.5;
        const desc = descM ? descM[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim() : `${agency} ${category} campaign.`;
        const count = countM ? countM[1] : "500";

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
  }

  console.log(`Successfully extracted ${campaigns.length} campaigns with 100% direct URLs!`);
  if (campaigns.length > 0) {
    console.log("Sample 1:", JSON.stringify(campaigns[0], null, 2));
    console.log("Sample 2:", JSON.stringify(campaigns[1], null, 2));
    fs.writeFileSync('campaigns.json', JSON.stringify(campaigns, null, 2));
    fs.writeFileSync('../campaigns.json', JSON.stringify(campaigns, null, 2));
  }

  await browser.close();
})();
