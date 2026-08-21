#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { chromium } = require('playwright');

const DISCOVER_URL = "https://contentrewards.com/discover";
const STATE_FILE = path.join(__dirname, "seen_campaigns.json");
const DATA_EXPORT_FILE = path.join(__dirname, "campaigns.json");
const DATA_EXPORT_FILE_FILES = path.join(__dirname, "files", "campaigns.json");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || "";

function getValidSiteUrl() {
  let raw = process.env.PUBLIC_SITE_URL || "https://trackerwhop.vercel.app";
  raw = String(raw).trim();
  if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
    raw = `https://${raw}`;
  }
  return raw.replace(/\/$/, '');
}

const PUBLIC_SITE_URL = getValidSiteUrl();

function fetchHtmlViaHttps() {
  return new Promise((resolve, reject) => {
    const req = https.get(DISCOVER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ rawHtml: data, text: data, cardData: [] }));
    });
    req.on('error', err => reject(err));
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('HTTPS request timeout')); });
  });
}

async function fetchPageData() {
  try {
    const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    try {
      const page = await browser.newPage();
      await page.goto(DISCOVER_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
      try {
        await page.waitForSelector('button[aria-label*="campaign"]', { timeout: 8000 });
      } catch (e) {}
      
      // Auto-scroll to load all campaign cards
      try {
        await page.evaluate(async () => {
          for (let i = 0; i < 4; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            await new Promise(r => setTimeout(r, 400));
          }
        });
      } catch (e) {}
      await page.waitForTimeout(500);

      const rawHtml = await page.content();
      const text = await page.innerText('body');

      const cardData = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button[aria-label*="campaign"]'));
        return buttons.map(b => {
          const label = b.getAttribute('aria-label') || '';
          const t = b.innerText || '';
          const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
          
          // Extract attached resource links directly from card & parent containers
          const linkElements = Array.from(b.querySelectorAll('a[href], [role="link"][href]'));
          const resources = linkElements.map(a => {
            const href = a.getAttribute('href') || a.href || '';
            const name = a.innerText.trim() || 'Campaign Resource';
            return { name, url: href };
          }).filter(r => r.url && !r.url.startsWith('javascript:'));

          return { label, text: t, lines, resources };
        });
      });

      await browser.close();
      return { text, rawHtml, cardData };
    } catch (err) {
      try { await browser.close(); } catch (e) {}
      console.warn('[scraper] Chromium scrape failed, falling back to HTTPS fetch:', err.message);
      return await fetchHtmlViaHttps();
    }
  } catch (err) {
    console.warn('[scraper] Playwright launch failed, falling back to HTTPS fetch:', err.message);
    return await fetchHtmlViaHttps();
  }
}

function detectPlatforms(textStr = "") {
  const s = textStr.toLowerCase();
  const platforms = [];

  if (s.includes('tiktok') || s.includes('tt ') || s.includes('tt/') || s.includes('tok')) platforms.push('tiktok');
  if (s.includes('instagram') || s.includes('reels') || s.includes('ig ') || s.includes('ig/')) platforms.push('instagram');
  if (s.includes('youtube') || s.includes('shorts') || s.includes('yt ') || s.includes('yt/')) platforms.push('youtube');
  if (s.includes('twitter') || s.includes('x.com') || s.includes(' x ') || s.includes('x/')) platforms.push('x');
  if (s.includes('facebook') || s.includes('fb')) platforms.push('facebook');

  if (platforms.length === 0) {
    return ['tiktok', 'instagram', 'youtube'];
  }
  return platforms;
}

function detectContentType(textStr = "") {
  const s = textStr.toLowerCase();
  const ugcKeywords = [
    'ugc', 'user generated', 'creator', 'face-cam', 'pov', 'review', 'unboxing', 
    'filming yourself', 'reacting to', 'talking head', 'script', 'voiceover',
    'face + faceless', 'vlog', 'product review', 'unboxing video'
  ];
  if (ugcKeywords.some(kw => s.includes(kw))) {
    return "UGC";
  }
  return "Clipping";
}

function normalizeCategory(catStr = "") {
  if (!catStr) return "Entertainment";
  const s = catStr.trim().toLowerCase();
  if (s.includes('music') || s.includes('song') || s.includes('audio') || s.includes('pop') || s.includes('rap')) return "Music";
  if (s.includes('game') || s.includes('gaming') || s.includes('esports') || s.includes('roblox') || s.includes('fortnite')) return "Gaming";
  if (s.includes('sport') || s.includes('fitness') || s.includes('nba') || s.includes('football')) return "Sports";
  if (s.includes('educat') || s.includes('learn') || s.includes('course') || s.includes('finance') || s.includes('trading')) return "Education";
  if (s.includes('style') || s.includes('fashion') || s.includes('vlog') || s.includes('beauty') || s.includes('life')) return "Lifestyle";
  if (s.includes('tech') || s.includes('ai') || s.includes('software') || s.includes('app') || s.includes('crypto')) return "Technology";
  if (s.includes('entertain') || s.includes('comedy') || s.includes('meme') || s.includes('movie') || s.includes('show')) return "Entertainment";
  return catStr.charAt(0).toUpperCase() + catStr.slice(1);
}

function extractRequirements(textStr = "", lines = []) {
  const reqs = [];

  if (Array.isArray(lines)) {
    let inReq = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^(content\s+)?requirements/i.test(trimmed)) {
        inReq = true;
        continue;
      }
      if (inReq) {
        if (/^(join campaign|submit|budget|\$[\d,]+|resources|allowed platforms)/i.test(trimmed)) break;
        if (trimmed.length > 3 && !trimmed.includes('Show more') && !trimmed.includes('Show less')) {
          // If the line contains multiple bullet points or spaced items
          const parts = trimmed.split(/\s{3,}|\t+|\n+/).map(p => p.trim()).filter(p => p.length > 3);
          if (parts.length > 1) {
            parts.forEach(p => reqs.push(p));
          } else {
            reqs.push(trimmed);
          }
        }
      }
    }
  }

  // Deduplicate and keep exact authentic wording
  return Array.from(new Set(reqs));
}

const DISCORD_CONFIG_FILE = path.join(__dirname, "discord_config.json");

function loadDiscordConfig() {
  const defaultConfig = {
    webhookUrl: DISCORD_WEBHOOK_URL,
    categories: ["All"],
    contentTypes: ["All"],
    minCpm: 0
  };
  try {
    if (fs.existsSync(DISCORD_CONFIG_FILE)) {
      const raw = fs.readFileSync(DISCORD_CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...defaultConfig, ...parsed };
    }
  } catch (e) {}
  return defaultConfig;
}

function saveDiscordConfig(cfg) {
  try {
    fs.writeFileSync(DISCORD_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) {}
}

function shouldSendDiscord(campaign) {
  const cfg = loadDiscordConfig();
  const webhookUrl = cfg.webhookUrl || DISCORD_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.includes("PUT_YOUR")) return false;

  if (cfg.minCpm && campaign.cpm < cfg.minCpm) return false;

  const activeCats = (cfg.categories || ["All"]).map(c => c.toLowerCase());
  if (!activeCats.includes("all") && !activeCats.includes("all categories")) {
    const cCat = (campaign.category || "Entertainment").toLowerCase();
    const matched = activeCats.some(ac => ac === cCat || cCat.includes(ac) || ac.includes(cCat));
    if (!matched) return false;
  }

  const activeTypes = (cfg.contentTypes || ["All"]).map(t => t.toLowerCase());
  if (!activeTypes.includes("all") && !activeTypes.includes("all content types")) {
    const cType = (campaign.contentType || "Clipping").toLowerCase();
    const matched = activeTypes.some(at => at === cType || cType.includes(at));
    if (!matched) return false;
  }

  return true;
}

function normalizeKey(str = "") {
  return String(str || "")
    .toLowerCase()
    .replace(/^featured\s+/i, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getCampaignKeys(campaign) {
  if (!campaign) return [];
  const keys = [];
  if (campaign.id && String(campaign.id).length >= 8) {
    keys.push(`id::${String(campaign.id).toLowerCase().trim()}`);
  }
  const normTitle = normalizeKey(campaign.title);
  const normAgency = normalizeKey(campaign.agency);
  if (normTitle) {
    if (normAgency) keys.push(`${normAgency}::${normTitle}`);
    keys.push(`title::${normTitle}`);
  }
  if (campaign.key) {
    keys.push(campaign.key);
  }
  return keys;
}

function parseAgeToMs(ageStr) {
  if (!ageStr) return 86400000;
  const s = ageStr.trim().toLowerCase();
  const num = parseInt(s) || 1;
  if (s.includes('mo')) return num * 30 * 24 * 3600 * 1000;
  if (s.includes('w'))  return num * 7 * 24 * 3600 * 1000;
  if (s.includes('d'))  return num * 24 * 3600 * 1000;
  if (s.includes('h'))  return num * 3600 * 1000;
  if (s.includes('m'))  return num * 60 * 1000;
  return 86400000;
}

function formatTimeAgo(ageStr) {
  if (!ageStr) return "Recent";
  const s = String(ageStr).trim().toLowerCase();
  
  if (s.includes('ago')) {
    return ageStr.replace(/\s+ago\s+ago/gi, ' ago');
  }
  
  const mMatch = s.match(/^(\d+)\s*m$/);
  if (mMatch) {
    const m = parseInt(mMatch[1], 10);
    return `${m}m ago (Just now)`;
  }
  
  const hMatch = s.match(/^(\d+)\s*h$/);
  if (hMatch) {
    const h = parseInt(hMatch[1], 10);
    return `${h}h ago (Today)`;
  }
  
  const dMatch = s.match(/^(\d+)\s*d$/);
  if (dMatch) {
    const d = parseInt(dMatch[1], 10);
    if (d === 1) return `1 day ago`;
    if (d >= 7 && d % 7 === 0) {
      const w = d / 7;
      return `${w} week${w > 1 ? 's' : ''} ago`;
    }
    return `${d} days ago`;
  }
  
  const wMatch = s.match(/^(\d+)\s*w$/);
  if (wMatch) {
    const w = parseInt(wMatch[1], 10);
    return `${w} week${w > 1 ? 's' : ''} ago`;
  }
  
  const moMatch = s.match(/^(\d+)\s*mo$/);
  if (moMatch) {
    const mo = parseInt(moMatch[1], 10);
    return `${mo} month${mo > 1 ? 's' : ''} ago`;
  }
  
  return `${ageStr} ago`;
}

function extractCampaignResources(title = "", description = "", cardResources = [], whopProductRoute = "") {
  const resources = [];
  const seenUrls = new Set();

  function addResource(name, url) {
    if (!url || typeof url !== 'string') return;
    const cleanUrl = url.replace(/\\"/g, '').replace(/\\n/g, '').replace(/\\/g, '').trim();
    if (cleanUrl.length < 8 || cleanUrl.startsWith('javascript:')) return;
    const lower = cleanUrl.toLowerCase();
    if (seenUrls.has(lower)) return;
    seenUrls.add(lower);
    resources.push({ name, url: cleanUrl });
  }

  // 1. Direct links inside this campaign card's DOM
  if (Array.isArray(cardResources)) {
    cardResources.forEach(r => {
      if (r && r.url) {
        addResource(r.name || `${title} | Resource`, r.url);
      }
    });
  }

  // 2. Strict regex extraction from THIS campaign's description only (prevents mismatches)
  const urlRegex = /(https?:\/\/(?:docs\.google\.com|drive\.google\.com|notion\.(?:so|site)|dropbox\.com|box\.com|mega\.nz|youtu\.be|youtube\.com|discord\.(?:gg|com))[^\s"'<>\\]+)/gi;
  let match;
  while ((match = urlRegex.exec(description)) !== null) {
    const rawUrl = match[1];
    let name = `${title} | Source Document`;
    const uLower = rawUrl.toLowerCase();
    if (uLower.includes('docs.google.com')) name = `${title} | Google Doc Strategy Brief`;
    else if (uLower.includes('drive.google.com')) name = `${title} | Google Drive Assets Folder`;
    else if (uLower.includes('notion')) name = `${title} | Notion Guidelines`;
    else if (uLower.includes('dropbox')) name = `${title} | Dropbox Footage`;
    else if (uLower.includes('youtube') || uLower.includes('youtu.be')) name = `${title} | Reference Video`;
    else if (uLower.includes('discord')) name = `${title} | Creator Discord Hub`;
    
    addResource(name, rawUrl);
  }

  // 3. Official Whop Route strictly for this campaign
  if (whopProductRoute && String(whopProductRoute).trim().length > 0) {
    const cleanRoute = String(whopProductRoute).trim().replace(/^https?:\/\/(?:www\.)?whop\.com\//, '').replace(/^\//, '');
    addResource(`${title} | Official Whop Hub & Assets`, `https://whop.com/${cleanRoute}`);
  }

  return resources;
}

function parseCampaigns(rawText, rawHtml = "", cardData = null) {
  const idMap = new Map();
  const fundedMap = new Map();
  const whopRouteMap = new Map();
  const thumbMap = new Map();
  const avatarMap = new Map();
  const bannerMap = new Map();
  const creatorsMap = new Map();

  if (rawHtml) {
    // The HTML has doubly-escaped JSON inside script tags: \"id\":\"UUID\"
    // Search for \"id\":\"UUID\" then find \"title\" within a nearby window
    const ID_MARKER = '\\"id\\":\\"';
    let searchPos = 0;
    while (searchPos < rawHtml.length) {
      const idIdx = rawHtml.indexOf(ID_MARKER, searchPos);
      if (idIdx === -1) break;
      const afterMarker = idIdx + ID_MARKER.length;
      const possibleUuid = rawHtml.slice(afterMarker, afterMarker + 36);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(possibleUuid)) {
        searchPos = afterMarker;
        continue;
      }
      // Look for properties within next 3000 chars
      const window3k = rawHtml.slice(afterMarker, afterMarker + 3000);
      let titleClean = "";
      const titleMatch = window3k.match(/\\"title\\":\\"((?:[^"\\]|\\.)+?)\\"/);
      if (titleMatch) {
        titleClean = titleMatch[1].replace(/\\"/g, '"').trim().toLowerCase();
        if (titleClean && !idMap.has(titleClean)) idMap.set(titleClean, possibleUuid);
      }
      // Also extract fundedAt
      const fundedMatch = window3k.match(/\\"fundedAt\\":\\"([^\\"]+)\\"/);
      if (fundedMatch) fundedMap.set(possibleUuid, fundedMatch[1]);

      // Extract whopProductRoute
      const routeMatch = window3k.match(/(?:\\"whopProductRoute\\"|"whopProductRoute"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      if (routeMatch && routeMatch[1]) {
        const route = routeMatch[1].replace(/\\"/g, '').trim();
        if (route) {
          whopRouteMap.set(possibleUuid, route);
          if (titleClean) whopRouteMap.set(titleClean, route);
        }
      }

      // Extract thumbnail, avatar, banner, creators
      const thumbMatch = window3k.match(/(?:\\"thumbnail\\"|"thumbnail"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      if (thumbMatch && thumbMatch[1]) {
        const thumb = thumbMatch[1].replace(/\\"/g, '').trim();
        thumbMap.set(possibleUuid, thumb);
        if (titleClean) thumbMap.set(titleClean, thumb);
      }

      const avatarMatch = window3k.match(/(?:\\"avatar\\"|"avatar"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      if (avatarMatch && avatarMatch[1]) {
        const av = avatarMatch[1].replace(/\\"/g, '').trim();
        avatarMap.set(possibleUuid, av);
        if (titleClean) avatarMap.set(titleClean, av);
      }

      const bannerMatch = window3k.match(/(?:\\"bannerImageUrl\\"|"bannerImageUrl"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      if (bannerMatch && bannerMatch[1]) {
        const bn = bannerMatch[1].replace(/\\"/g, '').trim();
        bannerMap.set(possibleUuid, bn);
        if (titleClean) bannerMap.set(titleClean, bn);
      }

      const creatorsMatch = window3k.match(/(?:\\"creators\\"|"creators"):(\d+)/);
      if (creatorsMatch && creatorsMatch[1]) {
        const cr = parseInt(creatorsMatch[1], 10);
        creatorsMap.set(possibleUuid, cr);
        if (titleClean) creatorsMap.set(titleClean, cr);
      }

      searchPos = afterMarker + 36;
    }
  }

  const campaigns = [];

  if (Array.isArray(cardData) && cardData.length > 0) {
    cardData.forEach(card => {
      const lines = card.lines || [];
      if (lines.length < 4) return;

      let agency = 'Independent';
      let age = 'Recent';
      let category = 'General';
      let title = '';
      let description = '';
      let spent = 0;
      let total = 0;
      let count = '0';
      let cpm = 1;

      const dotIdx = lines.findIndex(l => l === '·' || l === '•');
      if (dotIdx >= 1) {
        agency = lines.slice(0, dotIdx).join(' ').replace(/^Featured\s+/i, '').trim();
        age = lines[dotIdx + 1] || 'Recent';
        category = lines[dotIdx + 2] || 'General';
        title = lines[dotIdx + 3] || '';
      }

      const budgetLineIdx = lines.findIndex(l => /^\$[\d,]+\/\$[\d,]+/.test(l));
      if (budgetLineIdx !== -1) {
        const bm = lines[budgetLineIdx].match(/^\$([\d,]+)\/\$([\d,]+)/);
        if (bm) {
          spent = parseInt(bm[1].replace(/,/g, ''), 10);
          total = parseInt(bm[2].replace(/,/g, ''), 10);
        }
        if (budgetLineIdx >= 1 && dotIdx >= 0) {
          description = lines.slice(dotIdx + 4, budgetLineIdx).filter(l => l !== 'Join Campaign').join(' ');
        }
        if (lines[budgetLineIdx + 1] && /^\d+[Kk.]*$/.test(lines[budgetLineIdx + 1])) {
          count = lines[budgetLineIdx + 1];
        }
        const cpmLine = lines.slice(budgetLineIdx).find(l => /^\$([\d.]+)\/1K/i.test(l));
        if (cpmLine) {
          const cm = cpmLine.match(/^\$([\d.]+)\/1K/i);
          if (cm) cpm = parseFloat(cm[1]);
        }
      }

      if (!title) title = card.label.replace(/^View\s+/i, '').replace(/\s+campaign$/i, '').trim() || 'Campaign';

      const matchedId = idMap.get(title.toLowerCase()) || idMap.get(title.slice(0, 30).toLowerCase()) || "";
      const fundedAt = matchedId ? fundedMap.get(matchedId) : null;
      const formattedAge = formatTimeAgo(age);

      const matchedRoute = (matchedId ? whopRouteMap.get(matchedId) : null) || whopRouteMap.get(title.toLowerCase()) || card.whopProductRoute || '';
      const whopUrl = matchedRoute ? `https://whop.com/${matchedRoute}` : '';
      const thumbnail = (matchedId ? thumbMap.get(matchedId) : null) || thumbMap.get(title.toLowerCase()) || card.thumbnail || '';
      const avatar = (matchedId ? avatarMap.get(matchedId) : null) || avatarMap.get(title.toLowerCase()) || card.avatar || '';
      const bannerImageUrl = (matchedId ? bannerMap.get(matchedId) : null) || bannerMap.get(title.toLowerCase()) || card.bannerImageUrl || '';
      const creators = (matchedId ? creatorsMap.get(matchedId) : null) || creatorsMap.get(title.toLowerCase()) || parseInt(count.replace(/[^0-9]/g, ''), 10) || 0;

      const ageMs = parseAgeToMs(age);
      const sortTimestamp = ageMs > 0 ? Date.now() - ageMs : (fundedAt ? new Date(fundedAt).getTime() : Date.now() - 86400000);

      const descText = description || `${agency} ${category} clipping pool.`;
      const fullText = `${title} ${agency} ${category} ${descText} ${card.text || ''}`;
      const platforms = detectPlatforms(fullText);
      const contentType = detectContentType(fullText);
      const normCategory = normalizeCategory(category);
      const requirements = extractRequirements(fullText, lines);
      const resources = extractCampaignResources(title, descText, card.resources || [], matchedRoute);

      campaigns.push({
        id: matchedId,
        url: DISCOVER_URL,
        whopProductRoute: matchedRoute,
        whop_route: matchedRoute,
        whopUrl: whopUrl,
        thumbnail,
        avatar,
        bannerImageUrl,
        creators: creators > 0 ? creators : (parseInt(count.replace(/[^0-9]/g, ''), 10) || 0),
        agency,
        age,
        formattedAge,
        fundedAt,
        sortTimestamp,
        category: normCategory,
        contentType,
        title,
        description: descText,
        requirements,
        resources,
        platforms,
        spent,
        total,
        count: count !== '0' ? count : (creators > 0 ? String(creators) : '0'),
        cpm,
        key: `${agency}::${title}`
      });
    });
  }

  campaigns.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0));
  return campaigns;
}

function loadSeen() {
  const seen = new Set();
  if (fs.existsSync(STATE_FILE)) {
    try {
      const arr = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (Array.isArray(arr)) {
        arr.forEach(k => { if (typeof k === 'string' && k) seen.add(k); });
      }
    } catch (e) {}
  }

  // Pre-seed from existing campaigns.json files so restarts never re-alert existing campaigns
  const candidateFiles = [DATA_EXPORT_FILE, DATA_EXPORT_FILE_FILES];
  for (const file of candidateFiles) {
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          list.forEach(c => {
            getCampaignKeys(c).forEach(k => seen.add(k));
          });
        }
      } catch (e) {}
    }
  }

  return seen;
}

function saveSeen(newKeys) {
  try {
    const existing = loadSeen();
    if (newKeys) {
      const keysToAdd = newKeys instanceof Set ? Array.from(newKeys) : (Array.isArray(newKeys) ? newKeys : [newKeys]);
      keysToAdd.forEach(k => {
        if (typeof k === 'string' && k) existing.add(k);
      });
    }
    const arr = Array.from(existing).sort();
    fs.writeFileSync(STATE_FILE, JSON.stringify(arr, null, 2), 'utf8');
    const filesSeen = path.join(__dirname, 'files', 'seen_campaigns.json');
    if (fs.existsSync(path.dirname(filesSeen))) {
      fs.writeFileSync(filesSeen, JSON.stringify(arr, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('[state] Error saving seen campaigns:', e.message);
  }
}

function isCampaignSeen(seenSet, campaign) {
  const keys = getCampaignKeys(campaign);
  return keys.some(k => seenSet.has(k));
}

function isFreshCampaign(campaign) {
  if (!campaign) return false;

  // Check authentic card creation age (e.g. "25m", "2h", "1d", "3mo")
  const ageStr = (campaign.formattedAge || campaign.age || '').toLowerCase().trim();
  if (!ageStr) return false;

  // Definite old indicators: months, years, weeks, days (word boundaries prevent matching "now" or "promo")
  if (/\b\d+\s*(?:mo|month|months|yr|year|years|w|week|weeks)\b/.test(ageStr)) return false;
  if (/\b\d+\s*(?:d|day|days)\b/.test(ageStr)) return false;

  // Fresh indicators: minutes or "just now"
  if (ageStr.includes('m ago') || ageStr.includes('min') || ageStr.includes('just now') || /^\d+m$/.test(ageStr)) {
    return true;
  }

  // Hour indicators: check number of hours (must be <= 20h)
  const hMatch = ageStr.match(/(\d+)\s*(?:h|hr|hrs|hour|hours)/);
  if (hMatch) {
    const hours = parseInt(hMatch[1], 10);
    return hours <= 20;
  }

  // Unknown or generic labels (e.g. "Recent", "Active") should NOT be treated as fresh alerts
  return false;
}

function sanitizeUnicodeTerminators(obj) {
  if (typeof obj === 'string') return obj.replace(/[\u2028\u2029\u0085]/g, '\n');
  if (Array.isArray(obj)) return obj.map(sanitizeUnicodeTerminators);
  if (obj && typeof obj === 'object') {
    const res = {};
    for (const k in obj) res[k] = sanitizeUnicodeTerminators(obj[k]);
    return res;
  }
  return obj;
}

function writeCampaignExports(campaigns) {
  try {
    const cleanCampaigns = sanitizeUnicodeTerminators(campaigns);
    const payload = JSON.stringify(cleanCampaigns, null, 2);
    const payloadJs = `window.CAMPAIGNS_DATA = ${payload};`;
    fs.writeFileSync(DATA_EXPORT_FILE, payload, 'utf8');
    if (fs.existsSync(path.dirname(DATA_EXPORT_FILE_FILES))) {
      fs.writeFileSync(DATA_EXPORT_FILE_FILES, payload, 'utf8');
    }
    fs.writeFileSync(path.join(__dirname, "campaigns_data.js"), payloadJs, 'utf8');
    const filesJs = path.join(__dirname, "files", "campaigns_data.js");
    if (fs.existsSync(path.dirname(filesJs))) {
      fs.writeFileSync(filesJs, payloadJs, 'utf8');
    }
  } catch (e) {
    console.error('[export] Failed to write campaign files:', e.message);
  }
}

function sendTelegram(campaign) {
  const remaining = Math.max(0, campaign.total - campaign.spent);
  const pctUsed = campaign.total > 0 ? Math.min(100, Math.round((campaign.spent / campaign.total) * 100)) : 0;
  const pctLeft = 100 - pctUsed;
  const isBrandNew = isFreshCampaign(campaign) && pctUsed < 15;
  const headerIcon = isBrandNew ? '⚡ <b>NEW CAMPAIGN DROP!</b>' : '🔄 <b>POOL REFILL / ACTIVE UPDATE!</b>';
  const directLink = DISCOVER_URL;
  const postedText = campaign.formattedAge || campaign.age || "Recent";

  const platformIconsMap = { tiktok: '🎵 TikTok', instagram: '📸 Instagram', youtube: '▶ YouTube Shorts', x: '✖ X (Twitter)', facebook: '📘 Facebook' };
  const platList = Array.isArray(campaign.platforms) && campaign.platforms.length > 0 ? campaign.platforms : detectPlatforms(`${campaign.title} ${campaign.agency} ${campaign.description}`);
  const platStr = platList.map(p => platformIconsMap[p.toLowerCase()] || p).join(' • ');

  const text = 
    `${headerIcon}\n` +
    `<b>${escapeHtml(campaign.title)}</b>\n\n` +
    `🏢 <b>Agency:</b> <code>${escapeHtml(campaign.agency)}</code>\n` +
    `🏷️ <b>Category:</b> <code>${escapeHtml(campaign.category)}</code>\n` +
    `📱 <b>Allowed Platforms:</b> <code>${escapeHtml(platStr)}</code>\n` +
    `🕒 <b>Original Launch:</b> <code>${escapeHtml(postedText)}</code>\n` +
    `💰 <b>CPM Rate:</b> <b>$${campaign.cpm.toFixed(2)} / 1K views</b>\n` +
    `🏦 <b>Remaining Pool:</b> <b>$${remaining.toLocaleString()} left (${pctLeft}%)</b>\n` +
    `📊 <b>Claimed / Total:</b> $${campaign.spent.toLocaleString()} / $${campaign.total.toLocaleString()} (${pctUsed}% used)\n\n` +
    `👉 <a href="${directLink}"><b>Open Content Rewards Discover ↗</b></a>`;

  const payload = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: false
  });

  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, res => {
    if (res.statusCode >= 400) {
      console.error(`[error] Telegram status: ${res.statusCode}`);
    }
  });
  req.on('error', err => console.error('[error] Telegram send error:', err.message));
  req.write(payload);
  req.end();
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendDiscord(campaign, overrideUrl = null) {
  const cfg = loadDiscordConfig();
  const targetWebhookUrl = overrideUrl || cfg.webhookUrl || DISCORD_WEBHOOK_URL;
  if (!targetWebhookUrl || targetWebhookUrl.includes("PUT_YOUR")) return;

  if (!overrideUrl && !shouldSendDiscord(campaign)) {
    console.log(`[discord] Skipping "${campaign.title}" (${campaign.category} | ${campaign.contentType}) — filtered out by webhook settings`);
    return;
  }
  
  const remaining = Math.max(0, campaign.total - campaign.spent);
  const pctUsed = campaign.total > 0 ? Math.min(100, Math.round((campaign.spent / campaign.total) * 100)) : 0;
  const pctLeft = 100 - pctUsed;
  const estSubs = campaign.cpm > 0 ? Math.round((campaign.spent || 0) / campaign.cpm * 1000) : 0;
  const postedText = campaign.formattedAge || campaign.age || "Just Now";
  const searchUrl = `${DISCOVER_URL}#search=${encodeURIComponent(campaign.title)}`;
  const siteFetchUrl = `${PUBLIC_SITE_URL}/?category=${encodeURIComponent(campaign.category || 'All')}&content=${encodeURIComponent(campaign.contentType || 'Clipping')}&search=${encodeURIComponent(campaign.title)}`;

  const platformIconsMap = { tiktok: '🎵 TikTok', instagram: '📸 Instagram', youtube: '▶ YouTube Shorts', x: '✖ X (Twitter)', facebook: '📘 Facebook' };
  const platList = Array.isArray(campaign.platforms) && campaign.platforms.length > 0 ? campaign.platforms : detectPlatforms(`${campaign.title} ${campaign.agency} ${campaign.description}`);
  const platStr = platList.map(p => platformIconsMap[p.toLowerCase()] || p).join(' • ');

  let embedColor = 0x00F2FE; // Cyber Cyan default
  let cpmBadge = "💰 Standard Payout";
  if (campaign.cpm >= 3.00) {
    embedColor = 0x00FF88; // Neon Green High Payer
    cpmBadge = "🔥 HIGH PAYER ($3+/1K)";
  } else if (campaign.cpm >= 2.00) {
    embedColor = 0x00F2FE; // Cyber Cyan Premium
    cpmBadge = "⚡ PREMIUM RATE ($2+/1K)";
  } else if (campaign.cpm < 1.00) {
    embedColor = 0xFFB800; // Gold
    cpmBadge = "🎯 Low CPM Volume";
  }

  const statusIndicator = pctLeft > 50 ? "🟢 Fresh Pool" : pctLeft > 20 ? "🟡 Active Pool" : "🔴 Filling Fast";

  const rawDesc = (campaign.description || "No description provided.").replace(/["\\]/g, '').trim();
  const briefSnippet = rawDesc.length > 280 ? rawDesc.slice(0, 280) + '...' : rawDesc;

  const isBrandNew = isFreshCampaign(campaign) && pctUsed < 15;
  const alertTitlePrefix = isBrandNew ? '⚡ NEW CAMPAIGN DROP' : '🔄 POOL REFILL / ACTIVE UPDATE';
  const dropTypeBadge = isBrandNew ? '🚀 Brand New Launch' : '🔄 Active / Refilled Pool';

  const payload = JSON.stringify({
    username: "Content Rewards Radar",
    avatar_url: "https://contentrewards.com/logos/app/gradient.png",
    embeds: [{
      title: `${alertTitlePrefix}: ${campaign.title.slice(0, 170)}`,
      url: siteFetchUrl,
      color: embedColor,
      description: 
        `> **${dropTypeBadge}** • **${cpmBadge}** • **${statusIndicator}**\n\n` +
        `🏢 **Agency:** \`${campaign.agency}\`\n` +
        `🏷️ **Category:** \`${campaign.category || 'General'}\`\n` +
        `📹 **Content Type:** \`${campaign.contentType || 'Clipping'}\`\n` +
        `📱 **Allowed Platforms:** \`${platStr}\`\n` +
        `🕒 **Original Launch:** \`${postedText}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      fields: [
        {
          name: "💰 CPM Rate",
          value: `**$${campaign.cpm.toFixed(2)}** / 1K views`,
          inline: true
        },
        {
          name: "🏦 Remaining Pool",
          value: `**$${remaining.toLocaleString()}** left (\`${pctLeft}% left\`)`,
          inline: true
        },
        {
          name: "📊 Claimed / Total",
          value: `**$${campaign.spent.toLocaleString()}** / **$${campaign.total.toLocaleString()}** (\`${pctUsed}% used\`)`,
          inline: true
        },
        {
          name: "📈 Est. Submissions",
          value: `**${estSubs.toLocaleString()}** paid clips`,
          inline: true
        },
        {
          name: "📱 Allowed Platforms",
          value: `\`${platStr}\``,
          inline: false
        },
        {
          name: "📝 Campaign Brief",
          value: `\`\`\`${briefSnippet}\`\`\``,
          inline: false
        },
        {
          name: "🚀 Quick Actions",
          value: `[**👉 Fetch & Open from Site ↗**](${siteFetchUrl})\n[**⚡ Open Direct on Content Rewards ↗**](${searchUrl})`,
          inline: false
        }
      ],
      footer: {
        text: "Content Rewards Radar • Instant Discord Webhook",
        icon_url: "https://contentrewards.com/logos/app/gradient.png"
      },
      timestamp: new Date().toISOString()
    }]
  });

  const req = https.request(targetWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`[discord] Alert sent for "${campaign.title}" (${campaign.category} | ${campaign.contentType})`);
    } else {
      console.error(`[error] Discord webhook status: ${res.statusCode}`);
    }
  });
  req.on('error', err => console.error('[error] Discord webhook request failed:', err.message));
  req.write(payload);
  req.end();
}

function sendDiscordDigest(campaigns) {
  const remaining = campaigns.reduce((acc, c) => acc + Math.max(0, c.total - c.spent), 0);
  const avgCpm = campaigns.length > 0 ? campaigns.reduce((acc, c) => acc + c.cpm, 0) / campaigns.length : 0;
  const topCpm = [...campaigns].sort((a, b) => b.cpm - a.cpm).slice(0, 3);
  const topCpmText = topCpm.map(c => `• [**${c.title.slice(0, 35)}**](${DISCOVER_URL}) (\`${c.agency}\`) — **$${c.cpm.toFixed(2)}**/1K`).join("\n");
  const topPool = [...campaigns].sort((a, b) => (b.total - b.spent) - (a.total - a.spent)).slice(0, 3);
  const topPoolText = topPool.map(c => `• [**${c.title.slice(0, 35)}**](${DISCOVER_URL}) — **$${Math.max(0, c.total - c.spent).toLocaleString()}** left`).join("\n");

  const payload = JSON.stringify({
    embeds: [{
      title: "📊 Content Rewards Intelligence Market Digest",
      url: DISCOVER_URL,
      description: `Market recap across **${campaigns.length} active campaigns** sorted by newest drops.`,
      color: 0x00F2FE,
      fields: [
        { name: "🏦 Remaining Reward Pool", value: `**$${remaining.toLocaleString()}**`, inline: true },
        { name: "💰 Average CPM Rate", value: `**$${avgCpm.toFixed(2)}** / 1K`, inline: true },
        { name: "🎯 Active Campaigns", value: `**${campaigns.length}** pools`, inline: true },
        { name: "🏆 Top Highest Paying Campaigns", value: topCpmText || "None", inline: false },
        { name: "🏦 Largest Remaining Pools", value: topPoolText || "None", inline: false }
      ],
      footer: { text: "Content Rewards Daily Digest" },
      timestamp: new Date().toISOString()
    }]
  });

  const req = https.request(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, res => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log("[digest] Sent market digest to Discord!");
    }
  });
  req.on('error', err => console.error('[error] Digest failed:', err.message));
  req.write(payload);
  req.end();
}

function parseInterval(val) {
  if (!val) return 300;
  val = String(val).trim().toLowerCase();
  const mH = val.match(/^([\d.]+)\s*(?:h|hr|hrs|hour|hours)$/);
  if (mH) return Math.max(1, Math.round(parseFloat(mH[1]) * 3600));
  const mM = val.match(/^([\d.]+)\s*(?:m|min|mins|minute|minutes)$/);
  if (mM) return Math.max(1, Math.round(parseFloat(mM[1]) * 60));
  const mS = val.match(/^([\d.]+)\s*(?:s|sec|secs)?$/);
  if (mS) return Math.max(1, Math.round(parseFloat(mS[1])));
  return 300;
}

async function runOnce(notify = "both") {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  let data = null;
  try {
    data = await fetchPageData();
  } catch (e) {
    console.error(`[${now}] fetch failed:`, e.message);
    return;
  }

  const campaigns = parseCampaigns(data.text, data.rawHtml, data.cardData);
  if (campaigns.length === 0) {
    console.log(`[${now}] parsed 0 campaigns -- check page layout`);
    return;
  }

  const seen = loadSeen();
  const isFirstRun = seen.size === 0;
  const newOnes = campaigns.filter(c => !isCampaignSeen(seen, c));

  if (isFirstRun) {
    console.log(`[${now}] baseline recorded: ${campaigns.length} existing campaigns stored`);
    const allKeys = new Set();
    campaigns.forEach(c => getCampaignKeys(c).forEach(k => allKeys.add(k)));
    saveSeen(allKeys);
  } else if (newOnes.length > 0) {
    let sentCount = 0;
    for (const c of newOnes) {
      if (isFreshCampaign(c)) {
        sendDiscord(c);
        sendTelegram(c);
        sentCount++;
        getCampaignKeys(c).forEach(k => seen.add(k));
        await new Promise(r => setTimeout(r, 600));
      } else {
        console.log(`[skip] Suppressed old campaign alert for "${c.title}" (${c.age || c.formattedAge})`);
        getCampaignKeys(c).forEach(k => seen.add(k));
      }
    }
    console.log(`[${now}] processed ${newOnes.length} unflagged campaign(s) (${sentCount} fresh alerts sent)`);
  } else {
    console.log(`[${now}] checked, no new campaigns (${campaigns.length} total on board)`);
  }

  const allCurrentKeys = new Set();
  campaigns.forEach(c => getCampaignKeys(c).forEach(k => allCurrentKeys.add(k)));
  saveSeen(allCurrentKeys);

  // Preserve existing verified resources from previous snapshot so GitHub Actions
  // never overwrites manually curated Google Docs / strategy briefs
  if (fs.existsSync(DATA_EXPORT_FILE)) {
    try {
      const prevData = JSON.parse(fs.readFileSync(DATA_EXPORT_FILE, 'utf8'));
      if (Array.isArray(prevData)) {
        // Build lookup map: key -> resources from previous snapshot
        const prevResourceMap = new Map();
        prevData.forEach(prev => {
          if (Array.isArray(prev.resources) && prev.resources.length > 0) {
            const hasGenuineDocs = prev.resources.some(r => r.url && (
              r.url.includes('docs.google.com') ||
              r.url.includes('drive.google.com') ||
              r.url.includes('notion.so') ||
              r.url.includes('notion.site') ||
              r.url.includes('dropbox.com') ||
              r.url.includes('discord.gg') ||
              r.url.includes('discord.com')
            ));
            if (hasGenuineDocs) {
              const tKey = (prev.title || '').toLowerCase().trim();
              if (tKey) prevResourceMap.set(tKey, prev.resources);
            }
          }
        });
        // Merge: apply preserved resources to freshly scraped campaigns
        if (prevResourceMap.size > 0) {
          campaigns.forEach(c => {
            const tKey = (c.title || '').toLowerCase().trim();
            const preserved = prevResourceMap.get(tKey);
            if (preserved && (!Array.isArray(c.resources) || c.resources.length === 0)) {
              c.resources = preserved;
            }
          });
          console.log(`[export] Preserved verified resources for ${prevResourceMap.size} campaigns`);
        }
      }
    } catch (e) {
      console.warn('[export] Could not load previous snapshot for resource preservation:', e.message);
    }
  }

  writeCampaignExports(campaigns);
}

// ─── Local HTTP API Server ────────────────────────────────────────────────────
// Allows the SIGNAL dashboard (index.html) to fetch live data directly from
// contentrewards.com without CORS issues, since both run on the same machine.
//
//  GET  http://localhost:3001/api/campaigns  → returns current campaigns.json
//  POST http://localhost:3001/api/refresh    → runs a live Playwright scrape
//                                              and returns fresh JSON
// ─────────────────────────────────────────────────────────────────────────────

const API_PORT = process.env.PORT || process.env.API_PORT || 3001;
let isRefreshing = false;  // prevent concurrent Playwright scrapes

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
}

function startApiServer() {
  const server = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return res.end();
    }

    const url = req.url.split('?')[0];

    // Dedicated health check route for Railway container probes
    if (req.method === 'GET' && (url === '/health' || url === '/api/ping')) {
      return sendJson(res, 200, { ok: true, status: 'running', service: 'SIGNAL Campaign Monitor API' });
    }

    // Serve main index.html Web Dashboard UI when opening root domain in browser
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      try {
        const indexPath = path.join(__dirname, 'index.html');
        if (fs.existsSync(indexPath)) {
          const html = fs.readFileSync(indexPath, 'utf8');
          res.writeHead(200, { 
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
          });
          return res.end(html);
        }
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: 'Could not load index.html' });
      }
    }

    // Serve static files (.js, .css, .json, .png, .jpg, .ico, .svg)
    if (req.method === 'GET' && /\.(js|css|json|png|jpg|jpeg|ico|svg)$/i.test(url)) {
      try {
        const relPath = url.replace(/^\//, '');
        const filePath = path.join(__dirname, relPath);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          let contentType = 'text/plain';
          if (url.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
          else if (url.endsWith('.css')) contentType = 'text/css; charset=utf-8';
          else if (url.endsWith('.json')) contentType = 'application/json; charset=utf-8';
          else if (url.endsWith('.png')) contentType = 'image/png';
          else if (url.endsWith('.jpg') || url.endsWith('.jpeg')) contentType = 'image/jpeg';
          else if (url.endsWith('.ico')) contentType = 'image/x-icon';
          else if (url.endsWith('.svg')) contentType = 'image/svg+xml';

          res.writeHead(200, { 
            'Content-Type': contentType, 
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'max-age=300'
          });
          return res.end(fs.readFileSync(filePath));
        }
      } catch (e) {}
    }

    // GET /api/campaigns — serve current campaigns.json immediately
    if (req.method === 'GET' && url === '/api/campaigns') {
      try {
        const raw = fs.readFileSync(DATA_EXPORT_FILE, 'utf8');
        const campaigns = JSON.parse(raw);
        return sendJson(res, 200, {
          ok: true,
          count: campaigns.length,
          fetchedAt: new Date().toISOString(),
          source: 'contentrewards.com/discover (monitor cache)',
          campaigns
        });
      } catch (e) {
        return sendJson(res, 503, { ok: false, error: 'campaigns.json not available yet — monitor may still be starting' });
      }
    }

    // POST /api/refresh — run a live Playwright scrape right now
    if (req.method === 'POST' && url === '/api/refresh') {
      if (isRefreshing) {
        return sendJson(res, 429, { ok: false, error: 'A scrape is already in progress, please wait ~30 seconds' });
      }
      isRefreshing = true;
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      console.log(`[${now}] [api] Manual refresh triggered from SIGNAL dashboard`);
      try {
        const data = await fetchPageData();
        const campaigns = parseCampaigns(data.text, data.rawHtml, data.cardData);
        if (campaigns.length === 0) {
          isRefreshing = false;
          return sendJson(res, 502, { ok: false, error: 'Scrape returned 0 campaigns — contentrewards.com may have changed its layout' });
        }
        const seen = loadSeen();
        const isFirstRun = seen.size === 0;
        const newOnes = campaigns.filter(c => !isCampaignSeen(seen, c));

        if (!isFirstRun && newOnes.length > 0) {
          const recentDrops = newOnes.filter(c => isFreshCampaign(c));
          if (recentDrops.length > 0) {
            console.log(`[${now}] [api] Discovered ${recentDrops.length} brand new campaign(s) on refresh! Dispatching Discord & Telegram webhooks...`);
            for (const c of recentDrops) {
              sendDiscord(c);
              sendTelegram(c);
              getCampaignKeys(c).forEach(k => seen.add(k));
              await new Promise(r => setTimeout(r, 600));
            }
          }
        }

        const allKeys = new Set();
        campaigns.forEach(c => getCampaignKeys(c).forEach(k => allKeys.add(k)));
        saveSeen(allKeys);
        writeCampaignExports(campaigns);
        console.log(`[${now}] [api] Refresh complete — ${campaigns.length} campaigns scraped from contentrewards.com`);
        isRefreshing = false;
        return sendJson(res, 200, {
          ok: true,
          count: campaigns.length,
          fetchedAt: new Date().toISOString(),
          source: 'contentrewards.com/discover (live Playwright scrape)',
          campaigns
        });
      } catch (e) {
        isRefreshing = false;
        console.error(`[api] Refresh failed:`, e.message);
        return sendJson(res, 500, { ok: false, error: e.message });
      }
    }

    // GET /api/webhook/config — fetch current Discord webhook URL & filter settings
    if (req.method === 'GET' && url === '/api/webhook/config') {
      return sendJson(res, 200, { ok: true, config: loadDiscordConfig() });
    }

    // POST /api/webhook/config — update Discord webhook URL & category/content filters
    if (req.method === 'POST' && url === '/api/webhook/config') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const current = loadDiscordConfig();
          const updated = {
            webhookUrl: body.webhookUrl !== undefined ? body.webhookUrl : current.webhookUrl,
            categories: Array.isArray(body.categories) ? body.categories : current.categories,
            contentTypes: Array.isArray(body.contentTypes) ? body.contentTypes : current.contentTypes,
            minCpm: typeof body.minCpm === 'number' ? body.minCpm : current.minCpm
          };
          saveDiscordConfig(updated);
          console.log(`[api] Discord Webhook config updated: URL set, ${updated.categories.length} categories, ${updated.contentTypes.length} content types`);
          return sendJson(res, 200, { ok: true, config: updated });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: 'Invalid JSON body' });
        }
      });
      return;
    }

    // POST /api/webhook/test — send live test alert to Discord
    if (req.method === 'POST' && url === '/api/webhook/test') {
      let bodyStr = '';
      req.on('data', chunk => { bodyStr += chunk; });
      req.on('end', () => {
        try {
          const body = JSON.parse(bodyStr || '{}');
          const webhookUrl = body.webhookUrl || loadDiscordConfig().webhookUrl;
          if (!webhookUrl) {
            return sendJson(res, 400, { ok: false, error: 'No Discord Webhook URL provided' });
          }

          let sampleCampaign = null;
          try {
            const raw = fs.readFileSync(DATA_EXPORT_FILE, 'utf8');
            const campaigns = JSON.parse(raw);
            if (campaigns.length > 0) sampleCampaign = campaigns[0];
          } catch (e) {}

          if (!sampleCampaign) {
            sampleCampaign = {
              id: "test-id",
              url: DISCOVER_URL,
              agency: "Lyrical Lemonade Clipping",
              age: "1h",
              formattedAge: "1h ago (Today)",
              category: body.category || "Music",
              contentType: body.contentType || "Clipping",
              title: "TEST ALERT — Call It A Day Podcast Clipping Pool",
              description: "Test notification dispatched from SIGNAL Campaign Radar. Clip episodes into TikToks, Reels, and Shorts to earn $1.50 per 1,000 views.",
              platforms: ["tiktok", "instagram", "youtube"],
              spent: 250,
              total: 2500,
              count: "42",
              cpm: 2.50,
              key: "Lyrical Lemonade::Test Alert"
            };
          }

          sendDiscord(sampleCampaign, webhookUrl);
          return sendJson(res, 200, { ok: true, message: 'Test alert sent to Discord!', campaign: sampleCampaign });
        } catch (err) {
          return sendJson(res, 500, { ok: false, error: err.message });
        }
      });
      return;
    }

    // 404 for anything else
    sendJson(res, 404, { ok: false, error: 'Not found. Available: GET /api/campaigns, POST /api/refresh, GET /api/webhook/config, POST /api/webhook/config, POST /api/webhook/test' });
  });

  server.listen(API_PORT, '0.0.0.0', () => {
    console.log(`[api] SIGNAL API server running on port ${API_PORT}`);
    console.log(`[api]   GET  /api/campaigns        — current data`);
    console.log(`[api]   POST /api/refresh          — live scrape from contentrewards.com`);
    console.log(`[api]   GET  /api/webhook/config   — get Discord webhook settings`);
    console.log(`[api]   POST /api/webhook/config   — save Discord webhook settings`);
    console.log(`[api]   POST /api/webhook/test     — send test alert to Discord`);
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[api] Port ${API_PORT} already in use — API server not started (monitor may already be running)`);
    } else {
      console.error('[api] Server error:', err.message);
    }
  });
}

const { fork } = require('child_process');

function startDiscordBotIfConfigured() {
  const botToken = process.env.DISCORD_BOT_TOKEN || loadDiscordConfig().botToken;
  if (botToken && !botToken.includes("PUT_YOUR")) {
    const botScript = path.join(__dirname, 'discord_bot.js');
    if (fs.existsSync(botScript)) {
      console.log('[bot] Spawning Discord Bot process...');
      try {
        const botProc = fork(botScript, [], {
          env: { ...process.env, DISCORD_BOT_TOKEN: botToken }
        });
        botProc.on('exit', code => console.log(`[bot] Discord Bot process exited with code ${code}`));
      } catch (e) {
        console.error('[bot] Failed to spawn Discord Bot:', e.message);
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isOnce = args.includes('--once');
  const isDigest = args.includes('--digest');
  let intervalArg = "5m";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--loop' || args[i] === '--interval') {
      intervalArg = args[i + 1] || "5m";
    }
  }

  if (isDigest) {
    const data = await fetchPageData();
    const campaigns = parseCampaigns(data.text, data.rawHtml);
    sendDiscordDigest(campaigns);
    process.exit(0);
  } else if (isOnce) {
    try {
      await runOnce("both");
      process.exit(0);
    } catch (err) {
      console.error("[fatal] runOnce failed:", err.message);
      process.exit(1);
    }
  } else {
    // 1. Instantly start Web Dashboard HTTP server (<50ms) for Railway health check
    startApiServer();

    // 2. Instantly start Discord Bot supervisor
    startDiscordBotIfConfigured();

    const intervalSec = parseInterval(intervalArg);
    const readable = intervalSec >= 3600 ? `${intervalSec / 3600} hour(s)` : `${intervalSec / 60} minute(s)`;
    console.log("====================================================");
    console.log(" Content Rewards Campaign Radar (Clean URL Engine)");
    console.log(` Interval: Every ${readable}`);
    console.log(` Target: ${DISCOVER_URL}`);
    console.log(" Notifications: DISCORD & TELEGRAM");
    console.log("====================================================");

    // 3. Run background scraper loop asynchronously after 3s delay
    setTimeout(async () => {
      while (true) {
        try {
          await runOnce("both");
        } catch (ex) {
          console.error("[error] loop check error:", ex.message);
        }
        const nextDate = new Date(Date.now() + intervalSec * 1000).toISOString().slice(11, 19) + ' UTC';
        console.log(`Next automatic check scheduled in ${readable} (at ${nextDate})...`);
        await new Promise(r => setTimeout(r, intervalSec * 1000));
      }
    }, 3000);
  }
}

main();
