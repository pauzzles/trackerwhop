#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

// Safely load AI Config / Key from hidden files
function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;

  const configPath = path.join(ROOT, 'ai_config.json');
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.apiKey) return cfg.apiKey;
    } catch (e) {}
  }

  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envRaw = fs.readFileSync(envPath, 'utf8');
      const m = envRaw.match(/GEMINI_API_KEY=([^\r\n]+)/) || envRaw.match(/AI_API_KEY=([^\r\n]+)/);
      if (m) return m[1].trim();
    } catch (e) {}
  }
  return '';
}

// Load campaigns database for RAG context
function getCampaignsData() {
  const filePath = path.join(ROOT, 'campaigns.json');
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {}
  }
  return [];
}

// Build concise context for Gemini
function buildContextSummary(campaigns, userQuery) {
  const q = (userQuery || '').toLowerCase();
  
  // Filter active campaigns
  let list = campaigns.filter(c => {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    return total === 0 || (total - spent) > 0;
  });

  // If asking about a specific campaign, prioritize it
  return list.map(c => {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    const rem = Math.max(0, total - spent);
    return {
      title: c.title,
      agency: c.agency,
      cpm: c.cpm,
      remainingBudget: rem,
      totalBudget: total,
      spent: spent,
      submissions: c.creators || c.count || 0,
      category: c.category,
      contentType: c.contentType,
      platforms: c.platforms,
      description: (c.description || '').slice(0, 500),
      requirements: c.requirements || [],
      url: c.url || (c.whopProductRoute ? `https://whop.com/checkout/${c.whopProductRoute}` : '')
    };
  });
}

function callGemini(prompt, userQuery, callback) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return callback(new Error('AI API Key not configured.'));
  }

  const model = 'gemini-3.7-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parsedUrl = new URL(url);

  const payload = JSON.stringify({
    systemInstruction: {
      parts: [{
        text: "You are the Content Rewards AI Copilot — an expert analyst and strategic creator advisor for short-form video bounties on Content Rewards and Whop (TikTok, Instagram Reels, YouTube Shorts, X).\n\nKey Response Rules:\n1. Always provide a complete, well-formed response and finish every sentence and thought cleanly.\n2. When recommending or analyzing campaigns, highlight the best opportunities by name (e.g. **Olympus - UGC Campaign**, **Jay Dyer Clips**) with sharp, punchy creator insights (CPM rates, remaining runway, viral angles, key requirements).\n3. Keep your written overview focused (2-4 concise paragraphs) since interactive visual campaign cards with live burn meters, direct join buttons, and Drive documents are automatically attached directly below your response."
      }]
    },
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 3500
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
        if (res.statusCode === 200 && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
          const text = data.candidates[0].content.parts[0].text;
          callback(null, text);
        } else {
          callback(new Error(data.error ? data.error.message : `API error ${res.statusCode}`));
        }
      } catch (err) {
        callback(err);
      }
    });
  });

  req.on('error', (err) => callback(err));
  req.setTimeout(25000, () => { req.destroy(); callback(new Error('Gemini API timeout')); });
  req.write(payload);
  req.end();
}

function extractMatchedCampaigns(userQuery, replyText, campaigns) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) return [];
  const q = (userQuery || '').toLowerCase();
  const reply = (replyText || '').toLowerCase();
  const matched = [];
  const seen = new Set();

  function add(c) {
    if (!c || !c.title) return;
    const key = c.title.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      matched.push(c);
    }
  }

  // 1. Direct title mentions in AI reply
  for (const c of campaigns) {
    if (!c.title) continue;
    const t = c.title.toLowerCase().trim();
    const prefix = t.split(/[-–—:|]/)[0].trim();
    if (prefix.length >= 3 && (reply.includes(t) || reply.includes(prefix))) {
      add(c);
    }
  }

  // 2. Direct title mentions in user query
  for (const c of campaigns) {
    if (!c.title) continue;
    const t = c.title.toLowerCase().trim();
    const prefix = t.split(/[-–—:|]/)[0].trim();
    if (prefix.length >= 3 && (q.includes(t) || q.includes(prefix))) {
      add(c);
    }
  }

  // 3. Fallback matching based on user query intent
  if (matched.length === 0) {
    const active = campaigns.filter(c => {
      const total = parseFloat(c.total) || 0;
      const spent = parseFloat(c.spent) || 0;
      return total === 0 || (total - spent) > 0;
    });

    if (q.includes('0 sub') || q.includes('zero sub') || q.includes('0 spent') || q.includes('unclaimed')) {
      active.filter(c => (parseFloat(c.spent) || 0) === 0).slice(0, 4).forEach(add);
    } else if (q.includes('cpm') || q.includes('rate') || q.includes('highest pay') || q.includes('pay')) {
      [...active].sort((a, b) => (parseFloat(b.cpm) || 0) - (parseFloat(a.cpm) || 0)).slice(0, 4).forEach(add);
    } else if (q.includes('budget') || q.includes('pool') || q.includes('largest') || q.includes('money')) {
      [...active].sort((a, b) => {
        const remA = Math.max(0, (parseFloat(a.total) || 0) - (parseFloat(a.spent) || 0));
        const remB = Math.max(0, (parseFloat(b.total) || 0) - (parseFloat(b.spent) || 0));
        return remB - remA;
      }).slice(0, 4).forEach(add);
    } else if (q.includes('music') || q.includes('song')) {
      active.filter(c => (c.category || '').toLowerCase().includes('music') || (c.title || '').toLowerCase().includes('song')).slice(0, 4).forEach(add);
    } else if (q.includes('podcast') || q.includes('stream')) {
      active.filter(c => (c.category || '').toLowerCase().includes('personal') || (c.description || '').toLowerCase().includes('podcast')).slice(0, 4).forEach(add);
    } else if (q.includes('ai') || q.includes('tech')) {
      active.filter(c => (c.category || '').toLowerCase().includes('tech') || (c.description || '').toLowerCase().includes('ai')).slice(0, 4).forEach(add);
    } else if (q.includes('new') || q.includes('fresh') || q.includes('camp') || q.includes('show') || q.includes('recommend') || q.includes('top')) {
      active.slice(0, 4).forEach(add);
    }
  }

  return matched.slice(0, 5);
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqPath = req.url.split('?')[0];

  // AI Chat API Endpoint
  if (reqPath === '/api/ai_chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        const userQuery = parsed.query || '';
        if (!userQuery) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Query is required' }));
          return;
        }

        const campaigns = getCampaignsData();
        const context = buildContextSummary(campaigns, userQuery);

        const prompt = `Current Live Content Rewards Campaigns Database (${context.length} active campaigns):\n${JSON.stringify(context, null, 2)}\n\nUser Question:\n"${userQuery}"\n\nPlease answer the user thoroughly based on the live campaign dataset.`;

        callGemini(prompt, userQuery, (err, reply) => {
          if (err) {
            console.error('Gemini error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          } else {
            const matchedCampaigns = extractMatchedCampaigns(userQuery, reply, campaigns);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ reply, campaigns: matchedCampaigns, provider: 'Gemini (3.7 Flash)' }));
          }
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      }
    });
    return;
  }

  if (reqPath === '/' || reqPath === '') reqPath = '/ai_copilot.html';

  const filePath = path.join(ROOT, reqPath);
  const ext = path.extname(filePath).toLowerCase();

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  const primaryIp = ips[0] || 'localhost';
  const mobileUrl = `http://${primaryIp}:${PORT}/ai_copilot.html`;

  console.clear();
  console.log('\x1b[36m\x1b[1m========================================================================\x1b[0m');
  console.log('\x1b[97m\x1b[1m    📱 CONTENT REWARDS AI — MOBILE SERVER & AI BACKEND                 \x1b[0m');
  console.log('\x1b[36m========================================================================\x1b[0m\n');
  console.log(`\x1b[32m\x1b[1m⚡ AI Engine: Google Gemini 3.7 Flash connected & ready!\x1b[0m\n`);
  console.log('\x1b[33m\x1b[1m👉 Open this link in Chrome or any browser on your Android Phone / PC:\x1b[0m\n');
  console.log(`\x1b[32m\x1b[1m    ${mobileUrl}\x1b[0m\n`);
  console.log('\x1b[36m💡 Pro Tip (Install as App on Android Home Screen):\x1b[0m');
  console.log('   1. Open the link above in Chrome on your phone.');
  console.log('   2. Tap the 3 dots (⋮) menu in Chrome.');
  console.log('   3. Tap "Add to Home screen" or "Install App".');
  console.log('   4. It will now show up as a fullscreen app icon on your phone!\n');
  console.log('\x1b[90mMake sure your phone and PC are connected to the same Wi-Fi network.\x1b[0m');
  console.log('\x1b[90mPress Ctrl+C to stop server.\x1b[0m\n');
});
