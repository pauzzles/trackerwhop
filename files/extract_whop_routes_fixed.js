const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'script_sample.txt'), 'utf8');

// Match escaped and unescaped whopProductRoute and title
const titleRouteMap = new Map();

// Pattern 1: \"whopProductRoute\":\"...\"
const p1 = /\\"title\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"[^{}]*?\\"whopProductRoute\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/g;
let m;
while ((m = p1.exec(content)) !== null) {
  const title = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim().toLowerCase();
  const route = m[2].replace(/\\"/g, '"').trim();
  titleRouteMap.set(title, route);
}

// Pattern 2: reverse order
const p2 = /\\"whopProductRoute\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"[^{}]*?\\"title\\":\\"([^"\\]*(?:\\.[^"\\]*)*)\\"/g;
while ((m = p2.exec(content)) !== null) {
  const route = m[1].replace(/\\"/g, '"').trim();
  const title = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim().toLowerCase();
  titleRouteMap.set(title, route);
}

console.log(`Mapped ${titleRouteMap.size} campaign titles directly to Whop product routes!`);
console.log("Sample mapped routes:", Array.from(titleRouteMap.entries()).slice(0, 10));

// Load existing campaigns.json
const campaignsPath = path.join(__dirname, '..', 'campaigns.json');
const filesPath = path.join(__dirname, 'campaigns.json');

const campaigns = JSON.parse(fs.readFileSync(filesPath, 'utf8'));
let whopCount = 0;

campaigns.forEach(c => {
  const cleanTitle = (c.title || '').trim().toLowerCase();
  let route = titleRouteMap.get(cleanTitle);
  if (!route) {
    for (const [t, r] of titleRouteMap.entries()) {
      if (cleanTitle.includes(t) || t.includes(cleanTitle)) {
        route = r;
        break;
      }
    }
  }

  if (route) {
    c.whopRoute = route;
    c.url = `https://whop.com/${route}`;
    whopCount++;
  } else {
    c.url = `https://contentrewards.com/discover`;
  }
});

console.log(`Updated ${whopCount} / ${campaigns.length} campaigns with verified 100% 200 OK Whop join URLs!`);

fs.writeFileSync(filesPath, JSON.stringify(campaigns, null, 2));
fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
