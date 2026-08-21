const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  console.log("Fetching live page with Playwright to extract pure client-side Next.js campaign objects...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Directly evaluate inside the browser window where Next.js has parsed all campaign objects!
  const campaigns = await page.evaluate(() => {
    // Next.js stores page data in props / RSC chunks or we can extract the exact cards and text!
    const results = [];
    const seen = new Set();

    // 1. Check if there are Next.js data objects in scripts
    const scripts = Array.from(document.querySelectorAll('script'));
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (txt.includes('totalBudget') && txt.includes('pricePerView')) {
        // Find JSON chunks
        const matches = txt.match(/\{"id":"[0-9a-f-]+","title":".*?"fundedAt":".*?"\}/g);
        if (matches) {
          for (const m of matches) {
            try {
              const obj = JSON.parse(m);
              if (obj.title && obj.brand && !seen.has(obj.id)) {
                seen.add(obj.id);
                results.push({
                  id: obj.id,
                  title: obj.title,
                  agency: obj.brand,
                  category: obj.category || 'General',
                  cpm: parseFloat((obj.pricePerView || '1.5').replace(/[$,]/g, '')) || 1.5,
                  total: parseFloat((obj.totalBudget || '0').replace(/[$,]/g, '')) || 0,
                  spent: parseFloat((obj.budgetSpent || '0').replace(/[$,]/g, '')) || 0,
                  fundedAt: obj.fundedAt || null,
                  description: obj.description || `${obj.brand} short-form clipping campaign.`,
                  whopProductRoute: obj.whopProductRoute || null
                });
              }
            } catch (e) {}
          }
        }
      }
    }

    return results;
  });

  await browser.close();

  console.log(`Successfully extracted ${campaigns.length} pure campaign objects directly from Next.js!`);
  
  function formatAge(isoStr) {
    if (!isoStr) return 'Active';
    try {
      const diffMs = Date.now() - new Date(isoStr).getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours < 1) return 'Just now (< 1h ago)';
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch (e) {
      return 'Active';
    }
  }

  const finalized = campaigns.map(c => ({
    ...c,
    formattedAge: formatAge(c.fundedAt),
    age: formatAge(c.fundedAt),
    sortTimestamp: c.fundedAt ? new Date(c.fundedAt).getTime() : 0
  }));

  finalized.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0));

  console.log("Top 5 extracted verified campaigns:", finalized.slice(0, 5).map(c => ({
    title: c.title,
    agency: c.agency,
    cpm: c.cpm,
    total: c.total,
    age: c.formattedAge
  })));

  fs.writeFileSync(path.join(__dirname, 'campaigns.json'), JSON.stringify(finalized, null, 2), 'utf8');
  fs.writeFileSync(path.join(__dirname, '..', 'campaigns.json'), JSON.stringify(finalized, null, 2), 'utf8');

  const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(finalized)};`;
  fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
  fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');
})();
