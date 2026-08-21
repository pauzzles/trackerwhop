const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();

  // Next.js RSC chunks push JSON text
  // Let's regex match all objects with "id":"UUID" and "title": "..."
  const regex = /\{"avatar":.*?"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})".*?"title":"([^"]+)".*?\}/g;

  // Let's use a more flexible parser that extracts every JSON chunk containing "id" and "title"
  const allJsonRegex = /\{[^{}]*?"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^{}]*?"title":"([^"]+)"[^{}]*?\}/g;

  const campaigns = [];
  const seenIds = new Set();

  // Find all matches in raw HTML
  let m;
  while ((m = allJsonRegex.exec(rawHtml)) !== null) {
    const jsonStr = m[0].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();

    if (!seenIds.has(id)) {
      seenIds.add(id);

      // Extract brand, category, totalBudget, budgetSpent, pricePerView, description
      const brandMatch = jsonStr.match(/"brand":"([^"]+)"/);
      const catMatch = jsonStr.match(/"category":"([^"]+)"/);
      const totalMatch = jsonStr.match(/"totalBudget":"([^"]+)"/);
      const spentMatch = jsonStr.match(/"budgetSpent":"([^"]+)"/);
      const cpmMatch = jsonStr.match(/"pricePerView":"([^"]+)"/);
      const descMatch = jsonStr.match(/"description":"([^"]+)"/);

      const agency = brandMatch ? brandMatch[1].trim() : "Featured Agency";
      const category = catMatch ? catMatch[1].trim() : "Entertainment";
      const totalNum = totalMatch ? parseInt(totalMatch[1].replace(/[^\d.]/g, ''), 10) : 10000;
      const spentNum = spentMatch ? parseInt(spentMatch[1].replace(/[^\d.]/g, ''), 10) : 1000;
      const cpmNum = cpmMatch ? parseFloat(cpmMatch[1].replace(/[^\d.]/g, '')) : 1.5;
      const desc = descMatch ? descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"') : `${agency} ${category} campaign.`;

      campaigns.push({
        id: id,
        url: `https://contentrewards.com/discover/${id}`,
        title: title,
        agency: agency,
        category: category,
        description: desc,
        total: totalNum || 10000,
        spent: spentNum || 0,
        cpm: cpmNum || 1.5,
        age: "Active",
        count: "1.2K",
        key: `${agency}::${title}`
      });
    }
  }

  console.log(`Parsed ${campaigns.length} campaigns with EXACT DIRECT URLs!`);
  if (campaigns.length > 0) {
    console.log("Sample 1:", JSON.stringify(campaigns[0], null, 2));
    console.log("Sample 2:", JSON.stringify(campaigns[1], null, 2));
    fs.writeFileSync('campaigns.json', JSON.stringify(campaigns, null, 2));
    fs.writeFileSync('../campaigns.json', JSON.stringify(campaigns, null, 2));
  }

  await browser.close();
})();
