const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Test 1: Whop product route
  console.log("Testing whop product routes...");
  const whopRoutes = [
    "https://whop.com/propaganda-clippers",
    "https://whop.com/modo-clipping",
    "https://whop.com/clip-farm-d5",
    "https://whop.com/clippingculture",
    "https://whop.com/cliphaus-19"
  ];

  for (const url of whopRoutes) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log(`${url} -> Status: ${res.status()}, Title: ${await page.title()}`);
    } catch (e) {
      console.log(`${url} -> Error: ${e.message}`);
    }
  }

  // Test 2: contentrewards.com/discover with search query param
  const searchUrls = [
    "https://contentrewards.com/discover?search=IVN",
    "https://contentrewards.com/discover?q=IVN",
    "https://contentrewards.com/discover?campaign=694c6333-7e7a-4ce3-b21d-42372c440721"
  ];

  for (const url of searchUrls) {
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      console.log(`${url} -> Status: ${res.status()}, Title: ${await page.title()}`);
    } catch (e) {
      console.log(`${url} -> Error: ${e.message}`);
    }
  }

  await browser.close();
})();
