const https = require('https');
const fs = require('fs');
const path = require('path');

// --- 1. Environment & API Key Resolver ---
function getEnvKey(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const configPath = path.join(process.cwd(), 'ai_config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg[name]) return cfg[name].trim();
      if (name === 'GEMINI_API_KEY' && cfg.apiKey) return cfg.apiKey.trim();
    }
  } catch (e) {}
  return '';
}

function getCampaignsData() {
  // 1. Try campaigns.json
  try {
    const filePath = path.join(process.cwd(), 'campaigns.json');
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (e) {}

  // 2. Try campaigns_data.js
  try {
    const jsPath = path.join(process.cwd(), 'campaigns_data.js');
    if (fs.existsSync(jsPath)) {
      const raw = fs.readFileSync(jsPath, 'utf8');
      const jsonMatch = raw.match(/window\.CAMPAIGNS_DATA\s*=\s*(\[[\s\S]*\]);/);
      if (jsonMatch) return JSON.parse(jsonMatch[1]);
    }
  } catch (e) {}

  return [];
}

function scoreCampaignForQuery(c, userQuery) {
  if (!c) return 0;
  const q = (userQuery || '').toLowerCase();
  if (!q) return 0;

  const title = (c.title || '').toLowerCase();
  const desc = (c.description || '').toLowerCase();
  const agency = (c.agency || '').toLowerCase();
  const cat = (c.category || '').toLowerCase();
  const type = (c.contentType || '').toLowerCase();
  const reqs = (c.requirements || []).join(' ').toLowerCase();
  const platforms = (c.platforms || []).join(' ').toLowerCase();
  const fullText = `${title} ${desc} ${agency} ${cat} ${type} ${reqs} ${platforms}`;

  let score = 0;

  const stopWords = new Set(['what', 'is', 'the', 'of', 'for', 'in', 'on', 'about', 'tell', 'me', 'how', 'much', 'are', 'there', 'any', 'can', 'i', 'get', 'give', 'show', 'find', 'best', 'good', 'camps', 'campaign', 'campaigns', 'active', 'all', 'please', 'with', 'from', 'does', 'a', 'an', 'to', 'and', 'or', 'some']);
  const cleanTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t));

  // Exact phrase match in title
  const cleanRawQ = q.replace(/^(what is|tell me about|info on|brief for|rules for|requirements for|docs for|drive for|link for|cpm for|budget for|show me|find me)\s+/i, '').trim();
  if (cleanRawQ.length > 2 && title.includes(cleanRawQ)) {
    score += 200;
  }

  for (const tok of cleanTokens) {
    if (title.includes(tok)) score += 60;
    else if (agency.includes(tok)) score += 40;
    else if (cat.includes(tok) || type.includes(tok)) score += 30;
    else if (desc.includes(tok) || reqs.includes(tok)) score += 20;
    else if (fullText.includes(tok)) score += 10;
  }

  // Intent boosts
  if ((q.includes('0 sub') || q.includes('zero sub') || q.includes('0 spent')) && (parseFloat(c.spent) || 0) === 0) score += 50;
  if ((q.includes('high cpm') || q.includes('cpm')) && (parseFloat(c.cpm) || 0) >= 2.0) score += 30;
  if (q.includes('music') && (cat.includes('music') || title.includes('song') || desc.includes('music'))) score += 40;
  if ((q.includes('podcast') || q.includes('stream')) && (cat.includes('personal') || desc.includes('podcast') || desc.includes('stream'))) score += 40;
  if ((q.includes('ai') || q.includes('tech')) && (cat.includes('tech') || desc.includes('ai') || title.includes('ai'))) score += 40;
  if (q.includes('ugc') && (type.includes('ugc') || desc.includes('ugc'))) score += 40;
  if (q.includes('clip') && (type.includes('clipping') || desc.includes('clip'))) score += 40;

  return score;
}

function buildContextSummary(campaigns, userQuery) {
  let list = Array.isArray(campaigns) ? campaigns.filter(c => {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    return total === 0 || (total - spent) > 0;
  }) : [];

  if (userQuery && userQuery.trim().length > 0) {
    list.sort((a, b) => {
      const scoreA = scoreCampaignForQuery(a, userQuery);
      const scoreB = scoreCampaignForQuery(b, userQuery);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (b.sortTimestamp || 0) - (a.sortTimestamp || 0);
    });
  }

  return list.slice(0, 50).map(c => {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    return {
      title: c.title || 'Untitled',
      agency: c.agency || 'Independent',
      cpm: c.cpm ? `$${c.cpm}` : '$1.00',
      remainingBudget: `$${Math.max(0, total - spent).toLocaleString()}`,
      spent: `$${spent.toLocaleString()}`,
      total: `$${total.toLocaleString()}`,
      submissions: c.creators || c.count || 0,
      category: c.category || 'General',
      contentType: c.contentType || 'Clipping',
      platforms: (c.platforms || []).join(', '),
      description: (c.description || '').slice(0, 300),
      requirements: (c.requirements || []).slice(0, 3)
    };
  });
}

// --- Provider 1: Google Gemini (Multi-Model Cascade) ---
const GEMINI_MODELS = [
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash'
];

function callGeminiModel(model, apiKey, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const parsedUrl = new URL(url);

    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 3500 }
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
            resolve({ reply: data.candidates[0].content.parts[0].text, provider: `Gemini (${model})` });
          } else {
            reject(new Error(data.error ? data.error.message : `HTTP ${res.statusCode}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error(`Timeout on ${model}`)); });
    req.write(payload);
    req.end();
  });
}

// --- Provider 2: Groq Cloud (Free Tier - Llama 3.3 70B & Mixtral) ---
function callGroqApi(apiKey, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 3000
    });

    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode === 200 && data.choices && data.choices[0] && data.choices[0].message) {
            resolve({ reply: data.choices[0].message.content, provider: 'Groq (Llama 3.3 70B)' });
          } else {
            reject(new Error(data.error ? data.error.message : `Groq HTTP ${res.statusCode}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(payload);
    req.end();
  });
}

// --- Provider 3: OpenRouter (Free Tier Models) ---
const OPENROUTER_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'liquid/lfm-2.5-2.6b:free',
  'z-ai/glm-5.2:free'
];

async function callOpenRouterApi(apiKey, systemPrompt, userMessage) {
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 3000
        });

        const req = https.request({
          hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://trackerwhop.vercel.app',
            'X-Title': 'Content Rewards Copilot',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (res.statusCode === 200 && data.choices && data.choices[0] && data.choices[0].message) {
                resolve({ reply: data.choices[0].message.content, provider: `OpenRouter (${model})` });
              } else {
                reject(new Error(data.error ? data.error.message : `OpenRouter HTTP ${res.statusCode}`));
              }
            } catch (err) {
              reject(err);
            }
          });
        });

        req.on('error', reject);
        req.setTimeout(25000, () => { req.destroy(); reject(new Error('OpenRouter timeout')); });
        req.write(payload);
        req.end();
      });
      if (res && res.reply) return res;
    } catch (e) {
      console.warn(`OpenRouter model ${model} failed:`, e.message);
    }
  }
  throw new Error('All OpenRouter models failed');
}

// --- Provider 4: OpenAI (GPT-4o Mini) ---
function callOpenAIApi(apiKey, systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.7,
      max_tokens: 3000
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode === 200 && data.choices && data.choices[0] && data.choices[0].message) {
            resolve({ reply: data.choices[0].message.content, provider: 'OpenAI (GPT-4o mini)' });
          } else {
            reject(new Error(data.error ? data.error.message : `OpenAI HTTP ${res.statusCode}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('OpenAI timeout')); });
    req.write(payload);
    req.end();
  });
}

// --- Provider 5: Bulletproof Algorithmic Intelligence Engine (Zero-Fail Guarantee) ---
function generateLocalAlgorithmicReply(userQuery, campaigns) {
  const q = (userQuery || '').toLowerCase();
  const active = campaigns.filter(c => {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    return total === 0 || (total - spent) > 0;
  });

  const wantsHighestCpm = q.includes('highest cpm') || q.includes('top cpm') || q.includes('best pay') || q.includes('cpm');
  const wantsZeroSpent = q.includes('0 sub') || q.includes('zero sub') || q.includes('0 spent') || q.includes('unclaimed');
  const wantsBudget = q.includes('budget') || q.includes('largest pool') || q.includes('most money');

  if (wantsHighestCpm) {
    const sorted = [...active].sort((a, b) => (parseFloat(b.cpm) || 0) - (parseFloat(a.cpm) || 0)).slice(0, 5);
    let listMd = sorted.map((c, i) => {
      const rem = Math.max(0, (parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0));
      return `### ${i + 1}. **${c.title}**\n* **Payout Rate:** **$${parseFloat(c.cpm || 1).toFixed(2)} CPM**\n* **Remaining Budget:** **$${rem.toLocaleString()}** (Total: $${parseFloat(c.total || 0).toLocaleString()})\n* **Agency:** ${c.agency || 'Independent'} | **Platforms:** ${(c.platforms || []).join(', ').toUpperCase()}\n* **Brief:** ${(c.description || 'No description').slice(0, 150)}...`;
    }).join('\n\n---\n\n');

    return `Here are the **top highest-paying CPM campaigns** currently live across Content Rewards:\n\n${listMd}\n\n💡 **Tip:** High CPM campaigns yield more revenue per 1,000 views. Ensure you check the guidelines before posting!`;
  }

  if (wantsZeroSpent) {
    const fresh = active.filter(c => (parseFloat(c.spent) || 0) === 0).slice(0, 5);
    let listMd = fresh.map((c, i) => {
      const rem = Math.max(0, (parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0));
      return `### ${i + 1}. **${c.title}**\n* **Status:** ⚡ **100% Unclaimed ($0 Spent)**\n* **Payout Rate:** **$${parseFloat(c.cpm || 1).toFixed(2)} CPM** | **Pool:** **$${rem.toLocaleString()}**\n* **Category:** ${c.category || 'General'} | **Platforms:** ${(c.platforms || []).join(', ').toUpperCase()}`;
    }).join('\n\n---\n\n');

    return `Found **${fresh.length} fresh campaign drops with $0 spent** (maximum runway available):\n\n${listMd}`;
  }

  if (wantsBudget) {
    const largest = [...active].sort((a, b) => {
      const remA = Math.max(0, (parseFloat(a.total) || 0) - (parseFloat(a.spent) || 0));
      const remB = Math.max(0, (parseFloat(b.total) || 0) - (parseFloat(b.spent) || 0));
      return remB - remA;
    }).slice(0, 5);

    let listMd = largest.map((c, i) => {
      const rem = Math.max(0, (parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0));
      return `### ${i + 1}. **${c.title}**\n* **Remaining Fund:** **$${rem.toLocaleString()}**\n* **Payout Rate:** **$${parseFloat(c.cpm || 1).toFixed(2)} CPM** | **Submissions:** ${c.creators || c.count || 0}\n* **Agency:** ${c.agency || 'Independent'}`;
    }).join('\n\n---\n\n');

    return `Here are the active campaigns with the **largest remaining reward pools**:\n\n${listMd}`;
  }

  // General Search
  const queryTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  const matched = active.filter(c => {
    const text = `${c.title} ${c.description} ${c.agency} ${c.category}`.toLowerCase();
    return queryTokens.some(t => text.includes(t));
  }).slice(0, 4);

  if (matched.length > 0) {
    let listMd = matched.map((c, i) => {
      const rem = Math.max(0, (parseFloat(c.total) || 0) - (parseFloat(c.spent) || 0));
      return `### ${i + 1}. **${c.title}**\n* **CPM Rate:** **$${parseFloat(c.cpm || 1).toFixed(2)}/1K views**\n* **Remaining Budget:** **$${rem.toLocaleString()}** left\n* **Allowed Platforms:** ${(c.platforms || []).join(', ').toUpperCase()}\n* **Brief Summary:** ${(c.description || 'No guidelines provided.').slice(0, 200)}...`;
    }).join('\n\n---\n\n');

    return `Here is what I found regarding **"${userQuery}"**:\n\n${listMd}`;
  }

  return `I analyzed all **${active.length} active campaigns** in the database. You can ask me about specific campaigns, highest CPM payouts, 0-submission drops, or creator rules!`;
}

function extractMatchedCampaigns(userQuery, replyText, campaigns) {
  if (!Array.isArray(campaigns) || campaigns.length === 0) {
    return { campaigns: [], totalMatchesCount: 0, filterOptions: { preset: 'all' } };
  }
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

  const active = campaigns.filter(c => {
    const total = parseFloat(c.total) || 0;
    const spent = parseFloat(c.spent) || 0;
    return total === 0 || (total - spent) > 0;
  });

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

  // 3. Query Intent & Filter Options detection
  let filterOptions = { preset: 'all' };
  let allMatchingActive = [];

  const is0Sub = q.includes('0 sub') || q.includes('zero sub') || q.includes('0 spent') || q.includes('unclaimed');
  const isHighCpm = q.includes('highest cpm') || q.includes('top cpm') || q.includes('high cpm') || q.includes('cpm') || q.includes('highest pay');
  const isBudget = q.includes('budget') || q.includes('largest pool') || q.includes('biggest pool') || q.includes('most money');
  const isMusic = q.includes('music') || q.includes('lyric') || q.includes('song');
  const isPodcast = q.includes('podcast') || q.includes('stream') || q.includes('streamer');
  const isAi = q.includes('ai') || q.includes('tech') || q.includes('software') || q.includes('saas') || q.includes('app');
  const isUgc = q.includes('ugc');
  const isClipping = q.includes('clipping') || q.includes('clip ');

  const stopWords = new Set(['what', 'is', 'the', 'of', 'for', 'in', 'on', 'about', 'tell', 'me', 'how', 'much', 'are', 'there', 'any', 'can', 'i', 'get', 'give', 'show', 'find', 'best', 'good', 'camps', 'camp', 'campaign', 'campaigns', 'active', 'all', 'please', 'with', 'from', 'does', 'a', 'an', 'to', 'and', 'or', 'some']);
  const cleanTokens = q.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !stopWords.has(t));

  if (is0Sub) {
    filterOptions = { preset: '0sub' };
    allMatchingActive = active.filter(c => (parseFloat(c.spent) || 0) === 0);
  } else if (isMusic) {
    filterOptions = { category: 'Music' };
    allMatchingActive = active.filter(c => (c.category || '').toLowerCase().includes('music') || (c.title || '').toLowerCase().includes('song') || (c.description || '').toLowerCase().includes('music'));
  } else if (isPodcast) {
    filterOptions = { search: 'podcast', preset: 'personal' };
    allMatchingActive = active.filter(c => (c.category || '').toLowerCase().includes('personal') || (c.description || '').toLowerCase().includes('podcast') || (c.title || '').toLowerCase().includes('podcast') || (c.description || '').toLowerCase().includes('stream'));
  } else if (isAi) {
    filterOptions = { search: 'ai' };
    allMatchingActive = active.filter(c => (c.category || '').toLowerCase().includes('tech') || (c.description || '').toLowerCase().includes('ai') || (c.title || '').toLowerCase().includes('ai'));
  } else if (isUgc) {
    filterOptions = { contentType: 'UGC' };
    allMatchingActive = active.filter(c => (c.contentType || '').toLowerCase().includes('ugc') || (c.description || '').toLowerCase().includes('ugc'));
  } else if (isClipping) {
    filterOptions = { contentType: 'Clipping' };
    allMatchingActive = active.filter(c => (c.contentType || '').toLowerCase().includes('clipping') || (c.description || '').toLowerCase().includes('clip') || (c.title || '').toLowerCase().includes('clip'));
  } else if (isHighCpm) {
    filterOptions = { preset: 'highcpm' };
    allMatchingActive = [...active].sort((a, b) => (parseFloat(b.cpm) || 0) - (parseFloat(a.cpm) || 0));
  } else if (isBudget) {
    filterOptions = { preset: 'highbudget' };
    allMatchingActive = [...active].sort((a, b) => ((parseFloat(b.total) || 0) - (parseFloat(b.spent) || 0)) - ((parseFloat(a.total) || 0) - (parseFloat(a.spent) || 0)));
  } else if (cleanTokens.length > 0) {
    const searchTerm = cleanTokens.join(' ');
    filterOptions = { search: searchTerm };
    allMatchingActive = active.filter(c => {
      const full = `${c.title} ${c.description} ${c.agency} ${c.category} ${(c.platforms || []).join(' ')}`.toLowerCase();
      return cleanTokens.some(t => full.includes(t));
    });
    allMatchingActive.sort((a, b) => scoreCampaignForQuery(b, userQuery) - scoreCampaignForQuery(a, userQuery));
  } else {
    allMatchingActive = active;
  }

  // If matched had specific mentions, add them first, then fill from allMatchingActive
  allMatchingActive.forEach(c => add(c));

  const totalMatchesCount = allMatchingActive.length > 0 ? allMatchingActive.length : matched.length;

  return {
    campaigns: matched.slice(0, 5),
    totalMatchesCount,
    filterOptions
  };
}

// --- Main Serverless Handler ---
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) {}
    }
    const userQuery = (body && body.query) || req.query.q || '';

    if (!userQuery) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const campaigns = getCampaignsData();
    const context = buildContextSummary(campaigns, userQuery);

    const systemPrompt = "You are the Content Rewards AI Copilot — an expert analyst and strategic creator advisor for short-form video bounties on Content Rewards and Whop (TikTok, Instagram Reels, YouTube Shorts, X).\n\nKey Response Rules:\n1. Always provide a complete, well-formed response and finish every sentence and thought cleanly. Never cut off mid-thought.\n2. When recommending or discussing campaigns, highlight top opportunities by name (e.g. **Olympus - UGC Campaign**, **Jay Dyer Clips**) with sharp, punchy creator insights (CPM rates, remaining runway, viral angles, key requirements).\n3. Keep your written overview focused (2-4 concise paragraphs) since interactive visual campaign cards with live burn meters, direct join buttons, and Drive documents are automatically rendered directly below your answer.";
    const userMessage = `Current Live Content Rewards Campaigns Database (${context.length} active pools):\n${JSON.stringify(context, null, 2)}\n\nCreator Question:\n"${userQuery}"\n\nPlease answer the user thoroughly based on the live campaign dataset.`;

    // 1. Try Google Gemini with model cascade
    const geminiKey = getEnvKey('GEMINI_API_KEY') || getEnvKey('AI_API_KEY');
    if (geminiKey) {
      for (const model of GEMINI_MODELS) {
        try {
          const resObj = await callGeminiModel(model, geminiKey, systemPrompt, userMessage);
          if (resObj && resObj.reply) {
            const matchResult = extractMatchedCampaigns(userQuery, resObj.reply, campaigns);
            return res.status(200).json({ reply: resObj.reply, provider: resObj.provider, campaigns: matchResult.campaigns, totalMatchesCount: matchResult.totalMatchesCount, filterOptions: matchResult.filterOptions });
          }
        } catch (err) {
          console.warn(`Gemini (${model}) failed:`, err.message);
        }
      }
    }

    // 2. Backup: Groq Cloud (Free Llama 3.3 70B)
    const groqKey = getEnvKey('GROQ_API_KEY');
    if (groqKey) {
      try {
        const resObj = await callGroqApi(groqKey, systemPrompt, userMessage);
        if (resObj && resObj.reply) {
          const matchResult = extractMatchedCampaigns(userQuery, resObj.reply, campaigns);
          return res.status(200).json({ reply: resObj.reply, provider: resObj.provider, campaigns: matchResult.campaigns, totalMatchesCount: matchResult.totalMatchesCount, filterOptions: matchResult.filterOptions });
        }
      } catch (err) {
        console.warn('Groq backup failed:', err.message);
      }
    }

    // 3. Backup: OpenRouter (Free Models)
    const openRouterKey = getEnvKey('OPENROUTER_API_KEY');
    if (openRouterKey) {
      try {
        const resObj = await callOpenRouterApi(openRouterKey, systemPrompt, userMessage);
        if (resObj && resObj.reply) {
          const matchResult = extractMatchedCampaigns(userQuery, resObj.reply, campaigns);
          return res.status(200).json({ reply: resObj.reply, provider: resObj.provider, campaigns: matchResult.campaigns, totalMatchesCount: matchResult.totalMatchesCount, filterOptions: matchResult.filterOptions });
        }
      } catch (err) {
        console.warn('OpenRouter backup failed:', err.message);
      }
    }

    // 4. Backup: OpenAI (GPT-4o Mini)
    const openAIKey = getEnvKey('OPENAI_API_KEY');
    if (openAIKey) {
      try {
        const resObj = await callOpenAIApi(openAIKey, systemPrompt, userMessage);
        if (resObj && resObj.reply) {
          const matchResult = extractMatchedCampaigns(userQuery, resObj.reply, campaigns);
          return res.status(200).json({ reply: resObj.reply, provider: resObj.provider, campaigns: matchResult.campaigns, totalMatchesCount: matchResult.totalMatchesCount, filterOptions: matchResult.filterOptions });
        }
      } catch (err) {
        console.warn('OpenAI backup failed:', err.message);
      }
    }

    // 5. Ultimate Zero-Fail Fallback (Rich algorithmic response from live dataset)
    const fallbackReply = generateLocalAlgorithmicReply(userQuery, campaigns);
    const matchResult = extractMatchedCampaigns(userQuery, fallbackReply, campaigns);
    return res.status(200).json({ reply: fallbackReply, provider: 'Local Intelligence Engine', campaigns: matchResult.campaigns, totalMatchesCount: matchResult.totalMatchesCount, filterOptions: matchResult.filterOptions });

  } catch (err) {
    console.error('AI chat fatal error:', err.message);
    const campaigns = getCampaignsData();
    const fallbackReply = generateLocalAlgorithmicReply(req.query.q || 'help', campaigns);
    const matchResult = extractMatchedCampaigns(req.query.q || 'help', fallbackReply, campaigns);
    return res.status(200).json({ reply: fallbackReply, provider: 'Local Intelligence Engine (Emergency)', campaigns: matchResult.campaigns, totalMatchesCount: matchResult.totalMatchesCount, filterOptions: matchResult.filterOptions });
  }
};
