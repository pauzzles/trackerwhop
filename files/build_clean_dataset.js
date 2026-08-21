const fs = require('fs');
const path = require('path');

const rawCampaigns = JSON.parse(fs.readFileSync(path.join(__dirname, 'exact_verified_campaigns.json'), 'utf8'));

function formatRelativeAge(isoStr) {
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

const cleaned = rawCampaigns.map(c => {
  const total = Number(c.total) || 0;
  const spent = Number(c.spent) || 0;
  const cpm = Number(c.cpm) || 1.5;
  const age = formatRelativeAge(c.fundedAt);
  const sortTimestamp = c.fundedAt ? new Date(c.fundedAt).getTime() : 0;

  return {
    id: c.id,
    title: (c.title || 'Untitled Campaign').trim(),
    agency: (c.agency || 'Independent').trim(),
    category: c.category || 'General',
    cpm: cpm,
    total: total,
    spent: spent,
    fundedAt: c.fundedAt,
    formattedAge: age,
    age: age,
    sortTimestamp: sortTimestamp,
    description: c.description || `${c.agency} short-form clipping campaign on Content Rewards.`,
    whopProductRoute: c.whopProductRoute || null
  };
});

// Sort by newest drops first
cleaned.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0));

console.log(`Cleaned and sorted ${cleaned.length} verified campaigns!`);
console.log("Top 5 newest campaigns:", cleaned.slice(0, 5).map(c => ({ title: c.title, agency: c.agency, age: c.formattedAge, cpm: c.cpm })));

fs.writeFileSync(path.join(__dirname, 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');

const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(cleaned)};`;
fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');
