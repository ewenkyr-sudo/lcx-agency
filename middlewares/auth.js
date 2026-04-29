const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    pool.query('SELECT read_only, expires_at, agency_id, current_agency_id, role FROM users WHERE id = $1', [decoded.id]).then(async (result) => {
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
      if (user.expires_at && new Date(user.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Compte expiré' });
      }
      if (user.read_only && req.method !== 'GET' && decoded.role !== 'admin' && decoded.role !== 'super_admin') {
        return res.status(403).json({ error: 'Compte en lecture seule' });
      }

      // Resolve current agency context
      const activeAgencyId = user.current_agency_id || user.agency_id || 1;

      // Look up role from agency_memberships for the active agency
      let activeRole = user.role; // fallback to users.role
      try {
        const membershipResult = await pool.query(
          'SELECT role FROM agency_memberships WHERE user_id = $1 AND agency_id = $2 AND is_active = true',
          [decoded.id, activeAgencyId]
        );
        if (membershipResult.rows.length > 0) {
          activeRole = membershipResult.rows[0].role;
        }
      } catch (e) {
        // agency_memberships may not exist yet — fallback to users.role
      }

      // Set agency context on request
      req.user.agency_id = activeAgencyId;
      req.agencyId = activeAgencyId; // convenience alias
      req.user.role = activeRole;
      req.user.home_agency_id = user.agency_id; // original agency (never changes)

      // Check subscription status — platform_admin bypasses
      if (activeRole !== 'platform_admin' && activeAgencyId) {
        try {
          const agencyResult = await pool.query('SELECT subscription_status, onboarding_completed FROM agencies WHERE id = $1', [activeAgencyId]);
          const agency = agencyResult.rows[0];

          // Check agency_metadata for student_free billing (skip subscription check)
          let isStudentFree = false;
          try {
            const metaResult = await pool.query('SELECT billing_status FROM agency_metadata WHERE agency_id = $1', [activeAgencyId]);
            if (metaResult.rows.length > 0 && metaResult.rows[0].billing_status === 'student_free') {
              isStudentFree = true;
            }
          } catch (e) { /* agency_metadata may not exist yet */ }

          if (!isStudentFree && agency && agency.subscription_status && agency.subscription_status !== 'active' && agency.subscription_status !== 'trialing') {
            return res.status(403).json({ error: 'Votre abonnement est expiré. Renouvelez sur fuzionpilot.com' });
          }
          req.user.onboarding_completed = agency ? agency.onboarding_completed : true;
        } catch (subErr) {
          req.user.onboarding_completed = true;
        }
      } else {
        req.user.onboarding_completed = true;
      }

      // Onboarding gate
      if (req.user.onboarding_completed === false) {
        const p = req.path;
        const onboardingWhitelist = ['/api/me', '/api/logout', '/api/agency/onboarding', '/api/agency/language', '/api/agency-context'];
        if (!onboardingWhitelist.some(w => p.startsWith(w))) {
          return res.status(403).json({ error: 'ONBOARDING_REQUIRED' });
        }
      }

      next();
    }).catch((err) => {
      console.error('[AUTH] Erreur middleware:', err.message);
      req.user.agency_id = decoded.agency_id || 1;
      req.agencyId = req.user.agency_id;
      req.user.role = decoded.role;
      next();
    });
  } catch {
    return res.status(401).json({ error: 'Token invalide' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

function platformAdminOnly(req, res, next) {
  if (req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  next();
}

module.exports = { authMiddleware, adminOnly, platformAdminOnly };
