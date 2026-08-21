const https = require('https');

const discordUrl = process.env.DISCORD_WEBHOOK_URL || '';

const payload = JSON.stringify({
  embeds: [{
    title: '⚡ NEW CAMPAIGN DROP: Starz - Fightland Episode 2 Clipping',
    url: 'https://contentrewards.com/discover/3172b050-0ca0-4d5b-b507-19041d098b76',
    description: '**Agency:** `Clipping Culture`\n**Category:** `Entertainment`\n**🕒 Posted:** **Just now (< 1h ago)**',
    color: 0xC9FF3D,
    fields: [
      { name: '💰 CPM Rate', value: '**$2.00** / 1K views', inline: true },
      { name: '🏦 Remaining Pool', value: '**$7,319** left', inline: true },
      { name: '📊 Total Budget', value: '$8,400', inline: true },
      { name: '🔗 Direct Campaign Link', value: '[👉 Click to Open "Starz - Fightland Episode 2"](https://contentrewards.com/discover/3172b050-0ca0-4d5b-b507-19041d098b76)', inline: false }
    ],
    footer: { text: 'Content Rewards Radar • Live New Campaign Drop Alert' },
    timestamp: new Date().toISOString()
  }]
});

const req = https.request(discordUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  console.log('Discord Fresh Drop Test Status:', res.statusCode);
});

req.on('error', err => console.error('Discord error:', err.message));
req.write(payload);
req.end();
