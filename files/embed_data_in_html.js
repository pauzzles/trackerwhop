const fs = require('fs');
const path = require('path');

const campaigns = JSON.parse(fs.readFileSync(path.join(__dirname, 'campaigns.json'), 'utf8'));
const indexPath = path.join(__dirname, '..', 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');

const replacement = `  let CAMPAIGNS = ${JSON.stringify(campaigns)};`;
indexHtml = indexHtml.replace('  let CAMPAIGNS = [];', replacement);

fs.writeFileSync(indexPath, indexHtml, 'utf8');
fs.writeFileSync(path.join(__dirname, 'signal-campaign-matcher.html'), indexHtml, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'signal-campaign-matcher.html'), indexHtml, 'utf8');

console.log(`Embedded ${campaigns.length} campaigns directly into index.html for instant zero-latency rendering!`);
