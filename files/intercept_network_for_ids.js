/**
 * intercept_network_for_ids.js
 * 
 * Opens Content Rewards in a NON-HEADLESS browser with stealth,
 * intercepts all JSON responses, and extracts campaign UUIDs + doc links
 * from the network traffic without needing to click anything.
 * 
 * Scrolls the page for 60 seconds to trigger lazy-loading of all campaigns.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CAMPS_PATH   = path.join(__dirname, '..', 'campaigns.json');
const OUTPUT_PATH  = path.join(__dirname, 'network_captured_data.json');

const campaigns = JSON.parse(fs.readFileSync(CAMPS_PATH, 'utf8'));
console.log(`Loaded ${campaigns.length} campaigns from campaigns.json`);

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g,' ').trim();
}

function extractDocLinks(text) {
  const matches = (text || '').match(/https?:\/\/[^\s"'<>)\]\\]+/g) || [];
  return [...new Set(matches.filter(u =>
    u.includes('docs.google') ||
    u.includes('drive.google') ||
    u.includes('notion.so')   ||
    u.includes('notion.site') ||
    u.includes('docsend')
  ))];
}

function extractAllUrls(text) {
  return [...new Set((text || '').match(/https?:\/\/[^\s"'<>)\]\\]+/g) || [])];
}

const capturedItems = [];
const seenIds = new Set();

(async () => {
  // Use non-headless to bypass bot detection
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    }
  });

  // Remove webdriver property
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  // INTERCEPT ALL RESPONSES
  context.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    if (status < 200 || status >= 300) return;
    
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('json') && !ct.includes('text')) return;

    try {
      const bodyText = await response.text();
      if (!bodyText || bodyText.length < 100) return;

      // Look for UUID patterns
      const uuids = bodyText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
      
      let body;
      try { body = JSON.parse(bodyText); } catch { return; }
      
      // Recursively find all objects with id + title
      const extractCampaigns = (obj, depth = 0) => {
        if (!obj || depth > 15 || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          obj.forEach(item => extractCampaigns(item, depth + 1));
          return;
        }
        
        // Check if this object looks like a campaign
        const id    = obj.id || obj.uuid || obj.campaignId || obj.campaign_id;
        const title = obj.title || obj.name || obj.campaignTitle || obj.campaign_name;
        const desc  = obj.description || obj.brief || obj.requirements || obj.instructions || '';
        const docs  = extractDocLinks(desc);
        const allUrls = extractAllUrls(desc);
        const whop  = obj.whopRoute || obj.whop_route || obj.slug || obj.route || 
                      (obj.links && obj.links.find && obj.links.find(l => typeof l === 'string' && l.includes('whop.com')));
        
        if (id && title && typeof id === 'string' && id.match(/^[0-9a-f]{8}-/)) {
          const key = id;
          if (!seenIds.has(key)) {
            seenIds.add(key);
            capturedItems.push({
              id,
              title: String(title).trim(),
              description: String(desc).slice(0, 500),
              doc_links: docs,
              all_links: allUrls.slice(0, 10),
              whop_route: whop ? String(whop).replace(/https?:\/\/whop\.com\//, '') : null,
              source_url: url.slice(0, 100)
            });
            if (capturedItems.length % 10 === 0) {
              process.stdout.write(`\r  Captured: ${capturedItems.length} campaigns...`);
            }
          }
        }
        
        Object.values(obj).forEach(v => extractCampaigns(v, depth + 1));
      };
      
      extractCampaigns(body);
      
    } catch (e) { /* silent */ }
  });

  const page = await context.newPage();
  
  console.log('\nOpening Content Rewards (non-headless)...');
  try {
    await page.goto('https://contentrewards.com/discover', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  } catch(e) { console.log('Load timeout, continuing scroll...'); }
  
  await page.waitForTimeout(3000);
  console.log('Page loaded. Scrolling to load all campaigns...');

  // Scroll for 90 seconds to trigger pagination/lazy-loading
  const SCROLL_DURATION_MS = 90000;
  const start = Date.now();
  let scrollCount = 0;
  
  while (Date.now() - start < SCROLL_DURATION_MS) {
    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 1.5);
    });
    await page.waitForTimeout(600);
    scrollCount++;
    
    // Also try clicking "Load More" buttons
    if (scrollCount % 10 === 0) {
      await page.evaluate(() => {
        const loadMore = document.querySelector('[class*="load-more"], button[class*="more"], [data-testid*="load"]');
        if (loadMore) loadMore.click();
      });
      
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`\r  ${elapsed}s elapsed | Campaigns captured: ${capturedItems.length} | Scrolls: ${scrollCount}`);
      
      // Save progress
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
        captured: capturedItems,
        timestamp: new Date().toISOString()
      }, null, 2));
    }
    
    // Scroll back to top occasionally to trigger re-fetches
    if (scrollCount % 30 === 0) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1000);
    }
  }

  await browser.close();
  
  // Final save
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
    captured: capturedItems,
    timestamp: new Date().toISOString()
  }, null, 2));

  console.log(`\n\n═══════ CAPTURE COMPLETE ═══════`);
  console.log(`Total unique campaign UUIDs captured: ${capturedItems.length}`);
  console.log(`With doc links: ${capturedItems.filter(c => c.doc_links.length > 0).length}`);
  console.log(`Saved to: ${OUTPUT_PATH}`);

  // Now merge into campaigns.json
  if (capturedItems.length > 0) {
    const camps = JSON.parse(fs.readFileSync(CAMPS_PATH, 'utf8'));
    
    // Build lookup by normalized title
    const apiMap = {};
    for (const item of capturedItems) {
      const key = norm(item.title);
      if (!apiMap[key]) apiMap[key] = item;
    }
    
    let matched = 0, docAdded = 0;
    const updated = camps.map(c => {
      const key = norm(c.title);
      const api = apiMap[key];
      if (!api) return c;
      
      const merged = { ...c };
      if (api.id) { merged.campaign_id = api.id; matched++; }
      if (api.whop_route) merged.whop_route = api.whop_route;
      
      const fromDesc = extractDocLinks(c.description || '');
      const fromApi  = api.doc_links || [];
      const allLinks = [...new Set([...fromDesc, ...fromApi])];
      if (allLinks.length > 0) { merged.doc_links = allLinks; docAdded++; }
      
      return merged;
    });

    fs.writeFileSync(CAMPS_PATH, JSON.stringify(updated, null, 2));
    console.log(`\nMerged into campaigns.json:`);
    console.log(`  Matched IDs:       ${matched}/${camps.length}`);
    console.log(`  Got doc links:     ${docAdded}`);
  }
})();
