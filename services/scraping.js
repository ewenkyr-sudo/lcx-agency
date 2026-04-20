const https = require('https');
const pool = require('../db/pool');

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

// Route pour forcer un refresh des followers (admin)
app.post('/api/admin/refresh-followers', authMiddleware, adminOnly, async (req, res) => {
  updateAllFollowers(); // lancer en arrière-plan
  res.json({ ok: true, message: 'Mise à jour lancée en arrière-plan' });
});


module.exports = { updateAllFollowers };
