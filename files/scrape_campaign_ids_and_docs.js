/**
 * scrape_campaign_ids_and_docs.js
 * 
 * Intercepts Content Rewards' own API response to grab:
 *   - campaign UUID (for direct join links)
 *   - doc_links (Google Docs, Notion, Drive links from each campaign detail)
 *   - whop_route (whop.com/xxx slug)
 * 
 * Then merges results into campaigns.json
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CAMPAIGNS_PATH = path.join(__dirname, 'campaigns.json');
const OUTPUT_PATH    = path.join(__dirname, 'campaigns.json');

const campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_PATH, 'utf8'));
console.log(`Loaded ${campaigns.length} campaigns from campaigns.json`);

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function extractDocLinks(text) {
  const docPattern = /https?:\/\/[^\s"'<>]+/g;
  const matches = (text || '').match(docPattern) || [];
  return [...new Set(matches.filter(u =>
    u.includes('docs.google') ||
    u.includes('drive.google') ||
    u.includes('notion.so') ||
    u.includes('notion.site') ||
    u.includes('docsend') ||
    u.includes('bit.ly') ||
    u.includes('shorturl') ||
    u.includes('tinyurl')
  ))];
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }
  });

  // Intercept all API calls — Content Rewards fetches campaign list from their API
  const capturedCampaigns = [];
  context.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('api') && !url.includes('campaign') && !url.includes('discover') && !url.includes('graphql')) return;
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await response.json();
      // Look for arrays of campaigns
      const extract = (obj) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
          obj.forEach(item => {
            if (item && item.id && (item.title || item.name)) {
              capturedCampaigns.push(item);
            }
            extract(item);
          });
        } else if (typeof obj === 'object') {
          Object.values(obj).forEach(extract);
        }
      };
      extract(body);
    } catch {}
  });

  const page = await context.newPage();
  console.log('Navigating to Content Rewards discover page...');
  
  try {
    await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 60000 });
  } catch(e) {
    console.log('Network idle timeout, continuing...');
  }

  // Scroll to trigger lazy-loading of more campaigns
  console.log('Scrolling to load all campaigns...');
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(800);
  }

  // Try to extract from the Next.js __NEXT_DATA__ embedded JSON
  const nextData = await page.evaluate(() => {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      return el ? JSON.parse(el.textContent) : null;
    } catch { return null; }
  });

  // Also try window.__data or React fiber
  const windowData = await page.evaluate(() => {
    // Try various global data stores
    const results = [];
    
    // 1. Search for any window property containing campaigns array
    for (const key of Object.keys(window)) {
      try {
        const val = window[key];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const str = JSON.stringify(val);
          if (str.includes('"id"') && str.includes('"title"') && str.includes('campaign')) {
            results.push({ key, preview: str.slice(0, 100) });
          }
        }
      } catch {}
    }
    
    // 2. Find React fiber root and walk props
    const rootEl = document.getElementById('__next') || document.querySelector('[data-reactroot]');
    if (rootEl) {
      const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternals'));
      if (fiberKey) {
        let fiber = rootEl[fiberKey];
        let maxDepth = 50;
        while (fiber && maxDepth-- > 0) {
          try {
            const memoized = fiber.memoizedProps || {};
            const state = fiber.memoizedState;
            if (state && state.memoizedState) {
              const s = JSON.stringify(state.memoizedState).slice(0, 200);
              if (s.includes('campaign') || s.includes('discover')) {
                results.push({ type: 'fiber_state', preview: s.slice(0, 100) });
              }
            }
          } catch {}
          fiber = fiber.return || fiber.child;
        }
      }
    }
    
    return results;
  });

  console.log(`Captured from API intercept: ${capturedCampaigns.length} campaigns`);
  console.log(`Window data found: ${windowData.length} entries`);

  if (nextData) {
    // Try to extract from Next.js page props
    const extract = (obj, depth = 0) => {
      if (!obj || depth > 10) return;
      if (Array.isArray(obj)) {
        obj.forEach(item => {
          if (item && item.id && (item.title || item.name)) {
            capturedCampaigns.push(item);
          }
          extract(item, depth + 1);
        });
      } else if (typeof obj === 'object') {
        Object.values(obj).forEach(v => extract(v, depth + 1));
      }
    };
    extract(nextData);
    console.log(`After Next.js parse: ${capturedCampaigns.length} total captured`);
  }

  // Now try clicking each of our campaigns to get their doc links
  // Start with campaigns that don't have doc links yet
  const needsDocScrape = campaigns.filter(c => !c.doc_links || c.doc_links.length === 0).slice(0, 80);
  console.log(`\nWill scrape doc links for up to ${needsDocScrape.length} campaigns...`);

  const docLinkMap = {}; // title -> doc_links[]
  const idMap = {};      // normalized_title -> { id, whop_route }

  // Build ID map from captured API data
  for (const raw of capturedCampaigns) {
    const t = normalize(raw.title || raw.name || '');
    if (t) {
      idMap[t] = {
        id: raw.id || raw.uuid || raw._id,
        whop_route: raw.whopRoute || raw.whop_route || raw.slug || raw.route,
        description: raw.description || raw.brief || raw.requirements || ''
      };
    }
  }
  console.log(`\nID map built: ${Object.keys(idMap).length} entries`);

  // Click each campaign to get its doc links
  let docScraped = 0;
  for (const camp of needsDocScrape) {
    const normTitle = normalize(camp.title);
    
    // Search for this campaign
    try {
      const searchInput = await page.$('input[placeholder*="Campaign" i], input[placeholder*="search" i], input[type="search"]');
      if (!searchInput) break;
      
      await searchInput.triple_click().catch(() => searchInput.click());
      await page.keyboard.selectAll();
      await searchInput.type(camp.title.slice(0, 20), { delay: 50 });
      await page.waitForTimeout(1500);

      // Find the matching card by title
      const cardClicked = await page.evaluate((title) => {
        const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const target = norm(title);
        const els = document.querySelectorAll('h1, h2, h3, h4, p, span, div');
        for (const el of els) {
          const t = norm(el.textContent || '');
          if (t === target || t.startsWith(target.slice(0, 15))) {
            const clickable = el.closest('[class*="cursor-pointer"], [class*="campaign"], article, [role="button"]');
            if (clickable) { clickable.click(); return true; }
          }
        }
        return false;
      }, camp.title);

      if (cardClicked) {
        await page.waitForTimeout(1500);
        
        // Extract all text and links from the opened modal/panel
        const modalData = await page.evaluate(() => {
          const modal = document.querySelector('[class*="modal"], [class*="drawer"], [class*="panel"], [class*="dialog"], [class*="sheet"]');
          const content = modal ? modal.innerText : '';
          const links = Array.from(document.querySelectorAll('a[href*="docs.google"], a[href*="drive.google"], a[href*="notion"], a[href*="bit.ly"]')).map(a => a.href);
          return { content, links };
        });

        const foundLinks = [
          ...modalData.links,
          ...extractDocLinks(modalData.content)
        ];
        
        if (foundLinks.length > 0) {
          docLinkMap[camp.title] = [...new Set(foundLinks)];
          docScraped++;
          console.log(`  ✓ ${camp.title.slice(0,40)}: ${foundLinks.length} doc link(s)`);
        }

        // Close modal if open
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } catch (e) {
      // silent
    }
  }

  await browser.close();

  console.log(`\n=== RESULTS ===`);
  console.log(`API-captured IDs: ${Object.keys(idMap).length}`);
  console.log(`Doc links scraped: ${docScraped} campaigns`);

  // Merge results back into campaigns array
  let idMatched = 0;
  let docMatched = 0;
  
  const updated = campaigns.map(c => {
    const norm = normalize(c.title);
    const apiData = idMap[norm];
    
    let changes = { ...c };
    
    // Merge campaign ID and whop route
    if (apiData) {
      if (apiData.id) { changes.campaign_id = apiData.id; idMatched++; }
      if (apiData.whop_route) changes.whop_route = apiData.whop_route;
      // Merge doc links from description
      const fromDesc = extractDocLinks(apiData.description);
      if (fromDesc.length > 0) changes.doc_links = [...new Set([...(changes.doc_links || []), ...fromDesc])];
    }
    
    // Merge scraped doc links
    if (docLinkMap[c.title]) {
      changes.doc_links = [...new Set([...(changes.doc_links || []), ...docLinkMap[c.title]])];
      docMatched++;
    }
    
    // Also extract doc links from existing description
    const fromOwnDesc = extractDocLinks(c.description);
    if (fromOwnDesc.length > 0) {
      changes.doc_links = [...new Set([...(changes.doc_links || []), ...fromOwnDesc])];
    }
    
    return changes;
  });

  console.log(`\nMatched campaign IDs: ${idMatched}/${campaigns.length}`);
  console.log(`Campaigns with doc links: ${updated.filter(c => c.doc_links && c.doc_links.length > 0).length}`);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(updated, null, 2));
  console.log(`\n✅ Saved updated campaigns.json to ${OUTPUT_PATH}`);
})();
