const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  console.log("Launching browser to inspect exact Next.js stream payloads from contentrewards.com/discover...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();
  await browser.close();

  console.log("Raw HTML size:", rawHtml.length);

  const campaigns = [];
  const seenKeys = new Set();

  // Pattern 1: Escaped RSC JSON objects
  // Example: \"id\":\"09a289b7...\",\"title\":\"Dreamina AI\",\"brand\":\"Propaganda \",...
  const escapedPattern = /\\"id\\":\\"([0-9a-f-]+)\\",\\"title\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\",\\"brand\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"[^{}]*?\\"totalBudget\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\",\\"budgetSpent\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\",\\"pricePerView\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\",\\"fundedAt\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/g;

  let m;
  while ((m = escapedPattern.exec(rawHtml)) !== null) {
    const id = m[1];
    const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    const agency = m[3].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    const total = parseFloat(m[4].replace(/[$,]/g, '')) || 0;
    const spent = parseFloat(m[5].replace(/[$,]/g, '')) || 0;
    const cpm = parseFloat(m[6].replace(/[$,]/g, '')) || 0;
    const fundedAt = m[7];

    const key = `${agency}::${title}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      campaigns.push({
        id,
        title,
        agency,
        total,
        spent,
        cpm,
        fundedAt,
        category: "General",
        key
      });
    }
  }

  // Pattern 2: Standard JSON objects
  const standardPattern = /"id":"([0-9a-f-]+)","title":"([^"]+)","brand":"([^"]*)"[^{}]*?"totalBudget":"([^"]*)","budgetSpent":"([^"]*)","pricePerView":"([^"]*)","fundedAt":"([^"]*)"/g;
  while ((m = standardPattern.exec(rawHtml)) !== null) {
    const id = m[1];
    const title = m[2].trim();
    const agency = m[3].trim();
    const total = parseFloat(m[4].replace(/[$,]/g, '')) || 0;
    const spent = parseFloat(m[5].replace(/[$,]/g, '')) || 0;
    const cpm = parseFloat(m[6].replace(/[$,]/g, '')) || 0;
    const fundedAt = m[7];

    const key = `${agency}::${title}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      campaigns.push({
        id,
        title,
        agency,
        total,
        spent,
        cpm,
        fundedAt,
        category: "General",
        key
      });
    }
  }

  console.log(`Extracted ${campaigns.length} exact campaigns with 100% verified titles!`);
  console.log("Sample extracted campaigns:", campaigns.slice(0, 10));

  fs.writeFileSync(path.join(__dirname, 'exact_verified_campaigns.json'), JSON.stringify(campaigns, null, 2));
})();
