/**
 * scrape_ids_by_clicking.js
 * 
 * Visits contentrewards.com/discover, searches for each campaign one by one,
 * clicks the matching card, and reads:
 *   1. The campaign UUID from the URL change or the join button href
 *   2. Document links from the modal content
 * 
 * Processes in batches and saves progress incrementally.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CAMPS_PATH   = path.join(__dirname, '..', 'campaigns.json');
const RESULTS_PATH = path.join(__dirname, 'scraped_ids_docs.json');

const campaigns = JSON.parse(fs.readFileSync(CAMPS_PATH, 'utf8'));
console.log(`Loaded ${campaigns.length} campaigns`);

// Load any previous partial results
let results = {};
if (fs.existsSync(RESULTS_PATH)) {
  results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  console.log(`Loaded ${Object.keys(results).length} previous results`);
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

function extractDocLinks(text) {
  const matches = (text || '').match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  return [...new Set(matches.filter(u =>
    u.includes('docs.google') ||
    u.includes('drive.google') ||
    u.includes('notion.so')   ||
    u.includes('notion.site') ||
    u.includes('docsend')
  ))];
}

function matchScore(cardTitle, target) {
  const cn = norm(cardTitle);
  const tn = norm(target);
  if (cn === tn) return 100;
  if (cn.startsWith(tn.slice(0,10)) || tn.startsWith(cn.slice(0,10))) return 80;
  const tWords = tn.split('').length > 8 ? [tn.slice(0,8)] : [tn]; // prefix match for short titles
  const hits = tWords.filter(w => cn.includes(w)).length;
  return hits > 0 ? Math.round((hits / tWords.length) * 60) : 0;
}

// Only process campaigns that haven't been scraped yet
const toScrape = campaigns.filter(c => !results[c.title]);
console.log(`Need to scrape: ${toScrape.length} campaigns`);

const BATCH_SIZE = 30; // scrape 30 campaigns at a time

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Track URL changes for UUID extraction
  let lastUrl = '';
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) lastUrl = frame.url();
  });

  // Also intercept responses to catch campaign detail API calls
  const detailCache = {}; // campaign title norm -> {id, doc_links}
  context.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('content') && !url.includes('campaign') && !url.includes('whop')) return;
    const ct = res.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    try {
      const body = await res.json();
      const str = JSON.stringify(body);
      // UUID regex
      const uuids = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
      const docs  = extractDocLinks(str);
      if (uuids.length > 0 || docs.length > 0) {
        detailCache[url] = { uuids, docs, body_preview: str.slice(0, 200) };
      }
    } catch {}
  });

  console.log('\nNavigating to Content Rewards...');
  try {
    await page.goto('https://contentrewards.com/discover', { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) { console.log('Initial load timeout, continuing...'); }
  await page.waitForTimeout(3000);

  let scraped = 0;
  let found_id = 0;
  let found_doc = 0;

  const batch = toScrape.slice(0, BATCH_SIZE);
  console.log(`\nProcessing batch of ${batch.length} campaigns...\n`);

  for (const camp of batch) {
    try {
      // Find the search input
      const searchInput = await page.$('input[placeholder*="Campaign" i], input[placeholder*="search" i], input[type="search"]');
      if (!searchInput) {
        console.log('  ⚠️  No search input found — page may not have loaded');
        break;
      }

      // Clear and type the search term
      await searchInput.click({ clickCount: 3 });
      await searchInput.fill('');
      
      // Use first 20 chars to search (more reliable)
      const searchTerm = camp.title.slice(0, 25);
      await searchInput.type(searchTerm, { delay: 40 });
      await page.waitForTimeout(1500);

      // Find the best matching card
      const clickResult = await page.evaluate((campTitle) => {
        function norm(s) { return (s||'').toLowerCase().replace(/[^a-z0-9]/g,'').trim(); }
        function score(card, target) {
          const cn = norm(card), tn = norm(target);
          if (cn === tn) return 100;
          if (cn.includes(tn.slice(0,10))) return 80;
          if (tn.includes(cn.slice(0,10))) return 70;
          // word overlap
          const tWords = tn.split(/\s+/).filter(w=>w.length>2);
          const hits = tWords.filter(w=>cn.includes(w)).length;
          return tWords.length ? Math.round((hits/tWords.length)*60) : 0;
        }

        // Try headings first (most reliable title elements)
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,span'));
        let best = null, bestScore = 0;
        for (const el of headings) {
          const text = (el.textContent||'').trim();
          const s = score(text, campTitle);
          if (s > bestScore) {
            const clickable = el.closest('[class*="cursor-pointer"],[class*="campaign"],article,[role="button"],a') || el;
            bestScore = s; best = clickable;
          }
        }
        if (best && bestScore >= 40) {
          best.click();
          return { clicked: true, score: bestScore };
        }
        return { clicked: false, score: bestScore };
      }, camp.title);

      if (!clickResult.clicked) {
        console.log(`  ✗ "${camp.title.slice(0,35)}..." - no match (best score: ${clickResult.score})`);
        results[camp.title] = { id: null, doc_links: [], whop_route: null, score: clickResult.score };
        scraped++;
        continue;
      }

      await page.waitForTimeout(1800);

      // Extract from the modal/panel that opened
      const modalData = await page.evaluate(() => {
        // Look for a modal, drawer, or right panel
        const panels = [
          ...document.querySelectorAll('[class*="modal"], [class*="drawer"], [class*="panel"], [class*="dialog"], [class*="sheet"], [class*="overlay"], [class*="popup"]'),
          ...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')
        ];

        // Find the one that is actually visible
        const visible = panels.find(el => {
          const s = window.getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && el.offsetHeight > 100;
        });

        if (!visible) {
          // Fallback: grab all links from the page and look for UUID in href
          const allLinks = Array.from(document.querySelectorAll('a[href]')).map(a => a.href);
          const pageText = document.body.innerText;
          return { source: 'page', text: pageText.slice(0, 2000), links: allLinks };
        }

        const text  = visible.innerText || '';
        const links = Array.from(visible.querySelectorAll('a[href]')).map(a => a.href);
        const joinBtn = visible.querySelector('a[href*="/campaign/"], a[href*="whop.com"], button');
        
        return {
          source: 'modal',
          text,
          links,
          joinHref: joinBtn ? joinBtn.getAttribute('href') || '' : '',
          innerHTML: visible.innerHTML.slice(0, 3000)
        };
      });

      // Extract UUID from links or innerHTML
      const allText = JSON.stringify(modalData);
      const uuids   = [...new Set((allText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || []))];
      const docLinks = extractDocLinks(allText);

      // Extract whop route from links
      const whopRoutes = (modalData.links || [])
        .filter(l => l.includes('whop.com') && !l.includes('/hub') && !l.includes('/checkout'))
        .map(l => { try { return new URL(l).pathname.replace(/^\//, ''); } catch { return null; } })
        .filter(Boolean);

      const campResult = {
        id:         uuids[0] || null,
        doc_links:  docLinks,
        whop_route: whopRoutes[0] || null,
        score:      clickResult.score,
        source:     modalData.source
      };

      results[camp.title] = campResult;
      scraped++;

      if (campResult.id)              found_id++;
      if (campResult.doc_links.length) found_doc++;

      const flags = [campResult.id ? '🆔' : '', campResult.doc_links.length ? '📎' : ''].filter(Boolean).join('') || '  ';
      console.log(`  ${flags} "${camp.title.slice(0,40)}" → id:${campResult.id ? campResult.id.slice(0,8)+'...' : 'none'} docs:${campResult.doc_links.length}`);

      // Save progress every 5 campaigns
      if (scraped % 5 === 0) {
        fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
        console.log(`    💾 Progress saved (${scraped}/${batch.length})`);
      }

      // Close any modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);

    } catch (e) {
      console.error(`  ❌ Error on "${camp.title.slice(0,30)}":`, e.message);
      results[camp.title] = { id: null, doc_links: [], whop_route: null, error: e.message };
      scraped++;
    }
  }

  await browser.close();
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));

  console.log(`\n═══════════════════════════════`);
  console.log(`Scraped:        ${scraped}`);
  console.log(`Found IDs:      ${found_id}`);
  console.log(`Found doc links: ${found_doc}`);
  console.log(`Results saved → ${RESULTS_PATH}`);
})();
