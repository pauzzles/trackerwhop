const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'raw_discover_source.html'), 'utf8');

// Next.js chunks are in self.__next_f.push([1, "..."])
const campaigns = [];
const seenIds = new Set();

// Let's find all next_f pushes
const pushRegex = /self\.__next_f\.push\(\[\d+,"(.*?)"\]\)/g;
let match;

while ((match = pushRegex.exec(html)) !== null) {
  let rawChunk = match[1];
  // Unescape the string content
  let unescaped = rawChunk
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n');

  // Look for campaign JSON objects inside this unescaped chunk
  // A campaign object has "id":"<uuid>" and "title":"..." and "brand":"..."
  const objRegex = /\{"id":"([0-9a-f-]{36})","title":"([^"]+)","brand":"([^"]*)","avatar":"[^"]*"(?:,"thumbnail":"[^"]*")?(?:,"bannerImageUrl":[^,]*)?(?:,"bannerPriority":[^,]*)?(?:,"featuredPriority":[^,]*)?,"totalBudget":"([^"]*)","budgetSpent":"([^"]*)","pricePerView":"([^"]*)","fundedAt":"([^"]*)"(?:,"progressPercentage":[^,]*)?(?:,"creators":[^,]*)?(?:,"stats":\{[^}]*\})?(?:,"socialPlatforms":\[[^\]]*\])?(?:,"campaignType":"[^"]*")?(?:,"category":"([^"]*)")?[^}]*?"description":"((?:(?!","experienceId|","status|","programId|","whopExperienceId)[^"\\]|\\.)*)"/g;

  let om;
  while ((om = objRegex.exec(unescaped)) !== null) {
    const id = om[1];
    const title = om[2].trim();
    const brand = om[3].trim() || 'Independent';
    const total = parseFloat(om[4].replace(/[$,]/g, '')) || 0;
    const spent = parseFloat(om[5].replace(/[$,]/g, '')) || 0;
    const cpm = parseFloat(om[6].replace(/[$,]/g, '')) || 1.5;
    const fundedAt = om[7];
    const category = om[8] || 'General';
    let description = om[9].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();

    if (!seenIds.has(id) && title) {
      seenIds.add(id);
      campaigns.push({
        id,
        title,
        agency: brand,
        category,
        cpm,
        total,
        spent,
        fundedAt,
        description: description || `${brand} clipping campaign on Content Rewards.`
      });
    }
  }
}

// Fallback: Also check if there are standalone JSON blocks
const directRegex = /\{"avatar":"[^"]*","bannerImageUrl":[^,]*,"bannerPriority":[^,]*,"brand":"([^"]*)","budgetSpent":"([^"]*)","campaignType":"[^"]*","category":"([^"]*)","companyId":"[^"]*","creators":[^,]*,"description":"((?:(?!","experienceId|","status|","programId)[^"\\]|\\.)*)","experienceId":"[^"]*","fundedAt":"([^"]*)","id":"([0-9a-f-]{36})","isVerified":[^,]*,"pricePerView":"([^"]*)","progressPercentage":[^,]*,"socialPlatforms":\[[^\]]*\],"stats":\{[^}]*\},"status":"active","thumbnail":"[^"]*","title":"([^"]+)","totalBudget":"([^"]*)"/g;

while ((om = directRegex.exec(html)) !== null) {
  const id = om[7];
  const brand = om[1].trim();
  const spent = parseFloat(om[2].replace(/[$,]/g, '')) || 0;
  const category = om[3].trim();
  let description = om[4].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
  const fundedAt = om[5];
  const cpm = parseFloat(om[8].replace(/[$,]/g, '')) || 1.5;
  const title = om[9].trim();
  const total = parseFloat(om[10].replace(/[$,]/g, '')) || 0;

  if (!seenIds.has(id) && title) {
    seenIds.add(id);
    campaigns.push({
      id,
      title,
      agency: brand,
      category,
      cpm,
      total,
      spent,
      fundedAt,
      description: description || `${brand} clipping campaign on Content Rewards.`
    });
  }
}

function formatRelativeAge(isoStr) {
  if (!isoStr) return 'Active';
  try {
    const diffMs = Date.now() - new Date(isoStr).getTime();
    if (isNaN(diffMs)) return 'Active';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'Just now (< 1h ago)';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch (e) {
    return 'Active';
  }
}

const cleaned = campaigns.map(c => {
  const age = formatRelativeAge(c.fundedAt);
  const sortTimestamp = (c.fundedAt && !isNaN(new Date(c.fundedAt).getTime())) ? new Date(c.fundedAt).getTime() : 0;
  return {
    ...c,
    formattedAge: age,
    age: age,
    sortTimestamp: sortTimestamp
  };
});

cleaned.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0));

console.log(`✅ Extracted ${cleaned.length} 100% spotless campaigns!`);
console.log("\nSample 5 clean briefs:");
cleaned.slice(0, 5).forEach((c, idx) => {
  console.log(`\n[${idx + 1}] "${c.title}" (${c.agency})`);
  console.log(`  Description: "${c.description}"`);
});

fs.writeFileSync(path.join(__dirname, 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');

const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(cleaned)};`;
fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');
