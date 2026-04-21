const https = require('https');
const pool = require('../db/pool');

// broadcast is set by server.js after WS init
let broadcast = function() {};
function setBroadcast(fn) { broadcast = fn; }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function scrapeInstagramFollowers(handle) {
  try {
    const username = handle.replace(/^@/, '');
    const html = await httpGet(`https://www.instagram.com/${username}/`);
    // Chercher dans les meta tags ou le JSON
    const metaMatch = html.match(/"edge_followed_by":\{"count":(\d+)\}/);
    if (metaMatch) return parseInt(metaMatch[1]);
    const metaTag = html.match(/content="([\d,.]+[kKmM]?) Followers/);
    if (metaTag) {
      let val = metaTag[1].replace(/,/g, '');
      if (val.match(/[kK]$/)) return Math.round(parseFloat(val) * 1000);
      if (val.match(/[mM]$/)) return Math.round(parseFloat(val) * 1000000);
      return parseInt(val);
    }
    // Essayer le format JSON-LD ou og:description
    const ogMatch = html.match(/(\d[\d,.]*)\s*Followers/i);
    if (ogMatch) {
      let val = ogMatch[1].replace(/,/g, '');
      return parseInt(val);
    }
    return null;
  } catch (e) {
    console.log(`IG scrape failed for ${handle}:`, e.message);
    return null;
  }
}

async function scrapeTikTokFollowers(handle) {
  try {
    const username = handle.replace(/^@/, '');
    const html = await httpGet(`https://www.tiktok.com/@${username}`);
    // TikTok met les stats dans un JSON script
    const match = html.match(/"followerCount":(\d+)/);
    if (match) return parseInt(match[1]);
    // Fallback: meta description
    const metaMatch = html.match(/Followers[^\d]*(\d[\d,.]*)/i);
    if (metaMatch) return parseInt(metaMatch[1].replace(/,/g, ''));
    return null;
  } catch (e) {
    console.log(`TikTok scrape failed for ${handle}:`, e.message);
    return null;
  }
}

async function updateAllFollowers() {
  try {
    const { rows: accounts } = await pool.query(
      "SELECT id, platform, handle, current_followers FROM accounts WHERE platform IN ('instagram', 'tiktok')"
    );

    let updated = 0;
    for (const acc of accounts) {
      let newCount = null;
      if (acc.platform === 'instagram') {
        newCount = await scrapeInstagramFollowers(acc.handle);
      } else if (acc.platform === 'tiktok') {
        newCount = await scrapeTikTokFollowers(acc.handle);
      }

      if (newCount !== null && newCount !== acc.current_followers) {
        await pool.query(
          'UPDATE accounts SET previous_followers = current_followers, current_followers = $1, last_scraped = NOW() WHERE id = $2',
          [newCount, acc.id]
        );
        updated++;
      } else if (newCount !== null) {
        // Même valeur, juste mettre à jour last_scraped
        await pool.query('UPDATE accounts SET last_scraped = NOW() WHERE id = $1', [acc.id]);
      }

      // Pause entre chaque requête pour éviter le rate limit
      await new Promise(r => setTimeout(r, 2000));
    }

    if (updated > 0) {
      broadcast('followers-updated', { updated });
      console.log(`Followers updated: ${updated} accounts`);
    }
  } catch (e) {
    console.error('Follower update error:', e.message);
  }
}

// ========== PROFILE PICTURE SCRAPING ==========

function scrapeOgImage(html) {
  // Try og:image meta tag
  var match = html.match(/property="og:image"\s+content="([^"]+)"/);
  if (match) return match[1];
  match = html.match(/content="([^"]+)"\s+property="og:image"/);
  if (match) return match[1];
  // Try profile_pic_url in JSON
  match = html.match(/"profile_pic_url(?:_hd)?":"([^"]+)"/);
  if (match) return match[1].replace(/\\u0026/g, '&');
  return null;
}

function downloadImage(url) {
  return new Promise(function(resolve, reject) {
    var mod = url.startsWith('https') ? https : require('http');
    var req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, function(res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var buf = Buffer.concat(chunks);
        // Limit to 200 KB
        if (buf.length > 200 * 1024) { resolve(null); return; }
        resolve(buf.toString('base64'));
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

async function updateProfilePictures() {
  try {
    // Get accounts that need avatar refresh (NULL or > 24h old), max 50
    var { rows: accounts } = await pool.query(
      "SELECT id, platform, handle FROM accounts WHERE platform IN ('instagram','tiktok') AND (profile_picture_updated_at IS NULL OR profile_picture_updated_at < NOW() - INTERVAL '24 hours') LIMIT 50"
    );
    if (accounts.length === 0) return;
    console.log('[AVATAR] Refreshing', accounts.length, 'profile pictures...');

    var updated = 0;
    for (var acc of accounts) {
      try {
        var username = acc.handle.replace(/^@/, '');
        var url;
        if (acc.platform === 'instagram') {
          url = 'https://www.instagram.com/' + username + '/';
        } else if (acc.platform === 'tiktok') {
          url = 'https://www.tiktok.com/@' + username;
        } else continue;

        var html = await httpGet(url);
        var ogUrl = scrapeOgImage(html);
        if (!ogUrl) {
          await pool.query('UPDATE accounts SET profile_picture_updated_at = NOW() WHERE id = $1', [acc.id]);
          continue;
        }

        var base64 = await downloadImage(ogUrl);
        if (base64) {
          await pool.query('UPDATE accounts SET profile_picture_data = $1, profile_picture_url = $2, profile_picture_updated_at = NOW() WHERE id = $3', [base64, ogUrl, acc.id]);
          updated++;
        } else {
          await pool.query('UPDATE accounts SET profile_picture_url = $1, profile_picture_updated_at = NOW() WHERE id = $2', [ogUrl, acc.id]);
        }
      } catch(e) {
        console.log('[AVATAR] Failed for', acc.handle + ':', e.message);
        await pool.query('UPDATE accounts SET profile_picture_updated_at = NOW() WHERE id = $1', [acc.id]);
      }
      // Rate limit
      await new Promise(function(r) { setTimeout(r, 2000); });
    }
    if (updated > 0) console.log('[AVATAR] Updated', updated, 'profile pictures');
  } catch(e) {
    console.error('[AVATAR] Error:', e.message);
  }
}

// ========== AGENCY ACCOUNTS SCRAPING ==========
async function updateAgencyAccounts() {
  try {
    var { rows: accounts } = await pool.query(
      "SELECT id, platform, handle, current_followers FROM agency_accounts WHERE platform IN ('instagram','tiktok')"
    );
    for (var acc of accounts) {
      try {
        var newCount = null;
        if (acc.platform === 'instagram') newCount = await scrapeInstagramFollowers(acc.handle);
        else if (acc.platform === 'tiktok') newCount = await scrapeTikTokFollowers(acc.handle);
        if (newCount !== null) {
          await pool.query('UPDATE agency_accounts SET previous_followers = current_followers, current_followers = $1, last_scraped = NOW() WHERE id = $2', [newCount, acc.id]);
        }
        // Also scrape avatar if needed
        if (acc.platform === 'instagram' || acc.platform === 'tiktok') {
          var needsAvatar = (await pool.query('SELECT profile_picture_updated_at FROM agency_accounts WHERE id = $1 AND (profile_picture_updated_at IS NULL OR profile_picture_updated_at < NOW() - INTERVAL \'24 hours\')', [acc.id])).rows[0];
          if (needsAvatar) {
            var username = acc.handle.replace(/^@/, '');
            var url = acc.platform === 'instagram' ? 'https://www.instagram.com/' + username + '/' : 'https://www.tiktok.com/@' + username;
            var html = await httpGet(url);
            var ogUrl = scrapeOgImage(html);
            if (ogUrl) {
              var base64 = await downloadImage(ogUrl);
              if (base64) await pool.query('UPDATE agency_accounts SET profile_picture_data = $1, profile_picture_url = $2, profile_picture_updated_at = NOW() WHERE id = $3', [base64, ogUrl, acc.id]);
            }
          }
        }
      } catch(e) { console.log('[AGENCY SCRAPE] Failed for', acc.handle + ':', e.message); }
      await new Promise(function(r) { setTimeout(r, 2000); });
    }
  } catch(e) { console.error('[AGENCY SCRAPE] Error:', e.message); }
}

module.exports = { updateAllFollowers, updateProfilePictures, updateAgencyAccounts, setBroadcast, scrapeInstagramFollowers, scrapeTikTokFollowers, scrapeOgImage, downloadImage };


