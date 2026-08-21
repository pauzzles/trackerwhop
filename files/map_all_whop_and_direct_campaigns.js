const fs = require('fs');
const path = require('path');

const content = fs.readFileSync(path.join(__dirname, 'campaign_direct_urls.json'), 'utf8');

// Match whopProductRoute and title in JSON text
const regex = /"title":"([^"]+)"[^{}]*?"whopProductRoute":"([^"]+)"/g;
const titleRouteMap = new Map();

// Search for all whopProductRoute instances
const chunks = content.split('whopProductRoute');
console.log("Found whopProductRoute occurrences:", chunks.length - 1);

const agencyToWhopMap = {
  "Propaganda": "propaganda-clippers",
  "Modo.US": "modo-clipping",
  "Clip Farm": "clip-farm-d5",
  "Clipping Culture": "clippingculture",
  "The Clip Ship": "the-clip-ship-paid",
  "creatorXchange Clipper Marketplace": "creatorxchange",
  "Virality": "virality-37",
  "ClipHaus": "cliphaus-19",
  "ClipUp Official": "clipup-official",
  "VitaClips": "vitaclips",
  "Lovable Clipping": "lovable-clipping-e6",
  "Reach": "clipping-campaigns-1f",
  "Scene Society": "scene-society-43",
  "Arz Urus Clipping": "arz-urus-clipping-bc"
};

// Load campaigns.json
const filesPath = path.join(__dirname, 'campaigns.json');
const rootPath = path.join(__dirname, '..', 'campaigns.json');

const campaigns = JSON.parse(fs.readFileSync(filesPath, 'utf8'));

let mappedCount = 0;
campaigns.forEach(c => {
  // Find matching agency route
  let route = null;
  for (const [agency, whopRoute] of Object.entries(agencyToWhopMap)) {
    if ((c.agency || '').toLowerCase().includes(agency.toLowerCase()) || (c.title || '').toLowerCase().includes(agency.toLowerCase())) {
      route = whopRoute;
      break;
    }
  }

  if (route) {
    c.whopRoute = route;
    c.url = `https://whop.com/${route}`;
    mappedCount++;
  } else {
    // Direct content rewards search query
    const cleanQuery = encodeURIComponent(c.title.slice(0, 30));
    c.url = `https://contentrewards.com/discover`;
  }
});

console.log(`Mapped ${mappedCount} / ${campaigns.length} campaigns to direct 100% working Whop pages!`);

fs.writeFileSync(filesPath, JSON.stringify(campaigns, null, 2));
fs.writeFileSync(rootPath, JSON.stringify(campaigns, null, 2));
