const { Resend } = require('resend');
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = 'Fuzion Pilot <contact@fuzionpilot.com>';
const APP_URL = process.env.APP_URL || 'https://lcx-agency.onrender.com';

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length < 5 || email.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendEmail(to, subject, html) {
  if (!resendClient) { console.log('[EMAIL] Resend non configuré, email ignoré vers', to); return; }
  try {
    console.log('[EMAIL] Envoi vers', to, '| Sujet:', subject);
    const result = await resendClient.emails.send({ from: EMAIL_FROM, to, subject, html });
    console.log('[EMAIL] Envoyé vers', to, '| ID:', result?.data?.id || 'N/A');
  } catch (e) {
    console.error('[EMAIL] ERREUR vers', to, ':', e.message);
  }
}

module.exports = { sendEmail, isValidEmail, EMAIL_FROM, APP_URL, resendClient };
