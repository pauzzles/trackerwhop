const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  console.log("Launching headless browser to inspect contentrewards.com/discover...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://contentrewards.com/discover', { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);
  const text = await page.innerText('body');
  const clean = text.replace(/\r\n/g, '\n');
  const parts = clean.split('Join Campaign');
  console.log('Detected raw Join Campaign sections:', parts.length);

  const campaigns = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const before = parts[i];
    const after = parts[i + 1];

    const afterMatch = after.match(/^\s*\$([\d,]+)\/\$([\d,]+)\s*([\dKk.]*)\s*\$([\d.]+)\/1K/);
    const beforeLines = before.trim().split('\n').map(l => l.trim()).filter(Boolean);

    if (afterMatch && beforeLines.length >= 4) {
      const spent = parseInt(afterMatch[1].replace(/,/g, ''), 10);
      const total = parseInt(afterMatch[2].replace(/,/g, ''), 10);
      const count = afterMatch[3] || '0';
      const cpm = parseFloat(afterMatch[4]);

      const dotIndex = beforeLines.findIndex(l => l === '·' || l === '•');
      if (dotIndex >= 1 && dotIndex + 2 < beforeLines.length) {
        const agency = beforeLines.slice(Math.max(0, dotIndex - 2), dotIndex).join(' ');
        const age = beforeLines[dotIndex + 1];
        const category = beforeLines[dotIndex + 2];
        const titleDesc = beforeLines.slice(dotIndex + 3);
        const title = titleDesc[0] || 'Campaign';
        const description = titleDesc.slice(1).join(' ');

        campaigns.push({
          agency,
          age,
          category,
          title,
          description,
          spent,
          total,
          count,
          cpm,
          key: `${agency}::${title}`
        });
      }
    }
  }

  console.log(`Successfully Parsed Live Campaigns: ${campaigns.length}`);
  if (campaigns.length > 0) {
    console.log('Sample parsed campaign:', JSON.stringify(campaigns[0], null, 2));
    fs.writeFileSync('campaigns.json', JSON.stringify(campaigns, null, 2));
    fs.writeFileSync('../campaigns.json', JSON.stringify(campaigns, null, 2));
  }
  await browser.close();
})();
