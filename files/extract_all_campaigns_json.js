const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Fetching live page with direct campaign IDs...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();

  // Extract all Next.js JSON stream chunks
  const jsonObjectRegex = /\{"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})","title":"([^"]+)"(?:,"brand":"([^"]*)")?(?:,"avatar":"[^"]*")?(?:,"thumbnail":"[^"]*")?(?:,"bannerImageUrl":[^,]*)?(?:,"bannerPriority":[^,]*)?(?:,"featuredPriority":[^,]*)?(?:,"totalBudget":"([^"]*)")?(?:,"budgetSpent":"([^"]*)")?(?:,"pricePerView":"([^"]*)")?/g;

  // Or let's parse all JSON blocks in script tags
  const campaigns = await page.evaluate(() => {
    const raw = document.documentElement.innerHTML;
    const list = [];
    const seenIds = new Set();

    // Regex match all JSON blocks containing id, title, totalBudget, pricePerView
    const itemRegex = /\{"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^}]*?"title":"([^"]+)"[^}]*?\}/g;
    
    // Better: parse JSON chunks from self.__next_f
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
    scripts.forEach(s => {
      // Find bannerCampaigns or featuredCampaigns or all campaigns arrays
      const idMatch = s.match(/"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g);
      // Let's do regex matching for every object with "id":"UUID" and "title":"..."
      const objRegex = /\{(?=[^{}]*"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})")(?=[^{}]*"title":"([^"]+)")(?=[^{}]*"pricePerView":"([^"]+)")(?=[^{}]*"totalBudget":"([^"]+)")(?=[^{}]*"budgetSpent":"([^"]+)")(?=[^{}]*"category":"([^"]+)")(?=[^{}]*"brand":"([^"]+)")(?=[^{}]*"description":"([^"]*)")[^{}]*\}/g;

      let match;
      while ((match = objRegex.exec(s)) !== null) {
        const id = match[1];
        if (!seenIds.has(id)) {
          seenIds.add(id);
          const totalStr = match[4].replace(/[^\d.]/g, '');
          const spentStr = match[5].replace(/[^\d.]/g, '');
          const cpmStr = match[3].replace(/[^\d.]/g, '');

          list.push({
            id: id,
            url: `https://contentrewards.com/discover/${id}`,
            title: match[2].trim(),
            agency: match[7].trim(),
            category: match[6].trim(),
            description: match[8].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim(),
            total: parseInt(totalStr, 10) || 10000,
            spent: parseInt(spentStr, 10) || 0,
            cpm: parseFloat(cpmStr) || 1.0,
            age: "Active",
            count: "500",
            key: `${match[7].trim()}::${match[2].trim()}`
          });
        }
      }
    });

    return list;
  });

  console.log(`Parsed ${campaigns.length} campaigns directly from React JSON objects!`);
  if (campaigns.length > 0) {
    console.log("Sample 1:", JSON.stringify(campaigns[0], null, 2));
    console.log("Sample 2:", JSON.stringify(campaigns[1], null, 2));
    fs.writeFileSync('campaigns.json', JSON.stringify(campaigns, null, 2));
    fs.writeFileSync('../campaigns.json', JSON.stringify(campaigns, null, 2));
  }

  await browser.close();
})();
