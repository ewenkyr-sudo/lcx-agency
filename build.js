// Generates a unique build hash in the service worker before each deploy
// The sw.js in the repo always has __BUILD_HASH__ as placeholder.
// This script replaces it with a real hash at build time on Render.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const swPath = path.join(__dirname, 'public', 'sw.js');
const hash = crypto.randomBytes(8).toString('hex');

let content = fs.readFileSync(swPath, 'utf8');
content = content.replace('__BUILD_HASH__', hash);
fs.writeFileSync(swPath, content);

console.log(`SW build hash injected: ${hash}`);
