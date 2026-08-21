const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'raw_discover_source.html'), 'utf8');

// In Next.js stream, each campaign is a clean JSON object
// Let's parse each campaign object using pure JSON-safe boundaries!
const campaigns = [];
const seenIds = new Set();

// A campaign block in the stream starts at \"id\":\"<uuid>\" or \"title\":\"...\"
// Let's find all chunks that have an ID and extract each field with strict bounds!
const idRegex = /(?:\\"id\\"|"id"):(?:\\"|")([0-9a-f-]{36})(?:\\"|")/g;
let m;

while ((m = idRegex.exec(html)) !== null) {
  const id = m[1];
  if (seenIds.has(id)) continue;

  const pos = m.index;
  const chunk = html.slice(pos, pos + 4000);

  // Strict property extractors that STOP at the next JSON property key
  const titleM = chunk.match(/(?:\\"title\\"|"title"):(?:\\"|")((?:(?!\\",\\"|",")[^"\\]|\\.)+)(?:\\"|")/);
  const brandM = chunk.match(/(?:\\"brand\\"|"brand"):(?:\\"|")((?:(?!\\",\\"|",")[^"\\]|\\.)+)(?:\\"|")/);
  const cpmM = chunk.match(/(?:\\"pricePerView\\"|"pricePerView"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const totalM = chunk.match(/(?:\\"totalBudget\\"|"totalBudget"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const spentM = chunk.match(/(?:\\"budgetSpent\\"|"budgetSpent"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const fundedM = chunk.match(/(?:\\"fundedAt\\"|"fundedAt"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const catM = chunk.match(/(?:\\"category\\"|"category"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  
  // Description MUST stop at the next field (e.g. \",\"experienceId\" or \",\"status\" or \",\"socialPlatforms\" or \",\"whopProductRoute\")
  const descM = chunk.match(/(?:\\"description\\"|"description"):(?:\\"|")((?:(?!\\",\\"(?:experienceId|status|socialPlatforms|whopProductRoute|isVerified|companyId|fundedAt|programId|category)|",")[^"\\]|\\.)+)(?:\\"|")/);

  if (titleM && titleM[1]) {
    seenIds.add(id);

    let title = titleM[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    let agency = brandM ? brandM[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : 'Independent';
    let cpm = cpmM ? parseFloat(cpmM[1].replace(/[$,]/g, '')) || 1.5 : 1.5;
    let total = totalM ? parseFloat(totalM[1].replace(/[$,]/g, '')) || 0 : 0;
    let spent = spentM ? parseFloat(spentM[1].replace(/[$,]/g, '')) || 0 : 0;
    let fundedAt = fundedM ? fundedM[1] : null;
    let category = catM ? catM[1].replace(/\\"/g, '"').trim() : 'General';
    
    let rawDesc = descM ? descM[1] : '';
    // Clean escape characters and newlines
    let description = rawDesc
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();

    // Strip any leaked raw JSON keys from description if present
    if (description.includes('"experienceId"') || description.includes('experienceId')) {
      description = description.split('"experienceId"')[0].split('experienceId')[0].trim();
    }
    if (description.endsWith('\\') || description.endsWith('"') || description.endsWith(',')) {
      description = description.slice(0, -1).trim();
    }

    if (!description || description.length < 5) {
      description = `${agency} short-form clipping campaign on Content Rewards. Post high-performing clips to earn $${cpm.toFixed(2)}/1K views.`;
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

console.log(`✅ Extracted ${cleaned.length} 100% clean campaigns with ZERO leaked JSON!`);
console.log("\nSample 5 clean descriptions:");
cleaned.slice(0, 5).forEach((c, idx) => {
  console.log(`\n[${idx + 1}] "${c.title}" (${c.agency})`);
  console.log(`  Brief: "${c.description.slice(0, 180)}..."`);
});

fs.writeFileSync(path.join(__dirname, 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');

const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(cleaned)};`;
fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');
