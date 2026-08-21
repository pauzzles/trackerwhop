const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  const rawHtml = await page.content();
  console.log("Raw HTML length:", rawHtml.length);

  // Parse all JSON objects from the Next.js chunks
  const jsonRegex = /\{"avatar":.*?"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})".*?"title":"([^"]+)".*?\}/g;
  
  // Let's parse all next_f pushes
  const chunks = [];
  const pushRegex = /self\.__next_f\.push\(\[1,"(.*)"\]\)/g;
  let p;
  while ((p = pushRegex.exec(rawHtml)) !== null) {
    try {
      const unescaped = JSON.parse(`"${p[1]}"`);
      chunks.push(unescaped);
    } catch (e) {}
  }

  console.log("Extracted unescaped chunks:", chunks.length);
  const combined = chunks.join("\n");
  fs.writeFileSync('unescaped_next_stream.txt', combined);

  // Extract all campaigns from combined stream
  const uuidRegex = /"id":"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g;
  let m;
  const allIds = new Set();
  while ((m = uuidRegex.exec(combined)) !== null) {
    allIds.add(m[1]);
  }
  console.log(`Found ${allIds.size} unique campaign UUIDs in the Next.js stream!`);

  await browser.close();
})();
