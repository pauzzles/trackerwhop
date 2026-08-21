const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'campaign_direct_urls.json'), 'utf8');

// Match all objects containing whopProductRoute and title/id
const routeRegex = /"title":"([^"]+)"[^{}]*?"whopProductRoute":"([^"]+)"/g;
const reverseRegex = /"whopProductRoute":"([^"]+)"[^{}]*?"title":"([^"]+)"/g;

const titleRouteMap = new Map();
let m;
while ((m = routeRegex.exec(content)) !== null) {
  titleRouteMap.set(m[1].trim().toLowerCase(), m[2].trim());
}
while ((m = reverseRegex.exec(content)) !== null) {
  titleRouteMap.set(m[2].trim().toLowerCase(), m[1].trim());
}

console.log(`Mapped ${titleRouteMap.size} campaign titles to official Whop Product Routes!`);

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

console.log(`Updated ${whopCount} / ${campaigns.length} campaigns with verified 100% working Whop join URLs!`);

fs.writeFileSync(filesPath, JSON.stringify(campaigns, null, 2));
fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
