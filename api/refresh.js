const https = require('https');

const DISCOVER_URL = "https://contentrewards.com/discover";

function fetchDiscoverHtml() {
  return new Promise((resolve, reject) => {
    const req = https.get(DISCOVER_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('ContentRewards timeout')); });
  });
}

function formatRelativeAge(isoStr) {
  if (!isoStr) return 'Active';
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime();
    if (isNaN(diffMs)) return 'Active';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'Just now (< 1h ago)';
    if (diffHours < 24) return `${diffHours}h ago (Today)`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return '1d ago (Yesterday)';
    return `${diffDays}d ago`;
  } catch (e) {
    return 'Active';
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const html = await fetchDiscoverHtml();
    const campaigns = [];
    const seenIds = new Set();
    const idRegex = /(?:\\"id\\"|"id"):(?:\\"|")([0-9a-f-]{36})(?:\\"|")/g;
    let m;

    while ((m = idRegex.exec(html)) !== null) {
      const id = m[1];
      if (seenIds.has(id)) continue;
      const pos = m.index;
      const chunk = html.slice(pos, pos + 3000);

      const titleMatch = chunk.match(/(?:\\"title\\"|"title"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const brandMatch = chunk.match(/(?:\\"brand\\"|"brand"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const cpmMatch = chunk.match(/(?:\\"pricePerView\\"|"pricePerView"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const totalMatch = chunk.match(/(?:\\"totalBudget\\"|"totalBudget"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const spentMatch = chunk.match(/(?:\\"budgetSpent\\"|"budgetSpent"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const fundedMatch = chunk.match(/(?:\\"fundedAt\\"|"fundedAt"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const catMatch = chunk.match(/(?:\\"category\\"|"category"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const descMatch = chunk.match(/(?:\\"description\\"|"description"):(?:\\"|")([^"\\]*(?:\\.[^"\\]*)*)(?:\\"|")/);
      const thumbMatch = chunk.match(/(?:\\"thumbnail\\"|"thumbnail"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const avatarMatch = chunk.match(/(?:\\"avatar\\"|"avatar"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const bannerMatch = chunk.match(/(?:\\"bannerImageUrl\\"|"bannerImageUrl"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const creatorsMatch = chunk.match(/(?:\\"creators\\"|"creators"):(\d+)/);
      const verifiedMatch = chunk.match(/(?:\\"isVerified\\"|"isVerified"):(true|false)/);
      const platformsMatch = chunk.match(/(?:\\"socialPlatforms\\"|"socialPlatforms"):\[([^\]]*)\]/);
      const routeMatch = chunk.match(/(?:\\"whopProductRoute\\"|"whopProductRoute"|\\"whop_route\\"|"whop_route"|\\"route\\"|"route"):(?:\\"|")([^"\\]+)(?:\\"|")/);
      const statsMatch = chunk.match(/(?:\\"stats\\"|"stats"):\{([^}]+)\}/);

      if (titleMatch && titleMatch[1]) {
        seenIds.add(id);
        let title = titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
        let agency = brandMatch ? brandMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : 'Independent Agency';
        let cpm = cpmMatch ? parseFloat(cpmMatch[1].replace(/[$,]/g, '')) || 1.0 : 1.0;
        let total = totalMatch ? parseFloat(totalMatch[1].replace(/[$,]/g, '')) || 0 : 0;
        let spent = spentMatch ? parseFloat(spentMatch[1].replace(/[$,]/g, '')) || 0 : 0;
        let fundedAt = fundedMatch ? fundedMatch[1] : null;
        let category = catMatch ? catMatch[1].replace(/\\"/g, '"').trim() : 'General';
        let description = descMatch ? descMatch[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim() : `${agency} clipping pool.`;
        let whopProductRoute = routeMatch ? routeMatch[1].replace(/\\"/g, '').trim() : '';
        let thumbnail = thumbMatch ? thumbMatch[1].replace(/\\"/g, '').trim() : '';
        let avatar = avatarMatch ? avatarMatch[1].replace(/\\"/g, '').trim() : '';
        let bannerImageUrl = bannerMatch ? bannerMatch[1].replace(/\\"/g, '').trim() : '';
        let creators = creatorsMatch ? parseInt(creatorsMatch[1], 10) : 0;
        let isVerified = verifiedMatch ? verifiedMatch[1] === 'true' : false;

        let platforms = [];
        if (platformsMatch && platformsMatch[1]) {
          platforms = platformsMatch[1].replace(/\\"/g, '').replace(/"/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        }

        let stats = { successRate: 90, viewCount: '0' };
        if (statsMatch && statsMatch[1]) {
          const rateM = statsMatch[1].match(/(?:\\"successRate\\"|"successRate"):(\d+)/);
          const viewsM = statsMatch[1].match(/(?:\\"viewCount\\"|"viewCount"):(?:\\"|")([^"\\]+)(?:\\"|")/);
          if (rateM) stats.successRate = parseInt(rateM[1], 10);
          if (viewsM) stats.viewCount = viewsM[1];
        }

        const age = formatRelativeAge(fundedAt);
        const sortTimestamp = fundedAt && !isNaN(new Date(fundedAt).getTime()) ? new Date(fundedAt).getTime() : (Date.now() - 86400000);

        campaigns.push({
          id,
          url: DISCOVER_URL,
          title,
          agency,
          category,
          cpm,
          total,
          spent,
          fundedAt,
          formattedAge: age,
          age: age,
          sortTimestamp: sortTimestamp,
          description,
          thumbnail,
          avatar,
          bannerImageUrl,
          creators,
          count: creators > 0 ? String(creators) : '0',
          isVerified,
          platforms,
          stats,
          whopProductRoute,
          whop_route: whopProductRoute,
          whopUrl: whopProductRoute ? `https://whop.com/${whopProductRoute}` : ''
        });
      }
    }

    campaigns.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0));

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({
      ok: true,
      count: campaigns.length,
      fetchedAt: new Date().toISOString(),
      source: 'contentrewards.com/discover (live serverless stream)',
      campaigns
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
