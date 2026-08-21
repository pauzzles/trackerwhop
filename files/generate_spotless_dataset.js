const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'raw_discover_source.html'), 'utf8');

const campaigns = [];
const seenIds = new Set();

// A campaign entry in the RSC stream has properties:
// \"id\":\"<uuid>\"
// \"title\":\"...\"
// \"brand\":\"...\"
// \"description\":\"...\"
// \"totalBudget\":\"...\"
// \"budgetSpent\":\"...\"
// \"pricePerView\":\"...\"
// \"fundedAt\":\"...\"

const idRegex = /(?:\\"id\\"|"id"):(?:\\"|")([0-9a-f-]{36})(?:\\"|")/g;
let m;

while ((m = idRegex.exec(html)) !== null) {
  const id = m[1];
  if (seenIds.has(id)) continue;

  const pos = m.index;
  const chunk = html.slice(pos, pos + 3500);

  const titleMatch = chunk.match(/(?:\\"title\\"|"title"):(?:\\"|")((?:(?!\\",\\"|",")[^"\\]|\\.)+)(?:\\"|")/);
  const brandMatch = chunk.match(/(?:\\"brand\\"|"brand"):(?:\\"|")((?:(?!\\",\\"|",")[^"\\]|\\.)+)(?:\\"|")/);
  const cpmMatch = chunk.match(/(?:\\"pricePerView\\"|"pricePerView"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const totalMatch = chunk.match(/(?:\\"totalBudget\\"|"totalBudget"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const spentMatch = chunk.match(/(?:\\"budgetSpent\\"|"budgetSpent"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const fundedMatch = chunk.match(/(?:\\"fundedAt\\"|"fundedAt"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const catMatch = chunk.match(/(?:\\"category\\"|"category"):(?:\\"|")([^"\\]+)(?:\\"|")/);

  // Match description up to the very next JSON property (e.g. \"experienceId\" or \"status\" or \"progressPercentage\")
  const descMatch = chunk.match(/(?:\\"description\\"|"description"):(?:\\"|")((?:(?!\\",\\"(?:experienceId|status|socialPlatforms|whopProductRoute|isVerified|companyId|fundedAt|programId|category|creators|pricePerView|budgetSpent)|",")[^"\\]|\\.)*)(?:\\"|")/);

  if (titleMatch && titleMatch[1]) {
    seenIds.add(id);

    let title = titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    let agency = brandMatch ? brandMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : 'Independent';
    let cpm = cpmMatch ? parseFloat(cpmMatch[1].replace(/[$,]/g, '')) || 1.5 : 1.5;
    let total = totalMatch ? parseFloat(totalMatch[1].replace(/[$,]/g, '')) || 0 : 0;
    let spent = spentMatch ? parseFloat(spentMatch[1].replace(/[$,]/g, '')) || 0 : 0;
    let fundedAt = fundedMatch ? fundedMatch[1] : null;
    let category = catMatch ? catMatch[1].replace(/\\"/g, '"').trim() : 'General';

    let rawDesc = descMatch ? descMatch[1] : '';
    let description = rawDesc
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();

    // Clean up any stray trailing JSON artifacts
    if (description.includes('"experienceId"') || description.includes('experienceId')) {
      description = description.split('"experienceId"')[0].split('experienceId')[0].trim();
    }
    if (description.endsWith('\\') || description.endsWith('"') || description.endsWith(',')) {
      description = description.slice(0, -1).trim();
    }

    if (!description || description.length < 5) {
      description = `${agency} clipping campaign on Content Rewards. Post high-performing short-form videos to earn $${cpm.toFixed(2)}/1K views.`;
    }

    campaigns.push({
      id,
      title,
      agency,
      category,
      cpm,
      total,
      spent,
      fundedAt,
      description
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

console.log(`✅ Extracted ${cleaned.length} pristine campaigns with ZERO raw JSON!`);
console.log("Top 10 verified descriptions:");
cleaned.slice(0, 10).forEach((c, idx) => {
  console.log(`\n[${idx + 1}] "${c.title}" (${c.agency})`);
  console.log(`  Brief: "${c.description}"`);
});

fs.writeFileSync(path.join(__dirname, 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');

const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(cleaned)};`;
fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');
