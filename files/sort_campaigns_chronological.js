const fs = require('fs');
const path = require('path');

const campaignsPath = path.join(__dirname, '..', 'campaigns.json');
const filesPath = path.join(__dirname, 'campaigns.json');

const data = JSON.parse(fs.readFileSync(filesPath, 'utf8'));

// Helper to calculate relative timestamp
function getSortScore(c) {
  if (c.fundedAt) return new Date(c.fundedAt).getTime();
  const age = (c.age || '').toLowerCase();
  if (age.includes('m') && !age.includes('mo')) return Date.now() - (parseInt(age) || 1) * 60000;
  if (age.includes('h')) return Date.now() - (parseInt(age) || 1) * 3600000;
  if (age.includes('d')) return Date.now() - (parseInt(age) || 1) * 86400000;
  if (age.includes('mo')) return Date.now() - (parseInt(age) || 1) * 2592000000;
  return 0;
}

data.forEach(c => {
  const age = (c.age || '').toLowerCase();
  if (age.includes('m') && !age.includes('mo')) c.formattedAge = "Just now (< 1h ago)";
  else if (age.includes('h')) c.formattedAge = `${age} ago (Today)`;
  else if (age.includes('d')) c.formattedAge = `${age} ago`;
  else c.formattedAge = c.age || "Active";
  c.sortTimestamp = getSortScore(c);
});

data.sort((a, b) => (b.sortTimestamp || 0) - (a.sortTimestamp || 0));

console.log(`Sorted ${data.length} campaigns in strict newest-first chronological order!`);
console.log("Top 5 newest campaigns:", JSON.stringify(data.slice(0, 5).map(c => ({ title: c.title, age: c.formattedAge, url: c.url })), null, 2));

fs.writeFileSync(filesPath, JSON.stringify(data, null, 2));
fs.writeFileSync(campaignsPath, JSON.stringify(data, null, 2));
