const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();
  console.log("Raw HTML length:", rawHtml.length);

  // Extract all occurrences of campaign objects from the Next.js RSC payload
  const idTitleRegex = /"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^}]*?"title":"([^"\\]*(?:\\.[^"\\]*)*)"/g;
  const idMap = new Map();
  const fullCampaigns = [];

  // Match escaped quotes \"id\":\"...\"
  const escapedRegex = /\\"id\\":\\"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\"[^}]*?\\"title\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/g;
  
  let m;
  while ((m = escapedRegex.exec(rawHtml)) !== null) {
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (!idMap.has(title)) {
      idMap.set(title, id);
      fullCampaigns.push({
        title,
        id,
        url: `https://contentrewards.com/discover/${id}`
      });
    }
  }

  // Also check normal regex
  while ((m = idTitleRegex.exec(rawHtml)) !== null) {
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    if (!idMap.has(title)) {
      idMap.set(title, id);
      fullCampaigns.push({
        title,
        id,
        url: `https://contentrewards.com/discover/${id}`
      });
    }
  }

  console.log(`Successfully mapped ${fullCampaigns.length} campaigns directly to exact direct URLs!`);
  console.log("Sample mapped campaigns (first 5):", JSON.stringify(fullCampaigns.slice(0, 5), null, 2));

  // Find MUTUUM
  const mutuum = fullCampaigns.find(c => c.title.toLowerCase().includes('mutuum') || c.id.includes('694c6333'));
  console.log("MUTUUM Direct URL Found:", mutuum);

  fs.writeFileSync('campaign_direct_urls.json', JSON.stringify(fullCampaigns, null, 2));
  await browser.close();
})();
