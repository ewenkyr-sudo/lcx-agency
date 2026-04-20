const rateLimit = require('express-rate-limit');

const sensitiveRL = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Trop de requêtes' } });
const passwordRL = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Trop de tentatives' } });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Trop de tentatives, réessayez dans 15 minutes' }, standardHeaders: true, legacyHeaders: false });
const forgotPasswordRL = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, validate: { xForwardedForHeader: false }, message: { error: 'Trop de demandes, réessayez dans 1 heure' } });

module.exports = { sensitiveRL, passwordRL, loginLimiter, forgotPasswordRL };
