/**
 * fetch_all_docs.js
 *
 * 1. Fetches the discover page and extracts id->title mapping for all campaigns.
 * 2. Patches any campaign in campaigns.json that has an empty id field.
 * 3. For every campaign that has an id, fetches its detail page and extracts
 *    Google Docs / Drive / Notion / Dropbox links.
 * 4. Saves results back to campaigns.json and campaigns_data.js.
 *
 * Runs fully without authentication — all pages are public.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CAMPAIGNS_FILE = path.join(__dirname, 'campaigns.json');
const DISCOVER_URL = 'https://contentrewards.com/discover';
const BASE_URL = 'https://contentrewards.com/discover/';
const CONCURRENCY = 5;
const DELAY_MS = 400;
const TIMEOUT_MS = 15000;

// ── HTTP GET ─────────────────────────────────────────────────────────────────
function get(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', async err => {
      if (retries > 0) { await new Promise(r => setTimeout(r, 1000)); resolve(get(url, retries - 1)); }
      else reject(err);
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      if (retries > 0) resolve(get(url, retries - 1));
      else reject(new Error('timeout'));
    });
  });
}

// ── Extract id->title map from discover page HTML ────────────────────────────
function extractIdMap(html) {
  const idMap = new Map(); // title (lowercase) -> id
  const ID_MARKER = '\\"id\\":\\"';
  let pos = 0;
  while (pos < html.length) {
    const idIdx = html.indexOf(ID_MARKER, pos);
    if (idIdx === -1) break;
    const afterMarker = idIdx + ID_MARKER.length;
    const possibleUuid = html.slice(afterMarker, afterMarker + 36);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(possibleUuid)) {
      pos = afterMarker;
      continue;
    }
    const window3k = html.slice(afterMarker, afterMarker + 3000);
    const titleMatch = window3k.match(/\\"title\\":\\"((?:[^"\\]|\\.)+?)\\"/);
    if (titleMatch) {
      const title = titleMatch[1].replace(/\\"/g, '"').trim().toLowerCase();
      if (title && !idMap.has(title)) idMap.set(title, possibleUuid);
    }
    pos = afterMarker + 36;
  }
  return idMap;
}

// ── Extract genuine external doc links from campaign detail page ─────────────
function extractDocs(html) {
  const urlRegex = /https?:\/\/[^\s"'`<>\]\)\\]+/g;
  const matches = html.match(urlRegex) || [];
  const found = new Map(); // url -> name

  for (let m of matches) {
    m = m.replace(/[\\,"'`\]\)]+$/, '').trim();
    if (!m || m.length < 20) continue;
    if (m.includes('contentrewards')) continue;

    if (m.includes('docs.google.com') && !found.has(m)) found.set(m, 'Google Doc');
    else if (m.includes('drive.google.com') && !found.has(m)) found.set(m, 'Google Drive');
    else if ((m.includes('notion.so') || m.includes('notion.site')) && !found.has(m)) found.set(m, 'Notion Doc');
    else if (m.includes('dropbox.com') && !found.has(m)) found.set(m, 'Dropbox File');
  }

  return [...found.entries()].map(([url, type]) => ({ name: type, url }));
}

// ── Process batch ─────────────────────────────────────────────────────────────
async function processBatch(batch, stats) {
  await Promise.all(batch.map(async campaign => {
    if (!campaign.id) { stats.skipped++; return; }

    try {
      const res = await get(BASE_URL + campaign.id);
      if (res.status !== 200) { stats.errors++; return; }

      const docs = extractDocs(res.body);
      if (docs.length > 0) {
        const existing = Array.isArray(campaign.resources) ? campaign.resources : [];
        const existingUrls = new Set(existing.map(r => r.url));
        const newDocs = docs.filter(d => !existingUrls.has(d.url));
        if (newDocs.length > 0) {
          campaign.resources = [...existing, ...newDocs];
          stats.updated++;
          console.log(`[✓] ${campaign.title}: +${newDocs.length} doc(s)`);
          newDocs.forEach(d => console.log(`     → ${d.url}`));
        } else {
          stats.unchanged++;
        }
      } else {
        stats.unchanged++;
      }
      stats.fetched++;
    } catch (err) {
      console.warn(`[✗] ${campaign.title || campaign.id}: ${err.message}`);
      stats.errors++;
    }
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[fetch_all_docs] Starting...');

  // Step 1: Load campaigns.json
  let campaigns;
  try {
    campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_FILE, 'utf8'));
  } catch (e) {
    console.error('Failed to read campaigns.json:', e.message);
    process.exit(1);
  }

  // Step 2: Fetch discover page to get id->title mapping
  console.log('[fetch_all_docs] Fetching discover page to extract campaign IDs...');
  let idMap = new Map();
  try {
    const discoverRes = await get(DISCOVER_URL);
    if (discoverRes.status === 200) {
      idMap = extractIdMap(discoverRes.body);
      console.log(`[fetch_all_docs] Found ${idMap.size} campaign id->title pairs from discover page`);
    }
  } catch (e) {
    console.warn('[fetch_all_docs] Could not fetch discover page for IDs:', e.message);
  }

  // Step 3: Patch missing IDs in campaigns using the discover page map
  let patched = 0;
  for (const campaign of campaigns) {
    if (!campaign.id && campaign.title) {
      const key = campaign.title.toLowerCase().trim();
      const id = idMap.get(key);
      if (id) {
        campaign.id = id;
        campaign.url = BASE_URL + id;
        patched++;
      }
    }
  }
  if (patched > 0) console.log(`[fetch_all_docs] Patched ${patched} campaigns with missing IDs`);

  // Step 4: Fetch docs for all campaigns that have an ID
  const withId = campaigns.filter(c => c.id);
  const withoutId = campaigns.filter(c => !c.id);
  console.log(`[fetch_all_docs] Fetching docs for ${withId.length} campaigns (${withoutId.length} have no ID yet)`);

  const stats = { fetched: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };
  const startTime = Date.now();

  for (let i = 0; i < campaigns.length; i += CONCURRENCY) {
    const batch = campaigns.slice(i, i + CONCURRENCY);
    await processBatch(batch, stats);
    if (i + CONCURRENCY < campaigns.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
    if ((i + CONCURRENCY) % 100 === 0 || i + CONCURRENCY >= campaigns.length) {
      const pct = Math.min(100, Math.round(((i + CONCURRENCY) / campaigns.length) * 100));
      console.log(`[progress] ${pct}% — fetched=${stats.fetched} updated=${stats.updated} errors=${stats.errors}`);
    }
  }

  // Step 5: Save
  const payload = JSON.stringify(campaigns, null, 2);
  fs.writeFileSync(CAMPAIGNS_FILE, payload, 'utf8');
  fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), `window.CAMPAIGNS_DATA = ${payload};`, 'utf8');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[fetch_all_docs] Done in ${elapsed}s`);
  console.log(`  IDs patched: ${patched}`);
  console.log(`  Fetched:     ${stats.fetched}`);
  console.log(`  Updated:     ${stats.updated} campaigns got new docs`);
  console.log(`  Unchanged:   ${stats.unchanged}`);
  console.log(`  Skipped:     ${stats.skipped} (no ID)`);
  console.log(`  Errors:      ${stats.errors}`);
}

main().catch(e => {
  console.error('[fetch_all_docs] Fatal error:', e);
  process.exit(1);
});
