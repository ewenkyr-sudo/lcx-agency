// ========================================
// FUZION PILOT — NOTIFICATION SERVICE
// ========================================

const pool = require('../db/pool');

let broadcast = function() {};
function setBroadcast(fn) { broadcast = fn; }

/**
 * Create a notification for a user.
 * Silent on error — never crashes the calling endpoint.
 */
async function createNotification(userId, agencyId, type, title, description, link, metadata) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, agency_id, type, title, description, link, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [userId, agencyId, type, title, description || '', link || '', JSON.stringify(metadata || {})]
    );
    // Push via WebSocket if user is connected
    try { broadcast('notification', rows[0], userId); } catch(e) {}
    return rows[0];
  } catch(e) {
    console.error('[NOTIF] Error creating notification:', e.message);
    return null;
  }
}

/**
 * Create a notification for ALL admins of an agency.
 * Skips `excludeUserId` (the user who triggered the action).
 */
async function notifyAdmins(agencyId, type, title, description, link, metadata, excludeUserId) {
  try {
    const { rows: admins } = await pool.query(
      "SELECT id FROM users WHERE agency_id = $1 AND role IN ('admin','super_admin','platform_admin')",
      [agencyId]
    );
    for (const admin of admins) {
      if (admin.id === excludeUserId) continue;
      await createNotification(admin.id, agencyId, type, title, description, link, metadata);
    }
  } catch(e) {
    console.error('[NOTIF] Error notifying admins:', e.message);
  }
}

module.exports = { createNotification, notifyAdmins, setBroadcast };
