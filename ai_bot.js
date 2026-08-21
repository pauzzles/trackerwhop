#!/usr/bin/env node
/**
 * AI Campaign Assistant & Intelligence Matcher for Content Rewards
 * Run via: node ai_bot.js or run_ai_bot.bat
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const https = require('https');
const { exec } = require('child_process');

const CAMPAIGNS_FILE = path.join(__dirname, 'campaigns.json');

function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;

  const configPath = path.join(__dirname, 'ai_config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.apiKey) return cfg.apiKey;
    } catch (e) {}
  }

  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envRaw = fs.readFileSync(envPath, 'utf8');
      const m = envRaw.match(/GEMINI_API_KEY=([^\r\n]+)/) || envRaw.match(/AI_API_KEY=([^\r\n]+)/);
      if (m) return m[1].trim();
    } catch (e) {}
  }
  return '';
}

// Terminal ANSI styling
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgMagenta: '\x1b[45m',
  white: '\x1b[37m',
  brightWhite: '\x1b[97m'
};

function loadCampaigns() {
  try {
    if (fs.existsSync(CAMPAIGNS_FILE)) {
      const raw = fs.readFileSync(CAMPAIGNS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`${C.red}Error loading campaigns.json:${C.reset}`, err.message);
  }
  return [];
}

let allCampaigns = loadCampaigns();
let lastDisplayedList = [];

function openInBrowser(url) {
  if (!url) return;
  const startCmd = process.platform === 'win32' ? `start "" "${url}"` : `open "${url}"`;
  exec(startCmd, (err) => {
    if (err) console.log(`${C.red}Failed to open browser: ${err.message}${C.reset}`);
  });
}

function parseTimeScore(item) {
  if (item.sortTimestamp) return item.sortTimestamp;
  if (item.fundedAt) {
    const t = new Date(item.fundedAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

function extractDocumentsAndLinks(text) {
  if (!text) return [];
  const results = [];
  const urlRegex = /(https?:\/\/[^\s\)\"\'>]+)/gi;
  const matches = text.match(urlRegex) || [];

  matches.forEach(url => {
    let cleanUrl = url.replace(/[.,;:]$/, '');
    let name = cleanUrl;
    let icon = '🔗';

    if (cleanUrl.includes('drive.google.com')) { icon = '📁 Google Drive Assets'; }
    else if (cleanUrl.includes('docs.google.com')) { icon = '📄 Google Doc Brief'; }
    else if (cleanUrl.includes('notion.so') || cleanUrl.includes('notion.site')) { icon = '📝 Notion Script/Brief'; }
    else if (cleanUrl.includes('dropbox.com')) { icon = '📦 Dropbox Assets'; }
    else if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) { icon = '🎬 YouTube Reference'; }
    else if (cleanUrl.includes('discord.gg') || cleanUrl.includes('discord.com')) { icon = '💬 Discord Community'; }

    results.push({ url: cleanUrl, name, icon });
  });

  return results;
}

function printHeader() {
  console.clear();
  console.log(`${C.cyan}${C.bold}========================================================================${C.reset}`);
  console.log(`${C.brightWhite}${C.bold}    🤖 CONTENT REWARDS AI CAMPAIGN INTELLIGENCE RADAR v2.0              ${C.reset}`);
  console.log(`${C.dim}    Loaded ${allCampaigns.length} campaigns. Ask ANY question about rules, CPM, budget & assets${C.reset}`);
  console.log(`${C.cyan}========================================================================${C.reset}\n`);
  console.log(`${C.yellow}💡 Natural AI Queries & Examples:${C.reset}`);
  console.log(` • ${C.green}"tell me about MoonPay"${C.reset}         -> Deep dive brief, rules & drive links`);
  console.log(` • ${C.green}"what are the rules for wasted"${C.reset}  -> Verification & guideline checklist`);
  console.log(` • ${C.green}"where are the drive assets"${C.reset}    -> Extracts all Google Drive / Doc folders`);
  console.log(` • ${C.green}"highest cpm"${C.reset}                   -> Highest payout rates ($2.00+ / 1K views)`);
  console.log(` • ${C.green}"0 submissions"${C.reset}                 -> Fresh drops with $0 spent (unclaimed pool)`);
  console.log(` • ${C.green}"how does content rewards work"${C.reset} -> Payout mechanics, CPM and submission tips`);
  console.log(` • Type a number (e.g. ${C.bold}"1"${C.reset})             -> Instantly opens that campaign in browser`);
  console.log(` • Type ${C.green}"refresh"${C.reset}                  -> Reloads latest campaigns database`);
  console.log(` • Type ${C.green}"exit"${C.reset}                     -> Closes assistant\n`);
  console.log(`${C.dim}${'─'.repeat(72)}${C.reset}\n`);
}

function displayCampaignDossier(c) {
  const total = parseFloat(c.total) || 0;
  const spent = parseFloat(c.spent) || 0;
  const rem = Math.max(0, total - spent);
  const pctLeft = total > 0 ? Math.round((rem / total) * 100) : 0;
  const cpm = c.cpm ? `$${c.cpm.toFixed(2)}` : '$1.00';
  const age = c.formattedAge || c.age || 'Recent';
  const isFresh = spent === 0;
  const url = c.url || (c.whopProductRoute ? `https://whop.com/checkout/${c.whopProductRoute}` : 'https://contentrewards.com/discover');

  const platforms = (c.platforms || []).map(p => {
    if (p === 'tiktok') return '🎵 TikTok';
    if (p === 'instagram') return '📸 Instagram Reels';
    if (p === 'youtube') return '▶ YouTube Shorts';
    if (p === 'x') return '✖ X (Twitter)';
    return p;
  }).join(' • ') || '🎵 TikTok • 📸 Instagram Reels • ▶ YouTube Shorts';

  const docs = extractDocumentsAndLinks(c.description);
  const directResources = Array.isArray(c.resources) ? c.resources : [];
  const reqs = Array.isArray(c.requirements) && c.requirements.length > 0 ? c.requirements : [];

  lastDisplayedList = [c];

  console.log(`\n${C.bgMagenta}${C.brightWhite} 📋 CAMPAIGN DOSSIER: ${c.title.toUpperCase()} ${C.reset}\n`);
  console.log(`🏢 ${C.bold}Agency / Creator:${C.reset} ${C.magenta}${c.agency || 'Independent'}${C.reset}  |  🏷️ ${C.cyan}[${c.category || 'General'}]${C.reset} <${c.contentType || 'Clipping'}>  |  🕒 ${age}`);
  console.log(`💵 ${C.bold}Payout Rate (CPM):${C.reset} ${C.green}${C.bold}${cpm}/1K views${C.reset}  |  ${isFresh ? `${C.bgGreen}${C.brightWhite} 0 SUBS - $0 SPENT ${C.reset}` : ''}`);
  console.log(`💰 ${C.bold}Remaining Budget:${C.reset}  ${C.yellow}${C.bold}$${rem.toLocaleString()} left${C.reset} (${pctLeft}% of $${total.toLocaleString()} fund)  |  Submissions: ${c.count || 'Open'}`);
  console.log(`📱 ${C.bold}Allowed Platforms:${C.reset} ${platforms}\n`);

  console.log(`${C.bold}📝 Brief & Concept:${C.reset}`);
  console.log(`${C.dim}${c.description || 'No description provided.'}${C.reset}\n`);

  console.log(`${C.bold}✅ Verification Checklist & Rules:${C.reset}`);
  if (reqs.length > 0) {
    reqs.forEach(r => console.log(` • ${C.green}✓${C.reset} ${r}`));
  } else {
    console.log(` • Follow standard quality guidelines. Create engaging vertical edits and include official tags.`);
  }
  console.log('');

  if (docs.length > 0 || directResources.length > 0) {
    console.log(`${C.bold}📂 Source Documents & Assets:${C.reset}`);
    docs.forEach(d => console.log(` • ${C.cyan}${d.icon}:${C.reset} ${d.url}`));
    directResources.forEach(r => console.log(` • ${C.cyan}🔗 ${r.name || 'Resource'}:${C.reset} ${r.url}`));
    console.log('');
  }

  console.log(`🔗 ${C.bold}Whop Link:${C.reset} ${C.blue}${url}${C.reset}`);
  console.log(`${C.dim}${'─'.repeat(72)}${C.reset}`);
  console.log(`${C.brightWhite}👉 Type ${C.green}"1"${C.brightWhite} to open this campaign on Whop, or ask another question:${C.reset}\n`);
}

function displayResultsList(query, results, max = 10) {
  lastDisplayedList = results.slice(0, max);
  console.log(`\n${C.bgBlue}${C.brightWhite} 🎯 RESULTS: "${query.toUpperCase()}" (${results.length} found, showing top ${lastDisplayedList.length}) ${C.reset}\n`);

  if (lastDisplayedList.length === 0) {
    console.log(`${C.yellow}⚠️  No matching active campaigns found for this filter.${C.reset}`);
    console.log(`${C.dim}Try a broader search like "clipping", "music", "0 submissions", or "refresh".${C.reset}\n`);
    return;
  }

  lastDisplayedList.forEach((c, idx) => {
    const num = `[${idx + 1}]`.padEnd(5, ' ');
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    const remaining = Math.max(0, total - spent);
    const pctLeft = total > 0 ? Math.round((remaining / total) * 100) : 0;
    const cpm = c.cpm ? `$${c.cpm.toFixed(2)}` : 'N/A';
    const age = c.formattedAge || c.age || 'Recent';
    const isFresh = spent === 0;
    const platforms = (c.platforms || []).map(p => {
      if (p === 'tiktok') return '🎵 TT';
      if (p === 'instagram') return '📸 IG';
      if (p === 'youtube') return '🔴 YT';
      if (p === 'x') return '✖ X';
      return p;
    }).join(' ');

    const catBadge = `[${c.category || 'General'}]`;
    const typeBadge = `<${c.contentType || 'Clipping'}>`;

    console.log(`${C.brightWhite}${C.bold}${num} ${c.title || 'Untitled Campaign'}${C.reset}`);
    console.log(`      ${C.magenta}${c.agency || 'Independent Agency'}${C.reset}  ${C.blue}${catBadge}${C.reset} ${C.cyan}${typeBadge}${C.reset}  ${C.dim}• Posted: ${age}${C.reset}`);
    console.log(`      ${C.green}💵 CPM: ${cpm}/1k${C.reset}  |  ${C.yellow}💰 Left: $${remaining.toLocaleString()} (${pctLeft}% of $${total.toLocaleString()})${C.reset}  |  ${platforms} ${isFresh ? `${C.green}(0 Subs)${C.reset}` : ''}`);
    
    if (c.description) {
      const cleanDesc = c.description.replace(/\n+/g, ' ').slice(0, 110);
      console.log(`      ${C.dim}📝 "${cleanDesc}${cleanDesc.length >= 110 ? '...' : ''}"${C.reset}`);
    }
    console.log(`${C.dim}${'─'.repeat(72)}${C.reset}`);
  });

  console.log(`\n${C.brightWhite}👉 Type ${C.green}"1" - "${lastDisplayedList.length}"${C.brightWhite} to open in browser, or ask a specific question:${C.reset}`);
}

function callGeminiApi(userQuery, callback) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return callback(new Error('No API key'));
  }

  const model = 'gemini-3.7-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parsedUrl = new URL(url);

  // Filter top active campaigns for context
  const activeContext = allCampaigns
    .filter(c => ((parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0)) > 0)
    .slice(0, 40)
    .map(c => ({
      title: c.title,
      agency: c.agency,
      cpm: c.cpm,
      remaining: Math.max(0, (parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0)),
      spent: parseFloat(c.spent) || 0,
      submissions: c.creators || c.count || 0,
      category: c.category,
      platforms: c.platforms,
      description: (c.description || '').slice(0, 300)
    }));

  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: "You are the Content Rewards AI Copilot CLI — an expert creator strategist and campaign analyst. You help short-form video creators maximize their earnings on TikTok, Instagram Reels, and YouTube Shorts. Answer concisely with clear formatting, bold numbers ($CPM, budget), and direct insights."
      }]
    },
    contents: [{
      parts: [{ text: `Live Campaigns Data (${activeContext.length} active):\n${JSON.stringify(activeContext)}\n\nCreator Question:\n"${userQuery}"` }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  });

  const req = https.request({
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (res.statusCode === 200 && data.candidates && data.candidates[0]) {
          callback(null, data.candidates[0].content.parts[0].text);
        } else {
          callback(new Error(data.error ? data.error.message : `Status ${res.statusCode}`));
        }
      } catch (err) {
        callback(err);
      }
    });
  });

  req.on('error', err => callback(err));
  req.write(payload);
  req.end();
}

function processNaturalQuery(rawInput, doneCallback) {
  const q = rawInput.toLowerCase().trim();

  // If asking an open-ended strategic question, route to Gemini AI
  const isOpenEnded = q.includes('suggest') || q.includes('how to') || q.includes('which should') || q.includes('script') || q.includes('strategy') || q.includes('best way') || q.includes('compare') || q.includes('why') || q.includes('advice') || q.split(' ').length >= 6;

  if (isOpenEnded && getApiKey()) {
    process.stdout.write(`\n${C.cyan}✨ Gemini 3.7 Flash is analyzing live campaign database...${C.reset}\n`);
    return callGeminiApi(rawInput, (err, answer) => {
      if (!err && answer) {
        console.log(`\n${C.brightWhite}${answer.trim()}${C.reset}\n`);
        if (doneCallback) doneCallback();
      } else {
        fallbackLocalQuery(rawInput);
        if (doneCallback) doneCallback();
      }
    });
  }

  fallbackLocalQuery(rawInput);
  if (doneCallback) doneCallback();
}

function fallbackLocalQuery(rawInput) {
  const q = rawInput.toLowerCase().trim();

  // 1. Educational guides
  if (q.includes('how does content rewards work') || q.includes('how it works') || q.includes('what is content rewards')) {
    console.log(`\n${C.cyan}${C.bold}⚡ HOW CONTENT REWARDS MONETIZATION WORKS:${C.reset}\n`);
    console.log(` 1. ${C.bold}Select a Campaign:${C.reset} Browse active pools with budget remaining.`);
    console.log(` 2. ${C.bold}Create & Post Clips:${C.reset} Clip stream highlights or make UGC for TikTok, Reels, Shorts, X.`);
    console.log(` 3. ${C.bold}Submit Video URL:${C.reset} Submit your live video link through Whop.`);
    console.log(` 4. ${C.bold}Earn per 1,000 Views:${C.reset} As your views grow, CPM payouts credit to your Whop wallet.\n`);
    return;
  }

  if (q.includes('what is cpm') || q.includes('how is cpm calculated')) {
    console.log(`\n${C.cyan}${C.bold}💵 CPM (COST PER 1,000 VIEWS) BREAKDOWN:${C.reset}\n`);
    console.log(` • CPM = dollar payout per 1,000 verified views.`);
    console.log(` • ${C.green}$1.00 CPM${C.reset} -> 100K views = ${C.bold}$100.00${C.reset}`);
    console.log(` • ${C.green}$2.50 CPM${C.reset} -> 100K views = ${C.bold}$250.00${C.reset}`);
    console.log(` • ${C.green}$3.50 CPM${C.reset} -> 100K views = ${C.bold}$350.00${C.reset}\n`);
    return;
  }

  // 2. Classify Intents
  const wantsHighestCpm = q.includes('cpm') || q.includes('highest pay') || q.includes('high pay') || q.includes('top pay');
  const wantsZeroSpent = q.includes('0 sub') || q.includes('zero sub') || q.includes('0 spent') || q.includes('zero spent') || q.includes('fresh') || q.includes('unclaimed');
  const wantsBudget = q.includes('budget') || q.includes('fund') || q.includes('money');
  const wantsDocs = q.includes('drive') || q.includes('doc') || q.includes('asset') || q.includes('footage') || q.includes('b-roll');
  const wantsRules = q.includes('rule') || q.includes('requirement') || q.includes('guideline') || q.includes('restriction');

  const stopWords = new Set(['what', 'is', 'the', 'of', 'for', 'in', 'on', 'about', 'tell', 'me', 'how', 'much', 'are', 'there', 'any', 'can', 'i', 'get', 'give', 'show', 'find', 'best', 'good', 'camps', 'campaign', 'campaigns', 'active', 'all', 'please', 'with', 'from', 'does', 'a', 'an', 'to', 'and', 'or']);
  const tokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t));

  const scoredList = [];

  for (const c of allCampaigns) {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    const rem = Math.max(0, total - spent);
    const title = (c.title || '').toLowerCase();
    const desc = (c.description || '').toLowerCase();
    const agency = (c.agency || '').toLowerCase();
    const cat = (c.category || '').toLowerCase();
    const type = (c.contentType || '').toLowerCase();
    const platforms = (c.platforms || []).map(p => String(p).toLowerCase());
    const fullText = `${title} ${desc} ${agency} ${cat} ${type} ${platforms.join(' ')}`;

    let score = 0;

    // Exact title match boost
    const cleanRawQ = q.replace(/^(what is|tell me about|info on|brief for|rules for|requirements for|docs for|drive for|link for|cpm for|budget for)\s+/i, '').trim();
    if (cleanRawQ.length > 2 && title.includes(cleanRawQ)) {
      score += 150;
    }

    for (const tok of tokens) {
      if (title.includes(tok)) score += 40;
      else if (agency.includes(tok)) score += 25;
      else if (cat.includes(tok) || type.includes(tok)) score += 15;
      else if (desc.includes(tok)) score += 10;
      else if (fullText.includes(tok)) score += 5;
    }

    if (wantsZeroSpent && spent === 0) score += 35;
    if (q.includes('music') && (cat.includes('music') || desc.includes('music') || title.includes('song'))) score += 25;
    if (q.includes('podcast') && (cat.includes('personal') || desc.includes('podcast'))) score += 25;
    if (q.includes('ai') && (cat.includes('tech') || desc.includes('ai') || title.includes('ai'))) score += 25;
    if (q.includes('clip') && (type.includes('clipping') || desc.includes('clip'))) score += 20;

    if (rem > 0) score += 5;

    const ageScore = parseTimeScore(c);
    if (score > 0 || tokens.length === 0) {
      scoredList.push({ campaign: c, score, ageScore, rem, cpm: parseFloat(c.cpm) || 0 });
    }
  }

  if (wantsHighestCpm && tokens.length <= 2) {
    scoredList.sort((a, b) => b.cpm - a.cpm || b.rem - a.rem);
  } else if (wantsBudget && tokens.length <= 2) {
    scoredList.sort((a, b) => b.rem - a.rem || b.cpm - a.cpm);
  } else {
    scoredList.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.ageScore - a.ageScore;
    });
  }

  const matches = scoredList.map(item => item.campaign);

  if (matches.length === 0) {
    console.log(`\n${C.yellow}⚠️ No matching campaigns found for "${rawInput}". Try a broader search.${C.reset}\n`);
    return;
  }

  // If specific campaign inquiry or rules/docs requested for a target
  const topScore = scoredList[0].score;
  const isDirectQuestion = wantsRules || wantsDocs || cleanRawQ.length > 3 || (topScore >= 25 && tokens.length <= 4 && !wantsHighestCpm && !wantsZeroSpent);

  if (isDirectQuestion && matches.length > 0) {
    displayCampaignDossier(matches[0]);
  } else {
    displayResultsList(rawInput, matches, 12);
  }
}

function startCLI() {
  printHeader();

  // Initial fresh view
  const initial = allCampaigns.filter(c => ((parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0)) > 0).sort((a, b) => parseTimeScore(b) - parseTimeScore(a));
  displayResultsList('Latest Active Campaigns', initial, 8);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.bold}${C.cyan}AI-Radar > ${C.reset}`
  });

  rl.prompt();

  rl.on('line', (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(`\n${C.green}👋 Happy clipping & hunting bounties! Goodbye.${C.reset}\n`);
      process.exit(0);
    }

    if (input.toLowerCase() === 'cls' || input.toLowerCase() === 'clear') {
      printHeader();
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'refresh' || input.toLowerCase() === 'reload') {
      allCampaigns = loadCampaigns();
      console.log(`\n${C.green}✅ Reloaded ${allCampaigns.length} campaigns from database.${C.reset}`);
      const refreshed = allCampaigns.slice().sort((a, b) => parseTimeScore(b) - parseTimeScore(a));
      displayResultsList('Latest Campaigns', refreshed, 8);
      rl.prompt();
      return;
    }

    // Direct number selector to open campaign in browser
    let targetIndex = -1;
    if (/^\d+$/.test(input)) {
      targetIndex = parseInt(input, 10) - 1;
    } else if (/^(open|go|launch)\s+(\d+)$/i.test(input)) {
      const match = input.match(/^(open|go|launch)\s+(\d+)$/i);
      targetIndex = parseInt(match[2], 10) - 1;
    }

    if (targetIndex >= 0) {
      if (targetIndex < lastDisplayedList.length) {
        const item = lastDisplayedList[targetIndex];
        const targetUrl = item.url || (item.whopProductRoute ? `https://whop.com/checkout/${item.whopProductRoute}` : 'https://contentrewards.com/discover');
        console.log(`\n${C.green}🚀 Opening [${targetIndex + 1}] in default browser...${C.reset}`);
        console.log(`${C.cyan}${item.title}${C.reset}`);
        console.log(`${C.dim}${targetUrl}${C.reset}\n`);
        openInBrowser(targetUrl);
      } else {
        console.log(`${C.red}⚠️ Invalid choice number. Choose between 1 and ${lastDisplayedList.length}.${C.reset}`);
      }
      rl.prompt();
      return;
    }

    // Process intelligent natural query
    processNaturalQuery(input, () => {
      rl.prompt();
    });
  });
}

startCLI();
