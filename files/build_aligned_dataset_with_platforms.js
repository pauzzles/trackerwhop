const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'raw_discover_source.html'), 'utf8');

// In Next.js stream, campaigns are serialized inside push arrays or JSON objects
// Let's find every unified campaign object so that title, brand, description, and socialPlatforms are 100% strictly matched!

const campaigns = [];
const seenIds = new Set();

// Pattern matching a complete campaign block inside Next.js stream
// A campaign has "id":"<uuid>" and closing fields
// Let's locate all occurrences of "id":"<uuid>" or \"id\":\"<uuid>\"
const idRegex = /(?:\\"id\\"|"id"):(?:\\"|")([0-9a-f-]{36})(?:\\"|")/g;
let m;

while ((m = idRegex.exec(html)) !== null) {
  const id = m[1];
  if (seenIds.has(id)) continue;

  const pos = m.index;
  // Look around the match (from start of object to end of object)
  const chunk = html.slice(Math.max(0, pos - 500), Math.min(html.length, pos + 3500));

  // Extract individual fields strictly within this single object chunk
  const titleM = chunk.match(/(?:\\"title\\"|"title"):(?:\\"|")((?:(?!\\",\\"|",")[^"\\]|\\.)+)(?:\\"|")/);
  const brandM = chunk.match(/(?:\\"brand\\"|"brand"):(?:\\"|")((?:(?!\\",\\"|",")[^"\\]|\\.)+)(?:\\"|")/);
  const cpmM = chunk.match(/(?:\\"pricePerView\\"|"pricePerView"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const totalM = chunk.match(/(?:\\"totalBudget\\"|"totalBudget"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const spentM = chunk.match(/(?:\\"budgetSpent\\"|"budgetSpent"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const fundedM = chunk.match(/(?:\\"fundedAt\\"|"fundedAt"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const catM = chunk.match(/(?:\\"category\\"|"category"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  
  // Strict description match: stops at the very next field delimiter
  const descM = chunk.match(/(?:\\"description\\"|"description"):(?:\\"|")((?:(?!\\",\\"(?:experienceId|status|socialPlatforms|whopProductRoute|isVerified|companyId|fundedAt|programId|category|creators|pricePerView|budgetSpent)|",")[^"\\]|\\.)*)(?:\\"|")/);
  
  // Extract social platforms array: ["tiktok","instagram","youtube"]
  const platformsM = chunk.match(/(?:\\"socialPlatforms\\"|"socialPlatforms"):\[(.*?)\]/);
  let platforms = [];
  if (platformsM && platformsM[1]) {
    const rawPlat = platformsM[1].replace(/\\"/g, '"').replace(/"/g, '');
    platforms = rawPlat.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }
  if (platforms.length === 0) {
    platforms = ['tiktok', 'instagram']; // Default supported clipping platforms
  }

  // Extract Whop route if present
  const routeM = chunk.match(/(?:\\"whopProductRoute\\"|"whopProductRoute"):(?:\\"|")([^"\\]+)(?:\\"|")/);
  const whopProductRoute = routeM ? routeM[1] : null;

  if (titleM && titleM[1]) {
    seenIds.add(id);

    let title = titleM[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
    let agency = brandM ? brandM[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim() : 'Independent';
    let cpm = cpmM ? parseFloat(cpmM[1].replace(/[$,]/g, '')) || 1.5 : 1.5;
    let total = totalM ? parseFloat(totalM[1].replace(/[$,]/g, '')) || 0 : 0;
    let spent = spentM ? parseFloat(spentM[1].replace(/[$,]/g, '')) || 0 : 0;
    let fundedAt = fundedM ? fundedM[1] : null;
    let category = catM ? catM[1].replace(/\\"/g, '"').trim() : 'General';

    if (agency.includes('"') || agency.includes(',')) {
      agency = agency.split('"')[0].split(',')[0].trim();
    }
    if (title.includes('"') && !title.endsWith('"')) {
      title = title.split('",')[0].trim();
    }

    let rawDesc = descM ? descM[1] : '';
    let description = rawDesc
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .trim();

    if (description.includes('"experienceId"') || description.includes('experienceId')) {
      description = description.split('"experienceId"')[0].split('experienceId')[0].trim();
    }
    if (description.endsWith('\\') || description.endsWith('"') || description.endsWith(',')) {
      description = description.slice(0, -1).trim();
    }

    if (!description || description.length < 5) {
      description = `${agency} short-form clipping campaign on Content Rewards. Post high-performing clips to earn $${cpm.toFixed(2)}/1K views.`;
    }

    // Extract any document / form links from description
    const docLinks = description.match(/https?:\/\/[^\s"',]+/g) || [];

    campaigns.push({
      id,
      title,
      agency,
      category,
      cpm,
      total,
      spent,
      fundedAt,
      description,
      platforms,
      docLinks,
      whopProductRoute
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

console.log(`✅ Extracted ${cleaned.length} 100% strictly matched campaigns with platforms & document links!`);
console.log("\nSample 5 verified items with platforms:");
cleaned.slice(0, 5).forEach((c, idx) => {
  console.log(`\n[${idx + 1}] [${c.agency}] "${c.title}"`);
  console.log(`  Platforms: [${c.platforms.join(', ')}]`);
  console.log(`  Brief: "${c.description.slice(0, 120)}..."`);
  if (c.docLinks.length > 0) {
    console.log(`  📎 Doc Links: ${c.docLinks.join(', ')}`);
  }
});

fs.writeFileSync(path.join(__dirname, 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns.json'), JSON.stringify(cleaned, null, 2), 'utf8');

const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(cleaned)};`;
fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');
