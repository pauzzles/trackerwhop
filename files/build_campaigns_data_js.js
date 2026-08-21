const fs = require('fs');
const path = require('path');

const campaigns = JSON.parse(fs.readFileSync(path.join(__dirname, 'campaigns.json'), 'utf8'));

const jsContent = `window.CAMPAIGNS_DATA = ${JSON.stringify(campaigns)};`;

fs.writeFileSync(path.join(__dirname, 'campaigns_data.js'), jsContent, 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'campaigns_data.js'), jsContent, 'utf8');

console.log(`Created campaigns_data.js with ${campaigns.length} campaigns!`);
