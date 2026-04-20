const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const JWT_SECRET = process.env.JWT_SECRET;

function authMiddleware(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifié' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Requête simple d'abord (sans JOIN) — plus robuste si les colonnes Stripe n'existent pas encore
    pool.query('SELECT read_only, expires_at, agency_id, role FROM users WHERE id = $1', [decoded.id]).then(async (result) => {
      const user = result.rows[0];
      if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
      if (user.expires_at && new Date(user.expires_at) < new Date()) {
        return res.status(401).json({ error: 'Compte expiré' });
      }
      if (user.read_only && req.method !== 'GET' && decoded.role !== 'admin' && decoded.role !== 'super_admin') {
        return res.status(403).json({ error: 'Compte en lecture seule' });
      }

      req.user.agency_id = user.agency_id || 1;
      req.user.role = user.role;

      // Check subscription status — platform_admin bypasses, wrapped in try/catch
      if (user.role !== 'platform_admin' && user.agency_id) {
        try {
          const agencyResult = await pool.query('SELECT subscription_status, onboarding_completed FROM agencies WHERE id = $1', [user.agency_id]);
          const agency = agencyResult.rows[0];
          if (agency && agency.subscription_status && agency.subscription_status !== 'active' && agency.subscription_status !== 'trialing') {
            return res.status(403).json({ error: 'Votre abonnement est expiré. Renouvelez sur fuzionpilot.com' });
          }
          // Attach onboarding status for downstream middleware
          req.user.onboarding_completed = agency ? agency.onboarding_completed : true;
        } catch (subErr) {
          // Si les colonnes n'existent pas encore, on laisse passer
          req.user.onboarding_completed = true;
        }
      } else {
        req.user.onboarding_completed = true;
      }

      // Onboarding gate: block non-whitelisted routes if onboarding not completed
      if (req.user.onboarding_completed === false) {
        const p = req.path;
        const onboardingWhitelist = ['/api/me', '/api/logout', '/api/agency/onboarding', '/api/agency/language'];
        if (!onboardingWhitelist.some(w => p.startsWith(w))) {
          return res.status(403).json({ error: 'ONBOARDING_REQUIRED' });
        }
      }

      next();
    }).catch((err) => {
      console.error('[AUTH] Erreur middleware:', err.message);
      // En cas d'erreur DB, on laisse passer avec les infos du token
      req.user.agency_id = decoded.agency_id || 1;
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
