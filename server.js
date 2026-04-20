const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { Resend } = require('resend');

const app = express();
const PORT = process.env.PORT || 3000;
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Server cannot start.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

// Journée de travail commence à 9h (pour les stats "aujourd'hui")
const DAY_START_HOUR = 9;
// Expression SQL pour le début de la journée de travail courante
const SQL_TODAY_START = `(CASE WHEN CURRENT_TIME < '09:00' THEN CURRENT_TIMESTAMP::date - INTERVAL '1 day' ELSE CURRENT_TIMESTAMP::date END + INTERVAL '${DAY_START_HOUR} hours')`;

// ============ RESEND EMAIL ============
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = 'Fuzion Pilot <contact@fuzionpilot.com>';
const APP_URL = process.env.APP_URL || 'https://lcx-agency.onrender.com';
console.log('[BOOT] Resend initialisé:', !!resendClient);
if (!resendClient) console.error('[BOOT] ERREUR: RESEND_API_KEY manquante — les emails ne seront pas envoyés');
console.log('[BOOT] STRIPE_WEBHOOK_SECRET présente:', !!process.env.STRIPE_WEBHOOK_SECRET);
console.log('[BOOT] APP_URL:', APP_URL);

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length < 5 || email.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendEmail(to, subject, html) {
  if (!resendClient) { console.log('[EMAIL] Resend non configuré (RESEND_API_KEY manquante), email ignoré vers', to); return; }
  try {
    console.log('[EMAIL] Envoi en cours vers', to, '| Sujet:', subject);
    const result = await resendClient.emails.send({ from: EMAIL_FROM, to, subject, html });
    console.log('[EMAIL] Envoyé avec succès vers', to, '| ID:', result?.data?.id || 'N/A');
  } catch (e) {
    console.error('[EMAIL] ERREUR envoi vers', to, ':', e.message);
    if (e.statusCode) console.error('[EMAIL] Status code:', e.statusCode);
  }
}

// ============ MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
// Stripe webhook needs raw body — must be before express.json
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('[STRIPE WEBHOOK] Requête reçue');
  console.log('[STRIPE WEBHOOK] Content-Type:', req.headers['content-type']);
  console.log('[STRIPE WEBHOOK] Body size:', req.body?.length || 0, 'bytes');

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  console.log('[STRIPE WEBHOOK] Signature présente:', !!sig);
  console.log('[STRIPE WEBHOOK] Endpoint secret configuré:', !!endpointSecret);

  if (endpointSecret && sig) {
    try {
      const elements = sig.split(',');
      const timestampEl = elements.find(e => e.startsWith('t='));
      const signatureEl = elements.find(e => e.startsWith('v1='));
      if (!timestampEl || !signatureEl) {
        console.error('[STRIPE WEBHOOK] Signature mal formée:', sig);
        return res.status(400).send('Malformed signature');
      }
      const timestamp = timestampEl.slice(2);
      const signature = signatureEl.slice(3);
      const signedPayload = timestamp + '.' + req.body.toString();
      const expected = crypto.createHmac('sha256', endpointSecret).update(signedPayload).digest('hex');
      if (signature !== expected) {
        console.error('[STRIPE WEBHOOK] Signature INVALIDE — rejet de la requête');
        return res.status(400).send('Invalid signature');
      }
      console.log('[STRIPE WEBHOOK] Signature vérifiée OK');
      event = JSON.parse(req.body);
    } catch (sigErr) {
      console.error('[STRIPE WEBHOOK] Erreur vérification signature:', sigErr.message);
      return res.status(400).send('Signature verification failed');
    }
  } else {
    console.log('[STRIPE WEBHOOK] Pas de secret configuré — acceptation sans vérification');
    try {
      event = JSON.parse(req.body);
    } catch (parseErr) {
      console.error('[STRIPE WEBHOOK] Erreur parsing JSON body:', parseErr.message);
      return res.status(400).send('Invalid JSON');
    }
  }

  console.log('[STRIPE WEBHOOK] Event type:', event.type);
  console.log('[STRIPE WEBHOOK] Event ID:', event.id);

  // --- Helper: génère token + envoie emails bienvenue + confirmation ---
  async function handleNewPayment(source, email, planName, amount, stripeCustomerId, stripeSubscriptionId) {
    console.log(`[STRIPE WEBHOOK] ${source}:`);
    console.log('  Email:', email);
    console.log('  Plan:', planName);
    console.log('  Montant:', amount, '€');
    console.log('  Customer ID:', stripeCustomerId);
    console.log('  Subscription ID:', stripeSubscriptionId);

    if (!email) { console.log(`[STRIPE WEBHOOK] ERREUR: pas d'email dans ${source} — abandon`); return; }

    // Anti-doublon: skip seulement si un token a été créé il y a moins de 5 min (checkout+invoice quasi simultanés)
    const existing = await pool.query('SELECT id, created_at FROM invitation_tokens WHERE email = $1 AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1', [email]);
    if (existing.rows.length > 0) {
      const ageMinutes = (Date.now() - new Date(existing.rows[0].created_at).getTime()) / 60000;
      if (ageMinutes < 5) {
        console.log(`[STRIPE WEBHOOK] Token actif créé il y a ${ageMinutes.toFixed(1)} min pour ${email} — skip (doublon récent)`);
        return;
      }
      console.log(`[STRIPE WEBHOOK] Token existant pour ${email} mais créé il y a ${ageMinutes.toFixed(0)} min — on en crée un nouveau`);
    }

    // Generate invitation token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
    console.log('[STRIPE WEBHOOK] Token invitation généré:', token, '| Expire:', expiresAt.toISOString());

    await pool.query(
      'INSERT INTO invitation_tokens (token, email, role, plan, stripe_customer_id, stripe_subscription_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [token, email, 'super_admin', planName, stripeCustomerId, stripeSubscriptionId, expiresAt]
    );
    console.log('[STRIPE WEBHOOK] Token inséré en DB OK');

    // Send welcome email
    const inviteUrl = `${APP_URL}/invite.html?token=${token}`;
    console.log('[STRIPE WEBHOOK] Envoi email bienvenue vers', email, '| URL:', inviteUrl);
    await sendEmail(email, 'Bienvenue sur Fuzion Pilot — Activez votre compte', `
      <div style="background:#09090b;color:#f0f0f5;font-family:'Inter',Arial,sans-serif;padding:0;margin:0;">
        <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-block;width:56px;height:56px;background:linear-gradient(135deg,#7c3aed,#22d3ee);border-radius:16px;line-height:56px;font-size:20px;font-weight:800;color:white;text-align:center;font-family:sans-serif;">FP</div>
            <h1 style="font-size:24px;font-weight:800;margin:16px 0 0;color:#ffffff;">Fuzion Pilot</h1>
          </div>
          <div style="background:#111114;border:1px solid rgba(124,58,237,0.2);border-radius:16px;padding:32px;text-align:center;">
            <h2 style="font-size:20px;margin:0 0 12px;color:#ffffff;">Bienvenue ! 🎉</h2>
            <p style="color:#a0a0c0;font-size:15px;line-height:1.6;margin:0 0 24px;">Votre paiement a été confirmé. Cliquez sur le bouton ci-dessous pour créer votre compte et accéder à votre dashboard.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#06d6a0);color:white;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 4px 20px rgba(124,58,237,0.3);">Activer mon compte</a>
            <p style="color:#5a5a7a;font-size:12px;margin-top:24px;">Ce lien expire dans 48 heures.</p>
          </div>
          <p style="color:#5a5a7a;font-size:12px;text-align:center;margin-top:24px;">© 2026 Fuzion Pilot — contact@fuzionpilot.com</p>
        </div>
      </div>
    `);

    // Send payment confirmation email
    console.log('[STRIPE WEBHOOK] Envoi email confirmation paiement vers', email);
    const renewDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('fr-FR');
    await sendEmail(email, 'Paiement confirmé — Fuzion Pilot', `
      <div style="background:#09090b;color:#f0f0f5;font-family:'Inter',Arial,sans-serif;padding:0;margin:0;">
        <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
          <div style="text-align:center;margin-bottom:32px;">
            <div style="display:inline-block;width:56px;height:56px;background:linear-gradient(135deg,#7c3aed,#22d3ee);border-radius:16px;line-height:56px;font-size:20px;font-weight:800;color:white;text-align:center;font-family:sans-serif;">FP</div>
            <h1 style="font-size:24px;font-weight:800;margin:16px 0 0;color:#ffffff;">Fuzion Pilot</h1>
          </div>
          <div style="background:#111114;border:1px solid rgba(124,58,237,0.2);border-radius:16px;padding:32px;">
            <h2 style="font-size:18px;margin:0 0 20px;color:#ffffff;text-align:center;">Paiement confirmé ✅</h2>
            <div style="background:#0a0a1a;border-radius:10px;padding:20px;margin-bottom:16px;">
              <p style="margin:0 0 8px;color:#a0a0c0;font-size:14px;"><strong style="color:#fff;">Plan :</strong> ${planName.charAt(0).toUpperCase() + planName.slice(1)}</p>
              <p style="margin:0 0 8px;color:#a0a0c0;font-size:14px;"><strong style="color:#fff;">Montant :</strong> ${amount}€</p>
              <p style="margin:0;color:#a0a0c0;font-size:14px;"><strong style="color:#fff;">Prochain renouvellement :</strong> ${renewDate}</p>
            </div>
            <p style="color:#5a5a7a;font-size:13px;text-align:center;">Gérez votre abonnement depuis votre espace client Stripe.</p>
          </div>
          <p style="color:#5a5a7a;font-size:12px;text-align:center;margin-top:24px;">© 2026 Fuzion Pilot — contact@fuzionpilot.com</p>
        </div>
      </div>
    `);

    console.log(`[STRIPE WEBHOOK] ${source} traité avec succès pour`, email);
  }

  try {
    // --- checkout.session.completed ---
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      await handleNewPayment(
        'checkout.session.completed',
        session.customer_email || session.customer_details?.email,
        session.metadata?.plan || 'pro',
        session.amount_total ? (session.amount_total / 100).toFixed(2) : '39.00',
        session.customer,
        session.subscription
      );
    }

    // --- invoice.payment_succeeded ---
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const billingReason = invoice.billing_reason;
      console.log('[STRIPE WEBHOOK] invoice.payment_succeeded | billing_reason:', billingReason);

      // Seulement sur la première facture (subscription_create), pas les renouvellements
      if (billingReason === 'subscription_create') {
        await handleNewPayment(
          'invoice.payment_succeeded (subscription_create)',
          invoice.customer_email,
          invoice.lines?.data?.[0]?.price?.metadata?.plan || invoice.lines?.data?.[0]?.description || 'pro',
          invoice.amount_paid ? (invoice.amount_paid / 100).toFixed(2) : '39.00',
          invoice.customer,
          invoice.subscription
        );
      } else {
        console.log(`[STRIPE WEBHOOK] invoice.payment_succeeded ignoré (billing_reason: ${billingReason}) — pas une première souscription`);
        // Pour les renouvellements, juste s'assurer que le status est actif
        if (invoice.customer) {
          await pool.query('UPDATE agencies SET subscription_status = $1 WHERE stripe_customer_id = $2', ['active', invoice.customer]);
          console.log('[STRIPE WEBHOOK] subscription_status remis à active pour customer', invoice.customer);
        }
      }
    }

    // --- subscription updated/deleted ---
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const status = sub.status;
      const customerId = sub.customer;
      console.log('[STRIPE WEBHOOK] Subscription event:', event.type);
      console.log('  Customer:', customerId, '| Nouveau status:', status);
      const result = await pool.query('UPDATE agencies SET subscription_status = $1 WHERE stripe_customer_id = $2', [status, customerId]);
      console.log('[STRIPE WEBHOOK] Agences mises à jour:', result.rowCount);
    }

    // --- Event non géré ---
    const handledEvents = ['checkout.session.completed', 'invoice.payment_succeeded', 'customer.subscription.updated', 'customer.subscription.deleted'];
    if (!handledEvents.includes(event.type)) {
      console.log('[STRIPE WEBHOOK] Event type non géré:', event.type, '— ignoré');
    }
  } catch(e) {
    console.error('[STRIPE WEBHOOK] ERREUR traitement:', e.message);
    console.error('[STRIPE WEBHOOK] Stack:', e.stack?.split('\n').slice(0,3).join('\n'));
  }

  console.log('[STRIPE WEBHOOK] Réponse envoyée: { received: true }');
  res.json({ received: true });
});

app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

// Forcer le navigateur à ne jamais cacher HTML/JS (anti-cache mobile)
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path === '/') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ============ DATABASE ============
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/lcx_agency',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student',
      avatar_color TEXT DEFAULT '#8b5cf6',
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      -- plain_password column removed for security
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS models (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      platforms TEXT DEFAULT '[]',
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      handle TEXT NOT NULL,
      current_followers INTEGER DEFAULT 0,
      previous_followers INTEGER DEFAULT 0,
      last_scraped TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS previous_followers INTEGER DEFAULT 0;
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_scraped TIMESTAMPTZ;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS daily_stats (
      id SERIAL PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      new_followers INTEGER DEFAULT 0,
      notes TEXT,
      UNIQUE(account_id, date)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      shift TEXT,
      models_assigned TEXT DEFAULT '[]',
      platform TEXT,
      contact TEXT,
      status TEXT DEFAULT 'offline',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      program TEXT DEFAULT 'starter',
      start_date TEXT,
      models_signed INTEGER DEFAULT 0,
      active_discussions INTEGER DEFAULT 0,
      progression INTEGER DEFAULT 0,
      progression_step TEXT DEFAULT 'onboarding',
      contact TEXT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE students ADD COLUMN IF NOT EXISTS progression_step TEXT DEFAULT 'onboarding';
      ALTER TABLE students ADD COLUMN IF NOT EXISTS outreach_us_enabled BOOLEAN DEFAULT false;
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS market TEXT DEFAULT 'fr';
      ALTER TABLE students ADD COLUMN IF NOT EXISTS drive_folder TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS drive_folder TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS drive_contract TEXT;
      ALTER TABLE models ADD COLUMN IF NOT EXISTS lifecycle_status TEXT DEFAULT 'active';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS read_only BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE planning_shifts ADD COLUMN IF NOT EXISTS entry_type TEXT DEFAULT 'shift';
      ALTER TABLE planning_shifts ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
      ALTER TABLE planning_shifts ADD COLUMN IF NOT EXISTS description TEXT;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS model_content_planning (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      drive_link TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Sessions actives (présence en ligne)
    CREATE TABLE IF NOT EXISTS active_sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_ping TIMESTAMPTZ DEFAULT NOW(),
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id)
    );

    -- Activity log
    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id INTEGER,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Shift clock (pointage)
    CREATE TABLE IF NOT EXISTS shift_clocks (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clock_in TIMESTAMPTZ NOT NULL,
      clock_out TIMESTAMPTZ,
      duration_minutes INTEGER
    );

    -- Model revenue objectives
    CREATE TABLE IF NOT EXISTS model_revenue_objectives (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      target NUMERIC(10,2) DEFAULT 0,
      current NUMERIC(10,2) DEFAULT 0,
      UNIQUE(model_id, month)
    );

    -- Payments tracking
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      model_id INTEGER NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      amount NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assigned_to TEXT,
      team TEXT,
      priority TEXT DEFAULT 'normal',
      deadline TEXT,
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS calls (
      id SERIAL PRIMARY KEY,
      student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'check-in',
      scheduled_at TEXT NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'scheduled',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schedule (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES team_members(id) ON DELETE CASCADE,
      member_name TEXT,
      member_role TEXT,
      day_of_week INTEGER NOT NULL,
      shift_type TEXT DEFAULT 'off',
      shift_label TEXT DEFAULT 'OFF',
      week_start TEXT
    );

    CREATE TABLE IF NOT EXISTS outreach_leads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      ig_link TEXT,
      lead_type TEXT DEFAULT 'model',
      script_used TEXT,
      ig_account_used TEXT,
      notes TEXT,
      status TEXT DEFAULT 'sent',
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    DO $$ BEGIN
      ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS chatter_shifts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      model_name TEXT NOT NULL,
      ppv_total NUMERIC(10,2) DEFAULT 0,
      tips_total NUMERIC(10,2) DEFAULT 0,
      shift_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Call requests (élèves demandent un call)
    CREATE TABLE IF NOT EXISTS call_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT,
      availabilities TEXT,
      status TEXT DEFAULT 'pending',
      scheduled_at TEXT,
      admin_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Modèles recrutées par les élèves
    CREATE TABLE IF NOT EXISTS student_recruits (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ig_name TEXT NOT NULL,
      ig_link TEXT,
      notes TEXT,
      status TEXT DEFAULT 'interested',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Leads outreach des élèves (isolé par élève)
    CREATE TABLE IF NOT EXISTS student_leads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      ig_link TEXT,
      lead_type TEXT DEFAULT 'model',
      script_used TEXT,
      ig_account_used TEXT,
      notes TEXT,
      status TEXT DEFAULT 'to-send',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Modèles gérées par les élèves (séparé de l'agence)
    CREATE TABLE IF NOT EXISTS student_models (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      of_handle TEXT,
      fans_count INTEGER DEFAULT 0,
      commission_rate NUMERIC(5,2) DEFAULT 0,
      status TEXT DEFAULT 'onboarding',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Revenus mensuels des élèves par modèle
    CREATE TABLE IF NOT EXISTS student_revenue (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_model_id INTEGER NOT NULL REFERENCES student_models(id) ON DELETE CASCADE,
      month TEXT NOT NULL,
      revenue NUMERIC(10,2) DEFAULT 0,
      UNIQUE(student_model_id, month)
    );

    -- Messagerie interne
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Ressources / Formation
    CREATE TABLE IF NOT EXISTS resources (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      res_type TEXT DEFAULT 'link',
      url TEXT,
      file_data BYTEA,
      file_name TEXT,
      file_mime TEXT,
      description TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Objectifs hebdomadaires
    CREATE TABLE IF NOT EXISTS weekly_objectives (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_start TEXT NOT NULL,
      obj_type TEXT NOT NULL,
      description TEXT,
      target INTEGER DEFAULT 0,
      current INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Options personnalisées par utilisateur (scripts, comptes, types)
    CREATE TABLE IF NOT EXISTS user_options (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_type TEXT NOT NULL,
      value TEXT NOT NULL,
      UNIQUE(user_id, option_type, value)
    );

    -- Assignation assistantes outreach → élèves
    CREATE TABLE IF NOT EXISTS student_outreach_assignments (
      id SERIAL PRIMARY KEY,
      student_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      outreach_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_user_id, outreach_user_id)
    );

    -- Paires d'élèves partageant le même outreach
    CREATE TABLE IF NOT EXISTS student_outreach_pairs (
      id SERIAL PRIMARY KEY,
      student_a_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_b_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(student_a_id, student_b_id)
    );

    DO $$ BEGIN
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS added_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE student_leads ADD COLUMN IF NOT EXISTS last_modified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS planning_shifts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shift_date DATE NOT NULL,
      shift_type TEXT DEFAULT 'custom',
      start_time TEXT,
      end_time TEXT,
      model_ids TEXT DEFAULT '[]',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Multi-agency support
    CREATE TABLE IF NOT EXISTS agencies (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      logo_url TEXT,
      primary_color TEXT DEFAULT '#8b5cf6',
      owner_id INTEGER,
      active BOOLEAN DEFAULT true,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'active',
      subscription_plan TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Invitation tokens for secure registration
    CREATE TABLE IF NOT EXISTS invitation_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      agency_id INTEGER,
      role TEXT DEFAULT 'super_admin',
      plan TEXT DEFAULT 'pro',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

  `);

  // Add agency_id columns individually (each in its own try/catch so one failure doesn't block others)
  const agencyTables = ['users', 'models', 'team_members', 'students', 'tasks', 'outreach_leads', 'chatter_shifts', 'settings', 'resources', 'planning_shifts', 'leave_requests', 'model_revenue_objectives', 'payments', 'weekly_objectives', 'activity_log'];
  for (const table of agencyTables) {
    try {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS agency_id INTEGER`);
    } catch(e) {}
  }

  // Add Stripe columns to agencies (migration for existing DBs)
  const stripeCols = ['stripe_customer_id TEXT', 'stripe_subscription_id TEXT', 'subscription_status TEXT DEFAULT \'active\'', 'subscription_plan TEXT'];
  for (const col of stripeCols) {
    try {
      await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS ${col}`);
    } catch(e) {}
  }

  // Onboarding columns — DEFAULT TRUE so existing agencies are NOT affected
  const onboardingCols = [
    "onboarding_completed BOOLEAN DEFAULT TRUE",
    "onboarding_completed_at TIMESTAMPTZ",
    "country TEXT",
    "timezone TEXT",
    "currency TEXT DEFAULT 'EUR'",
    "service_type TEXT",
    "models_count INTEGER",
    "chatters_count INTEGER",
    "target_markets TEXT[]",
    "founded_at TEXT",
    "contact_email TEXT",
    "phone TEXT",
    "legal_name TEXT",
    "address_street TEXT",
    "address_city TEXT",
    "address_zip TEXT",
    "address_country TEXT",
    "vat_number TEXT",
    "default_work_start TEXT DEFAULT '09:00'",
    "default_work_end TEXT DEFAULT '18:00'",
    "work_days TEXT[] DEFAULT '{lundi,mardi,mercredi,jeudi,vendredi}'",
    "language TEXT DEFAULT 'fr'",
    "email_notifications_enabled BOOLEAN DEFAULT TRUE"
  ];
  for (const col of onboardingCols) {
    try {
      await pool.query(`ALTER TABLE agencies ADD COLUMN IF NOT EXISTS ${col}`);
    } catch(e) {}
  }

  // Recruitment module tables
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recruitment_settings (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER REFERENCES agencies(id),
        enabled BOOLEAN DEFAULT false,
        coaching_price DECIMAL(10,2) DEFAULT 1500.00,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agency_id)
      );
      CREATE TABLE IF NOT EXISTS recruiters (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER,
        user_id INTEGER REFERENCES users(id),
        commission_percentage DECIMAL(5,2) DEFAULT 10.00,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS recruitment_leads (
        id SERIAL PRIMARY KEY,
        agency_id INTEGER,
        recruiter_id INTEGER REFERENCES recruiters(id) ON DELETE CASCADE,
        prospect_name VARCHAR(255),
        prospect_pseudo VARCHAR(255),
        platform VARCHAR(50) DEFAULT 'instagram',
        status VARCHAR(50) DEFAULT 'prospect_chaud',
        call_recruiter BOOLEAN DEFAULT false,
        call_owner BOOLEAN DEFAULT false,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Password reset tokens
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `).catch(function() {});

    // Add email column to users
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT').catch(function() {});

    // Auto-enable recruitment for all agencies
    await pool.query(`INSERT INTO recruitment_settings (agency_id, enabled, coaching_price)
      SELECT id, true, 1500 FROM agencies
      ON CONFLICT (agency_id) DO UPDATE SET enabled = true`).catch(function() {});

    // Index on users.email
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)').catch(function() {});

    // Migrate emails from invitation_tokens to users where missing
    try {
      const migrated = await pool.query(`
        UPDATE users u SET email = it.email
        FROM invitation_tokens it
        JOIN agencies a ON it.agency_id = a.id
        WHERE u.agency_id = a.id
          AND u.role = 'super_admin'
          AND u.email IS NULL
          AND it.used_at IS NOT NULL
          AND it.email IS NOT NULL
      `);
      if (migrated.rowCount > 0) console.log('[MIGRATION] Emails migrés depuis invitation_tokens:', migrated.rowCount);
    } catch(e) {}
  } catch(e) {}
}

// ============ SEED DEFAULT DATA ============
const LEGACY_PASSWORDS = ['admin123', 'team123', 'eleve123', 'password', '12345678'];

async function seedData() {
  const { rows } = await pool.query('SELECT COUNT(*) as count FROM users');
  if (parseInt(rows[0].count) > 0) {
    // Check for users with legacy default passwords
    try {
      const allUsers = (await pool.query('SELECT id, username, password FROM users')).rows;
      let warnCount = 0;
      for (const u of allUsers) {
        for (const legacyPwd of LEGACY_PASSWORDS) {
          if (bcrypt.compareSync(legacyPwd, u.password)) {
            console.warn('[SECURITY WARNING] User "' + u.username + '" (id:' + u.id + ') uses a default password — CHANGE IT IMMEDIATELY');
            warnCount++;
            break;
          }
        }
      }
      if (warnCount > 0) console.warn('[SECURITY WARNING] ' + warnCount + ' user(s) with default passwords detected');
    } catch(e) {}
    return;
  }

  // First boot — create initial admin with random password
  const adminPassword = crypto.randomBytes(12).toString('base64url').substring(0, 16);
  const adminHash = bcrypt.hashSync(adminPassword, 10);
  await pool.query('INSERT INTO users (username, password, display_name, role) VALUES ($1, $2, $3, $4)', ['admin', adminHash, 'Admin', 'admin']);

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ⚠️  COMPTE ADMIN INITIAL CRÉÉ                          ║');
  console.log('║                                                          ║');
  console.log('║  Username : admin                                        ║');
  console.log('║  Mot de passe : ' + adminPassword + '                              ║');
  console.log('║                                                          ║');
  console.log('║  CHANGEZ CE MOT DE PASSE IMMÉDIATEMENT APRÈS CONNEXION  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Agency settings
  const settingsData = [
    ['agency_name', 'Fuzion Pilot'],
    ['agency_subtitle', 'Fuzion Pilot'],
  ];
  for (const s of settingsData) {
    await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', s);
  }

  console.log('Seed complete — admin account created (no test accounts).');
}

async function migrateToMultiAgency() {
  try {
    // Ensure default agency exists
    const { rows: agencies } = await pool.query('SELECT id FROM agencies LIMIT 1');
    if (agencies.length === 0) {
      await pool.query("INSERT INTO agencies (id, name, primary_color) VALUES (1, 'Fuzion Pilot', '#8b5cf6')");
    }
    // ALWAYS fix orphaned data (idempotent) — assign all NULL agency_id rows to agency 1
    const tables = ['users', 'models', 'team_members', 'students', 'tasks', 'outreach_leads', 'chatter_shifts', 'resources', 'planning_shifts', 'leave_requests', 'model_revenue_objectives', 'payments', 'weekly_objectives', 'activity_log'];
    for (const table of tables) {
      await pool.query(`UPDATE ${table} SET agency_id = 1 WHERE agency_id IS NULL`);
    }
    await pool.query("UPDATE settings SET agency_id = 1 WHERE agency_id IS NULL");
    // Set owner if not set
    const { rows: ownerCheck } = await pool.query('SELECT owner_id FROM agencies WHERE id = 1');
    if (ownerCheck.length > 0 && !ownerCheck[0].owner_id) {
      const { rows: firstAdmin } = await pool.query("SELECT id FROM users WHERE role IN ('admin', 'super_admin') ORDER BY id LIMIT 1");
      if (firstAdmin.length > 0) {
        await pool.query('UPDATE agencies SET owner_id = $1 WHERE id = 1', [firstAdmin[0].id]);
      }
    }
    // Drop old settings PK if it exists (key was PK, now we need composite)
    const { rows: pkCheck } = await pool.query("SELECT 1 FROM pg_constraint WHERE conname = 'settings_pkey' AND conrelid = 'settings'::regclass");
    if (pkCheck.length > 0) {
      await pool.query('ALTER TABLE settings DROP CONSTRAINT settings_pkey');
      console.log('Dropped settings_pkey constraint');
    }
    // Promote platform admin from env var (PLATFORM_ADMIN_USER=ewen)
    const platformUser = process.env.PLATFORM_ADMIN_USER;
    if (platformUser) {
      const { rowCount } = await pool.query("UPDATE users SET role = 'platform_admin' WHERE LOWER(username) = LOWER($1) AND role != 'platform_admin'", [platformUser]);
      if (rowCount > 0) console.log('Promoted ' + platformUser + ' to platform_admin');
    }
    console.log('Multi-agency migration OK');
  } catch(e) {
    console.log('Migration note:', e.message);
  }
}

// ============ RATE LIMITERS ============
const sensitiveRL = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: 'Trop de requêtes, réessayez dans quelques minutes' } });
const passwordRL = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Trop de tentatives, réessayez dans 15 minutes' } });

// ============ AUTH MIDDLEWARE ============
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

// ============ WHATSAPP NOTIFICATIONS ============
async function sendWhatsAppToNumber(number, apiKey, message, provider) {
  number = number.replace(/[^0-9]/g, '');
  if (!number || !apiKey) return;
  if (provider === 'callmebot' || !provider) {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${number}&text=${encodeURIComponent(message)}&apikey=${apiKey}`;
    httpGet(url).catch(e => console.log('WhatsApp error:', e.message));
  }
}

async function sendWhatsApp(message, agencyId) {
  try {
    const aid = agencyId || 1;
    const { rows } = await pool.query("SELECT key, value FROM settings WHERE key IN ('whatsapp_number', 'whatsapp_api_key', 'whatsapp_provider', 'whatsapp_extra_recipients') AND (agency_id = $1 OR agency_id IS NULL) ORDER BY agency_id DESC NULLS LAST", [aid]);
    const settings = {};
    rows.forEach(r => { if (!settings[r.key]) settings[r.key] = r.value; });
    if (!settings.whatsapp_number || !settings.whatsapp_api_key) return;

    const provider = settings.whatsapp_provider || 'callmebot';
    // Send to primary number
    await sendWhatsAppToNumber(settings.whatsapp_number, settings.whatsapp_api_key, message, provider);
    // Send to extra recipients (format: number:apikey,number:apikey)
    if (settings.whatsapp_extra_recipients) {
      const extras = settings.whatsapp_extra_recipients.split(',').map(s => s.trim()).filter(Boolean);
      for (const entry of extras) {
        const [num, key] = entry.split(':').map(s => s.trim());
        if (num && key) {
          await new Promise(r => setTimeout(r, 2000)); // CallMeBot rate limit
          await sendWhatsAppToNumber(num, key, message, provider);
        }
      }
    }
  } catch(e) { console.log('WhatsApp send error:', e.message); }
}

async function getNotifSetting(key, agencyId) {
  const aid = agencyId || 1;
  const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1 AND (agency_id = $2 OR agency_id IS NULL) ORDER BY agency_id DESC NULLS LAST LIMIT 1", [key, aid]);
  return rows[0]?.value;
}

async function isNotifEnabled(key, agencyId) {
  const val = await getNotifSetting(key, agencyId);
  return val !== 'false';
}

// ============ REGISTRATION ============
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// Public registration disabled — use invitation tokens via Stripe checkout
app.post('/api/register', (req, res) => {
  return res.status(403).json({ error: 'L\'inscription publique est désactivée. Souscrivez un abonnement sur fuzionpilot.com pour recevoir votre lien d\'activation.' });
});

// ============ INVITATION-BASED REGISTRATION ============
app.post('/api/invite/register', rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' }
}), async (req, res) => {
  const { token, display_name, username, password } = req.body;
  if (!token || !display_name || !username || !password) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (min 8 caractères)' });

  // Verify token
  const { rows: tokenRows } = await pool.query('SELECT * FROM invitation_tokens WHERE token = $1', [token]);
  if (tokenRows.length === 0) return res.status(400).json({ error: 'Lien d\'invitation invalide.' });
  const invite = tokenRows[0];
  if (invite.used_at) return res.status(400).json({ error: 'Ce lien a déjà été utilisé.' });
  if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Ce lien a expiré. Contactez contact@fuzionpilot.com pour en obtenir un nouveau.' });

  // Check username uniqueness
  const exists = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (exists.rows.length > 0) return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });

  try {
    // Create agency — onboarding_completed = FALSE so new clients must complete onboarding
    const agencyName = display_name.trim() + ' Agency';
    const { rows: agencyRows } = await pool.query(
      'INSERT INTO agencies (name, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, onboarding_completed) VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING id',
      [agencyName, invite.stripe_customer_id, invite.stripe_subscription_id, 'active', invite.plan]
    );
    const agencyId = agencyRows[0].id;

    // Create owner user (with email from invitation token)
    const hash = bcrypt.hashSync(password, 10);
    const { rows: userRows } = await pool.query(
      'INSERT INTO users (username, password, display_name, role, agency_id, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [username.trim(), hash, display_name.trim(), 'super_admin', agencyId, invite.email || null]
    );
    const userId = userRows[0].id;

    // Update agency owner + token
    await pool.query('UPDATE agencies SET owner_id = $1 WHERE id = $2', [userId, agencyId]);
    await pool.query('UPDATE invitation_tokens SET used_at = NOW(), agency_id = $1 WHERE id = $2', [agencyId, invite.id]);

    // Create default settings
    const defaultSettings = [
      ['agency_name', agencyName],
      ['agency_subtitle', 'Fuzion Pilot'],
      ['agency_logo', 'FP']
    ];
    for (const [key, value] of defaultSettings) {
      await pool.query('INSERT INTO settings (key, value, agency_id) VALUES ($1, $2, $3)', [key, value, agencyId]);
    }

    // Auto-login
    const jwtToken = jwt.sign({ id: userId, username: username.trim(), display_name: display_name.trim(), role: 'super_admin', agency_id: agencyId }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', jwtToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, token: jwtToken });
  } catch(e) {
    console.error('Invite registration error:', e);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

// Legacy register route — kept for old form compatibility (now just redirects to invite flow)
app.post('/api/register-legacy-disabled', rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' }
}), async (req, res) => {
  const { agency_name, display_name, username, password } = req.body;
  if (!agency_name || !display_name || !username || !password) {
    return res.status(400).json({ error: 'Tous les champs sont requis' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (min 8 caractères)' });

  // Check username uniqueness
  const exists = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  if (exists.rows.length > 0) return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });

  try {
    // Create agency
    const { rows: agencyRows } = await pool.query(
      'INSERT INTO agencies (name) VALUES ($1) RETURNING id',
      [agency_name.trim()]
    );
    const agencyId = agencyRows[0].id;

    // Create owner user
    const hash = bcrypt.hashSync(password, 10);
    const { rows: userRows } = await pool.query(
      'INSERT INTO users (username, password, display_name, role, agency_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username.trim(), hash, display_name.trim(), 'super_admin', agencyId]
    );
    const userId = userRows[0].id;

    // Update agency owner
    await pool.query('UPDATE agencies SET owner_id = $1 WHERE id = $2', [userId, agencyId]);

    // Create default settings for this agency
    const defaultSettings = [
      ['agency_name', agency_name.trim()],
      ['agency_subtitle', 'Fuzion Pilot'],
      ['agency_logo', 'FP']
    ];
    for (const [key, value] of defaultSettings) {
      await pool.query('INSERT INTO settings (key, value, agency_id) VALUES ($1, $2, $3)', [key, value, agencyId]);
    }

    // Auto-login
    const token = jwt.sign({ id: userId, username: username.trim(), display_name: display_name.trim(), role: 'super_admin', agency_id: agencyId }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, token });
  } catch(e) {
    console.error('Registration error:', e);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// ============ AUTH ROUTES ============
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  // Auto-créer l'entrée student si elle manque
  if (user.role === 'student') {
    const studentExists = await pool.query('SELECT id FROM students WHERE user_id = $1', [user.id]);
    if (studentExists.rows.length === 0) {
      await pool.query('INSERT INTO students (user_id, name, program, start_date, status) VALUES ($1, $2, $3, $4, $5)', [user.id, user.display_name, 'starter', new Date().toISOString().split('T')[0], 'active']);
    }
  }
  const token = jwt.sign({ id: user.id, username: user.username, display_name: user.display_name, role: user.role, agency_id: user.agency_id || 1 }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, agency_id: user.agency_id } });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ============ PASSWORD RESET ============
const forgotPasswordRL = rateLimit({ windowMs: 60 * 60 * 1000, max: 3, keyGenerator: (req) => req.body.username || req.ip, message: { error: 'Trop de demandes, réessayez dans 1 heure' } });

app.post('/api/forgot-password', forgotPasswordRL, async (req, res) => {
  const { username } = req.body;
  // Always return success to prevent user enumeration
  if (!username) return res.json({ ok: true, message: 'Si ce compte existe, un email a été envoyé.' });

  try {
    // Search by username OR email
    const input = username.trim();
    const user = (await pool.query('SELECT id, email, display_name, agency_id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)', [input])).rows[0];
    if (!user || !user.email) {
      // Try to get email from agency contact_email
      let email = null;
      if (user && user.agency_id) {
        const agency = (await pool.query('SELECT contact_email FROM agencies WHERE id = $1', [user.agency_id])).rows[0];
        email = agency?.contact_email;
      }
      if (!email) return res.json({ ok: true, message: 'Si ce compte existe, un email a été envoyé.' });
      // Use agency email as fallback
      user.email = email;
    }

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate previous tokens for this user
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);

    // Store hashed token
    await pool.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [user.id, tokenHash, expiresAt]);

    // Send email
    const resetLink = APP_URL + '/reset-password.html?token=' + rawToken;
    await sendEmail(user.email, 'Réinitialisation de votre mot de passe — Fuzion Pilot', `
      <div style="max-width:500px;margin:0 auto;font-family:sans-serif;background:#0A0615;color:#EDE4FF;padding:40px;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="display:inline-block;width:56px;height:56px;background:linear-gradient(135deg,#7c3aed,#22d3ee);border-radius:16px;line-height:56px;font-size:20px;font-weight:800;color:white;text-align:center;font-family:sans-serif;">FP</div>
        </div>
        <h2 style="text-align:center;font-size:20px;margin-bottom:16px;">Réinitialisation de mot de passe</h2>
        <p style="color:#9585B0;font-size:14px;line-height:1.6;">Bonjour ${user.display_name || username},</p>
        <p style="color:#9585B0;font-size:14px;line-height:1.6;">Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau :</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${resetLink}" style="display:inline-block;background:linear-gradient(135deg,#A855F7,#7C3AED);color:white;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;">Réinitialiser mon mot de passe</a>
        </div>
        <p style="color:#6B5A84;font-size:12px;line-height:1.5;">Ce lien expire dans <strong>1 heure</strong>.</p>
        <p style="color:#6B5A84;font-size:12px;line-height:1.5;">Si vous n'avez pas demandé ce changement, ignorez simplement cet email. Votre mot de passe ne sera pas modifié.</p>
        <hr style="border:none;border-top:1px solid #1C1333;margin:24px 0;">
        <p style="color:#6B5A84;font-size:11px;text-align:center;">Fuzion Pilot — contact@fuzionpilot.com</p>
      </div>
    `);
    console.log('[PASSWORD RESET] Email envoyé à', user.email.substring(0, 3) + '***');
  } catch(e) {
    console.error('[PASSWORD RESET] Erreur:', e.message);
  }

  res.json({ ok: true, message: 'Si ce compte existe, un email a été envoyé.' });
});

app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ error: 'Token et mot de passe requis' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Le mot de passe doit faire au moins 8 caractères' });

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = (await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()',
      [tokenHash]
    )).rows[0];

    if (!result) return res.status(400).json({ error: 'Lien invalide ou expiré. Demandez un nouveau lien.' });

    // Hash new password
    const hash = bcrypt.hashSync(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hash, result.user_id]);

    // Invalidate all tokens for this user
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [result.user_id]);

    // Clear auth cookie so user must re-login with new password
    res.clearCookie('token');

    console.log('[PASSWORD RESET] Mot de passe réinitialisé pour user_id:', result.user_id);
    res.json({ ok: true });
  } catch(e) {
    console.error('[PASSWORD RESET] Erreur reset:', e.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/api/me/email', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
  res.json({ email: rows[0]?.email || '' });
});

app.put('/api/me/email', authMiddleware, async (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });
  const exists = (await pool.query('SELECT id FROM users WHERE email = $1 AND agency_id = $2 AND id != $3', [email.trim(), req.user.agency_id, req.user.id])).rows[0];
  if (exists) return res.status(409).json({ error: 'Email déjà utilisé par un autre membre' });
  await pool.query('UPDATE users SET email = $1 WHERE id = $2', [email.trim(), req.user.id]);
  res.json({ ok: true });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT u.id, u.username, u.display_name, u.role, u.avatar_url, u.agency_id, a.name as agency_name, a.primary_color as agency_color, a.logo_url as agency_logo, a.onboarding_completed, a.language FROM users u LEFT JOIN agencies a ON u.agency_id = a.id WHERE u.id = $1', [req.user.id]);
  res.json(rows[0]);
});

app.patch('/api/agency/language', authMiddleware, async (req, res) => {
  const { language } = req.body;
  if (language !== 'fr' && language !== 'en') return res.status(400).json({ error: 'Language must be fr or en' });
  try {
    await pool.query('UPDATE agencies SET language = $1 WHERE id = $2', [language, req.user.agency_id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ USERS CRUD (Admin only) ============
app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, role, avatar_url, read_only, expires_at, agency_id, email, created_at FROM users WHERE (agency_id = $1 OR agency_id IS NULL) ORDER BY role, display_name', [req.user.agency_id]);
  res.json(rows);
});

app.post('/api/users', authMiddleware, adminOnly, sensitiveRL, async (req, res) => {
  const { username, password, display_name, role } = req.body;
  if (!username || !password || !display_name || !role) return res.status(400).json({ error: 'Champs requis manquants' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const { rows } = await pool.query('INSERT INTO users (username, password, display_name, role, agency_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [username, hash, display_name, role, req.user.agency_id]);
    const newId = rows[0].id;
    // Auto-créer l'entrée student si rôle élève
    if (role === 'student') {
      await pool.query('INSERT INTO students (user_id, name, program, start_date, status, agency_id) VALUES ($1, $2, $3, $4, $5, $6)', [newId, display_name, 'starter', new Date().toISOString().split('T')[0], 'active', req.user.agency_id]);
    }
    // Auto-créer l'entrée team_member si rôle team
    if (['chatter', 'outreach', 'va'].includes(role)) {
      await pool.query('INSERT INTO team_members (user_id, name, role, status, agency_id) VALUES ($1, $2, $3, $4, $5)', [newId, display_name, role, 'offline', req.user.agency_id]);
    }
    // Send email to new team member if email-like username or if agency has email
    const agencyInfo = (await pool.query('SELECT name FROM agencies WHERE id = $1', [req.user.agency_id])).rows[0];
    const agencyName = agencyInfo?.name || 'Votre agence';
    if (username.includes('@')) {
      sendEmail(username, `Votre accès Fuzion Pilot — ${agencyName}`, `
        <div style="background:#09090b;color:#f0f0f5;font-family:'Inter',Arial,sans-serif;padding:0;margin:0;">
          <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
            <div style="text-align:center;margin-bottom:32px;">
              <div style="display:inline-block;width:56px;height:56px;background:linear-gradient(135deg,#7c3aed,#22d3ee);border-radius:16px;line-height:56px;font-size:20px;font-weight:800;color:white;text-align:center;font-family:sans-serif;">FP</div>
              <h1 style="font-size:24px;font-weight:800;margin:16px 0 0;color:#ffffff;">Fuzion Pilot</h1>
            </div>
            <div style="background:#111114;border:1px solid rgba(124,58,237,0.2);border-radius:16px;padding:32px;">
              <h2 style="font-size:18px;margin:0 0 16px;color:#ffffff;text-align:center;">Bienvenue dans l'équipe ! 🎉</h2>
              <p style="color:#a0a0c0;font-size:14px;line-height:1.6;margin:0 0 20px;text-align:center;">Votre compte a été créé sur <strong style="color:#fff;">${agencyName}</strong>.</p>
              <div style="background:#0a0a1a;border-radius:10px;padding:20px;margin-bottom:20px;">
                <p style="margin:0 0 8px;color:#a0a0c0;font-size:14px;"><strong style="color:#fff;">Identifiant :</strong> ${username}</p>
                <p style="margin:0 0 8px;color:#a0a0c0;font-size:14px;"><strong style="color:#fff;">Mot de passe :</strong> ${password}</p>
                <p style="margin:0;color:#a0a0c0;font-size:14px;"><strong style="color:#fff;">Rôle :</strong> ${role}</p>
              </div>
              <div style="text-align:center;">
                <a href="${APP_URL}" style="display:inline-block;background:linear-gradient(135deg,#7c3aed,#06d6a0);color:white;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;text-decoration:none;">Se connecter</a>
              </div>
              <p style="color:#5a5a7a;font-size:12px;text-align:center;margin-top:16px;">Changez votre mot de passe dès votre première connexion.</p>
            </div>
            <p style="color:#5a5a7a;font-size:12px;text-align:center;margin-top:24px;">© 2026 Fuzion Pilot</p>
          </div>
        </div>
      `);
    }

    res.json({ id: newId, username, display_name, role });
  } catch (e) {
    res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
  }
});

app.put('/api/users/:id/password', authMiddleware, adminOnly, passwordRL, async (req, res) => {
  const { password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2 AND agency_id = $3', [hash, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.delete('/api/users/:id', authMiddleware, adminOnly, sensitiveRL, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
  await pool.query('DELETE FROM users WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ STUDENTS CRUD ============
app.get('/api/students', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM students WHERE user_id = $1', [req.user.id]);
    return res.json(rows);
  }
  const { rows } = await pool.query('SELECT s.*, u.username FROM students s LEFT JOIN users u ON s.user_id = u.id WHERE (s.agency_id = $1 OR s.agency_id IS NULL) ORDER BY s.name', [req.user.agency_id]);
  res.json(rows);
});

app.post('/api/students', authMiddleware, adminOnly, async (req, res) => {
  const { name, program, start_date, contact, user_id } = req.body;
  const { rows } = await pool.query('INSERT INTO students (user_id, name, program, start_date, contact, agency_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [user_id || null, name, program || 'starter', start_date, contact, req.user.agency_id]);
  res.json({ id: rows[0].id });
});

app.put('/api/students/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, program, models_signed, active_discussions, progression, contact, status, drive_folder } = req.body;
  await pool.query(`UPDATE students SET
    name = COALESCE($1, name), program = COALESCE($2, program), models_signed = COALESCE($3, models_signed),
    active_discussions = COALESCE($4, active_discussions), progression = COALESCE($5, progression),
    contact = COALESCE($6, contact), status = COALESCE($7, status), drive_folder = COALESCE($8, drive_folder) WHERE id = $9 AND agency_id = $10`,
    [name, program, models_signed, active_discussions, progression, contact, status, drive_folder, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.delete('/api/students/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM students WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ TEAM MEMBERS CRUD ============
app.get('/api/team', authMiddleware, async (req, res) => {
  const role = req.query.role;
  let query = `SELECT tm.*, u.avatar_url FROM team_members tm LEFT JOIN users u ON tm.user_id = u.id WHERE (tm.agency_id = $1 OR tm.agency_id IS NULL)`;
  if (role) {
    query += ` AND tm.role = $2 ORDER BY tm.name`;
    const { rows } = await pool.query(query, [req.user.agency_id, role]);
    res.json(rows);
  } else {
    query += ` ORDER BY tm.name`;
    const { rows } = await pool.query(query, [req.user.agency_id]);
    res.json(rows);
  }
});

app.post('/api/team', authMiddleware, adminOnly, async (req, res) => {
  const { name, role, shift, models_assigned, platform, contact, user_id } = req.body;
  const { rows } = await pool.query('INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact, agency_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [user_id || null, name, role, shift, JSON.stringify(models_assigned || []), platform, contact, req.user.agency_id]);
  res.json({ id: rows[0].id });
});

app.put('/api/team/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, role, shift, models_assigned, platform, contact, status } = req.body;
  await pool.query(`UPDATE team_members SET
    name = COALESCE($1, name), role = COALESCE($2, role), shift = COALESCE($3, shift),
    models_assigned = COALESCE($4, models_assigned), platform = COALESCE($5, platform),
    contact = COALESCE($6, contact), status = COALESCE($7, status) WHERE id = $8 AND agency_id = $9`,
    [name, role, shift, models_assigned ? JSON.stringify(models_assigned) : null, platform, contact, status, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.delete('/api/team/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM team_members WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ MODELS CRUD ============
app.get('/api/models', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM models WHERE (agency_id = $1 OR agency_id IS NULL) ORDER BY name', [req.user.agency_id]);
  res.json(rows.map(m => ({ ...m, platforms: JSON.parse(m.platforms || '[]') })));
});

app.post('/api/models', authMiddleware, adminOnly, async (req, res) => {
  const { name, platforms, status } = req.body;
  const { rows } = await pool.query('INSERT INTO models (name, platforms, status, agency_id) VALUES ($1, $2, $3, $4) RETURNING id', [name, JSON.stringify(platforms || []), status || 'active', req.user.agency_id]);
  res.json({ id: rows[0].id });
});

app.delete('/api/models/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM models WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ ACCOUNTS CRUD ============
app.get('/api/accounts', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*, m.name as model_name FROM accounts a
    JOIN models m ON a.model_id = m.id WHERE (m.agency_id = $1 OR m.agency_id IS NULL) ORDER BY m.name, a.platform
  `, [req.user.agency_id]);
  res.json(rows);
});

app.post('/api/accounts', authMiddleware, adminOnly, async (req, res) => {
  const { model_id, platform, handle, current_followers } = req.body;
  const { rows } = await pool.query('INSERT INTO accounts (model_id, platform, handle, current_followers) VALUES ($1, $2, $3, $4) RETURNING id', [model_id, platform, handle, current_followers || 0]);
  res.json({ id: rows[0].id });
});

app.delete('/api/accounts/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM accounts WHERE id = $1 AND id IN (SELECT a.id FROM accounts a JOIN models m ON a.model_id = m.id WHERE m.agency_id = $2)', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ DAILY STATS ============
app.get('/api/stats', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const { rows } = await pool.query(`
    SELECT ds.*, a.handle, a.platform, a.current_followers, m.name as model_name
    FROM daily_stats ds
    JOIN accounts a ON ds.account_id = a.id
    JOIN models m ON a.model_id = m.id
    WHERE ds.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text AND (m.agency_id = $2 OR m.agency_id IS NULL)
    ORDER BY ds.date DESC, m.name, a.platform
  `, [days, req.user.agency_id]);
  res.json(rows);
});

app.post('/api/stats', authMiddleware, adminOnly, async (req, res) => {
  const { account_id, date, new_followers } = req.body;
  const dateStr = date || new Date().toISOString().split('T')[0];
  await pool.query(`INSERT INTO daily_stats (account_id, date, new_followers) VALUES ($1, $2, $3)
    ON CONFLICT (account_id, date) DO UPDATE SET new_followers = $3`, [account_id, dateStr, new_followers]);
  await pool.query('UPDATE accounts SET current_followers = current_followers + $1 WHERE id = $2', [new_followers, account_id]);
  res.json({ ok: true });
});

// ============ TASKS CRUD ============
app.get('/api/tasks', authMiddleware, async (req, res) => {
  let query, params = [];
  const filterUserId = req.query.student_user_id || req.query.user_id;
  const aid = req.user.agency_id;
  const orderBy = `ORDER BY CASE t.priority WHEN 'urgent' THEN 0 ELSE 1 END, CASE t.status WHEN 'pending' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, t.deadline ASC NULLS LAST`;
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    if (filterUserId) {
      query = `SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
        FROM tasks t LEFT JOIN users u ON t.assigned_to_id = u.id LEFT JOIN users c ON t.created_by = c.id
        WHERE (t.assigned_to_id = $1 OR t.created_by = $1) AND (t.agency_id = $2 OR t.agency_id IS NULL) ${orderBy}`;
      params = [filterUserId, aid];
    } else {
      query = `SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
        FROM tasks t LEFT JOIN users u ON t.assigned_to_id = u.id LEFT JOIN users c ON t.created_by = c.id
        WHERE (t.agency_id = $1 OR t.agency_id IS NULL) ${orderBy}`;
      params = [aid];
    }
  } else if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    query = `SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
      FROM tasks t LEFT JOIN users u ON t.assigned_to_id = u.id LEFT JOIN users c ON t.created_by = c.id
      WHERE (t.assigned_to_id = ANY($1) OR t.created_by = ANY($1)) AND (t.agency_id = $2 OR t.agency_id IS NULL) ${orderBy}`;
    params = [sharedIds, aid];
  } else {
    query = `SELECT t.*, u.display_name as assigned_name, c.display_name as creator_name
      FROM tasks t LEFT JOIN users u ON t.assigned_to_id = u.id LEFT JOIN users c ON t.created_by = c.id
      WHERE (t.assigned_to_id = $1 OR t.created_by = $1) AND (t.agency_id = $2 OR t.agency_id IS NULL) ${orderBy}`;
    params = [req.user.id, aid];
  }
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
  const { title, description, assigned_to_id, priority, deadline, notes } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  // Non-admin ne peut assigner qu'à soi-même
  const assignTo = (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') ? (assigned_to_id || req.user.id) : req.user.id;
  const { rows } = await pool.query(
    'INSERT INTO tasks (title, description, created_by, assigned_to_id, priority, deadline, notes, agency_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [title, description, req.user.id, assignTo, priority || 'normal', deadline, notes, req.user.agency_id]);
  broadcast('task-new', rows[0]);
  res.json(rows[0]);
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
  const { status, title, description, priority, deadline, assigned_to_id, notes } = req.body;
  // Non-admin ne peut modifier que ses propres tâches
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') {
    const check = await pool.query('SELECT id FROM tasks WHERE id = $1 AND (assigned_to_id = $2 OR created_by = $2)', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query(`UPDATE tasks SET status = COALESCE($1, status), title = COALESCE($2, title),
    description = COALESCE($3, description), priority = COALESCE($4, priority),
    deadline = COALESCE($5, deadline), assigned_to_id = COALESCE($6, assigned_to_id),
    notes = COALESCE($7, notes) WHERE id = $8 AND agency_id = $9`,
    [status, title, description, priority, deadline, assigned_to_id, notes, req.params.id, req.user.agency_id]);
  broadcast('task-updated', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') {
    const check = await pool.query('SELECT id FROM tasks WHERE id = $1 AND created_by = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query('DELETE FROM tasks WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  broadcast('task-deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ============ CALLS CRUD ============
app.get('/api/calls', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT c.*, s.name as student_name FROM calls c
    JOIN students s ON c.student_id = s.id
    ORDER BY c.scheduled_at ASC
  `);
  res.json(rows);
});

app.post('/api/calls', authMiddleware, adminOnly, async (req, res) => {
  const { student_id, type, scheduled_at, notes } = req.body;
  const { rows } = await pool.query('INSERT INTO calls (student_id, type, scheduled_at, notes) VALUES ($1, $2, $3, $4) RETURNING id', [student_id, type, scheduled_at, notes]);
  res.json({ id: rows[0].id });
});

app.delete('/api/calls/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM calls WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ DASHBOARD STATS ============
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  const aid = req.user.agency_id;
  const totalFollowers = (await pool.query('SELECT COALESCE(SUM(a.current_followers), 0) as total FROM accounts a JOIN models m ON a.model_id = m.id WHERE (m.agency_id = $1 OR m.agency_id IS NULL)', [aid])).rows[0].total;
  const modelsCount = (await pool.query("SELECT COUNT(*) as count FROM models m WHERE m.status = 'active' AND (m.agency_id = $1 OR m.agency_id IS NULL)", [aid])).rows[0].count;
  const teamCount = (await pool.query('SELECT COUNT(*) as count FROM team_members WHERE (agency_id = $1 OR agency_id IS NULL)', [aid])).rows[0].count;
  const studentsCount = (await pool.query("SELECT COUNT(*) as count FROM students WHERE status = 'active' AND (agency_id = $1 OR agency_id IS NULL)", [aid])).rows[0].count;
  const todayStats = (await pool.query("SELECT COALESCE(SUM(ds.new_followers), 0) as today FROM daily_stats ds JOIN accounts a ON ds.account_id = a.id JOIN models m ON a.model_id = m.id WHERE ds.date = CURRENT_DATE::text AND (m.agency_id = $1 OR m.agency_id IS NULL)", [aid])).rows[0].today;
  const weekStats = (await pool.query("SELECT COALESCE(SUM(ds.new_followers), 0) as week FROM daily_stats ds JOIN accounts a ON ds.account_id = a.id JOIN models m ON a.model_id = m.id WHERE ds.date >= (CURRENT_DATE - INTERVAL '7 days')::date::text AND (m.agency_id = $1 OR m.agency_id IS NULL)", [aid])).rows[0].week;

  res.json({
    totalFollowers: parseInt(totalFollowers),
    modelsCount: parseInt(modelsCount),
    teamCount: parseInt(teamCount),
    studentsCount: parseInt(studentsCount),
    todayStats: parseInt(todayStats),
    weekStats: parseInt(weekStats)
  });
});

// ============ ADMIN SETTINGS ============
app.get('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM settings WHERE agency_id = $1 OR agency_id IS NULL', [req.user.agency_id]);
  const settings = {};
  rows.forEach(r => settings[r.key] = r.value);
  res.json(settings);
});

app.put('/api/settings', authMiddleware, adminOnly, async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    // Try to update existing setting for this agency first
    const existing = await pool.query('SELECT key FROM settings WHERE key = $1 AND agency_id = $2', [key, req.user.agency_id]);
    if (existing.rows.length > 0) {
      await pool.query('UPDATE settings SET value = $1 WHERE key = $2 AND agency_id = $3', [String(value), key, req.user.agency_id]);
    } else {
      await pool.query('INSERT INTO settings (key, value, agency_id) VALUES ($1, $2, $3)', [key, String(value), req.user.agency_id]);
    }
  }
  res.json({ ok: true });
});

app.put('/api/users/:id/role', authMiddleware, adminOnly, async (req, res) => {
  const { role } = req.body;
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Tu ne peux pas changer ton propre rôle' });
  await pool.query('UPDATE users SET role = $1 WHERE id = $2 AND agency_id = $3', [role, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.put('/api/users/:id/display_name', authMiddleware, adminOnly, async (req, res) => {
  const { display_name } = req.body;
  await pool.query('UPDATE users SET display_name = $1 WHERE id = $2 AND agency_id = $3', [display_name, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.put('/api/users/:id/email', authMiddleware, adminOnly, async (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });
  // Check uniqueness within agency
  const exists = (await pool.query('SELECT id FROM users WHERE email = $1 AND agency_id = $2 AND id != $3', [email, req.user.agency_id, req.params.id])).rows[0];
  if (exists) return res.status(409).json({ error: 'Email déjà utilisé par un autre membre' });
  await pool.query('UPDATE users SET email = $1 WHERE id = $2 AND agency_id = $3', [email, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.put('/api/users/:id/avatar', authMiddleware, adminOnly, async (req, res) => {
  const { avatar_url } = req.body;
  await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2 AND agency_id = $3', [avatar_url, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.delete('/api/users/:id/avatar', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('UPDATE users SET avatar_url = NULL WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.put('/api/models/:id', authMiddleware, adminOnly, async (req, res) => {
  const { name, platforms, status, drive_folder, drive_contract, lifecycle_status } = req.body;
  await pool.query(`UPDATE models SET
    name = COALESCE($1, name), platforms = COALESCE($2, platforms), status = COALESCE($3, status),
    drive_folder = COALESCE($4, drive_folder), drive_contract = COALESCE($5, drive_contract),
    lifecycle_status = COALESCE($7, lifecycle_status) WHERE id = $6 AND agency_id = $8`,
    [name, platforms ? JSON.stringify(platforms) : null, status, drive_folder, drive_contract, req.params.id, lifecycle_status, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ MODEL CONTENT PLANNING ============
app.get('/api/models/:id/planning', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM model_content_planning WHERE model_id = $1 ORDER BY created_at DESC', [req.params.id]);
  res.json(rows);
});

app.post('/api/models/:id/planning', authMiddleware, adminOnly, async (req, res) => {
  const { label, drive_link } = req.body;
  if (!label || !drive_link) return res.status(400).json({ error: 'Label et lien requis' });
  const { rows } = await pool.query('INSERT INTO model_content_planning (model_id, label, drive_link) VALUES ($1, $2, $3) RETURNING *', [req.params.id, label, drive_link]);
  res.json(rows[0]);
});

app.delete('/api/model-planning/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM model_content_planning WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.put('/api/accounts/:id', authMiddleware, adminOnly, async (req, res) => {
  const { handle, current_followers } = req.body;
  if (current_followers !== undefined) {
    await pool.query(`UPDATE accounts SET previous_followers = current_followers, current_followers = $1, handle = COALESCE($2, handle) WHERE id = $3 AND id IN (SELECT a.id FROM accounts a JOIN models m ON a.model_id = m.id WHERE m.agency_id = $4)`,
      [current_followers, handle, req.params.id, req.user.agency_id]);
  } else {
    await pool.query(`UPDATE accounts SET handle = COALESCE($1, handle) WHERE id = $2 AND id IN (SELECT a.id FROM accounts a JOIN models m ON a.model_id = m.id WHERE m.agency_id = $3)`,
      [handle, req.params.id, req.user.agency_id]);
  }
  res.json({ ok: true });
});

// Reset all passwords for a role
app.post('/api/admin/reset-passwords', authMiddleware, adminOnly, async (req, res) => {
  const { role, new_password } = req.body;
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (min 8 caractères)' });
  const hash = bcrypt.hashSync(new_password, 10);
  const result = await pool.query('UPDATE users SET password = $1 WHERE role = $2 AND id != $3', [hash, role, req.user.id]);
  res.json({ ok: true, updated: result.rowCount });
});

// Import CSV leads
app.post('/api/admin/import-csv', authMiddleware, adminOnly, async (req, res) => {
  try {
    // Créer Gaby si elle n'existe pas
    let gaby = (await pool.query("SELECT id FROM users WHERE username = 'gaby'")).rows[0];
    if (!gaby) {
      const gabyPwd = crypto.randomBytes(12).toString('base64url').substring(0, 16);
      const hash = bcrypt.hashSync(gabyPwd, 10);
      console.log('[IMPORT CSV] User "gaby" créé avec mdp:', gabyPwd);
      gaby = (await pool.query(
        "INSERT INTO users (username, password, display_name, role) VALUES ('gaby', $1, 'Gaby', 'outreach') RETURNING id", [hash]
      )).rows[0];
      // Créer aussi comme team member
      await pool.query(
        "INSERT INTO team_members (user_id, name, role, shift, models_assigned, platform, contact, status) VALUES ($1, 'Gaby', 'outreach', '09h-17h', '[]', 'Instagram', null, 'online')",
        [gaby.id]
      );
    }

    // Lire le CSV
    const csvPath = path.join(__dirname, 'public', 'data.csv');
    if (!fs.existsSync(csvPath)) return res.status(404).json({ error: 'Fichier data.csv introuvable' });

    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    // Mapping des statuts CSV → app
    const statusMap = {
      'sent': 'sent',
      'to send': 'to-send',
      'talking - cold': 'talking-cold',
      'talking - warm': 'talking-warm',
      'call booked': 'call-booked',
      'signed': 'signed'
    };

    // Colonnes: Username, link, Type, Status, Script, Account, Notes, (vides...), reply rate, %
    // Le lien IG peut contenir "==" donc on parse intelligemment les 7 premières colonnes
    let imported = 0;
    let updated = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Extraire username (avant la première virgule)
      const firstComma = line.indexOf(',');
      if (firstComma === -1) continue;
      const username = line.substring(0, firstComma).replace(/"/g, '').trim();
      if (!username) continue;

      // Extraire le lien (entre première et deuxième virgule — peut contenir ==)
      const afterUsername = line.substring(firstComma + 1);
      // Le lien finit avant ",Type" — chercher le pattern après le lien IG
      const linkMatch = afterUsername.match(/^(https?:\/\/[^,]*(?:={0,2})),(.*)/);
      let igLink = '', rest = afterUsername;
      if (linkMatch) {
        igLink = linkMatch[1].replace(/"/g, '').trim();
        rest = linkMatch[2];
      } else {
        // Pas de lien, tout est dans rest
        rest = afterUsername;
      }

      // Parser le reste : Type, Status, Script, Account, Notes
      const restCols = rest.split(',');
      const leadType = (restCols[0] || '').replace(/"/g, '').trim().toLowerCase() || 'model';
      const rawStatus = (restCols[1] || '').replace(/"/g, '').trim().toLowerCase();
      const script = (restCols[2] || '').replace(/"/g, '').trim();
      const account = (restCols[3] || '').replace(/"/g, '').trim();
      const notes = (restCols[4] || '').replace(/"/g, '').trim();

      const status = statusMap[rawStatus] || 'sent';

      // Vérifier si le lead existe déjà
      const exists = await pool.query(
        'SELECT id FROM outreach_leads WHERE username = $1 AND user_id = $2', [username, gaby.id]
      );

      if (exists.rows.length > 0) {
        // Mettre à jour le lead existant avec les bonnes données
        await pool.query(
          `UPDATE outreach_leads SET ig_link = $1, lead_type = $2, status = $3, script_used = $4, ig_account_used = $5, notes = $6, updated_at = NOW() WHERE id = $7`,
          [igLink, leadType, status, script, account, notes, exists.rows[0].id]
        );
        updated++;
      } else {
        await pool.query(
          'INSERT INTO outreach_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [gaby.id, username, igLink, leadType, script, account, notes, status]
        );
        imported++;
      }
    }

    broadcast('lead-added', { bulk: true });
    res.json({ ok: true, imported, updated, total: lines.length - 1, user: 'Gaby' });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Erreur lors de l\'import' });
  }
});

// ============ CHATTER SHIFTS ============

// Get shifts — chatter voit ses propres shifts, admin voit tout
app.get('/api/shifts', authMiddleware, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  if (req.user.role === 'chatter') {
    const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM chatter_shifts WHERE user_id = $1 AND (agency_id = $2 OR agency_id IS NULL)', [req.user.id, req.user.agency_id]);
    const total = parseInt(countRows[0].total);
    const { rows } = await pool.query('SELECT * FROM chatter_shifts WHERE user_id = $1 AND (agency_id = $2 OR agency_id IS NULL) ORDER BY date DESC, created_at DESC LIMIT $3 OFFSET $4', [req.user.id, req.user.agency_id, limit, offset]);
    return res.json({ data: rows, page, limit, total, totalPages: Math.ceil(total / limit) });
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin' || req.user.role === 'platform_admin') {
    const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM chatter_shifts WHERE (agency_id = $1 OR agency_id IS NULL)', [req.user.agency_id]);
    const total = parseInt(countRows[0].total);
    const { rows } = await pool.query(`
      SELECT cs.*, u.display_name as chatter_name
      FROM chatter_shifts cs
      JOIN users u ON cs.user_id = u.id
      WHERE (cs.agency_id = $3 OR cs.agency_id IS NULL)
      ORDER BY cs.date DESC, cs.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset, req.user.agency_id]);
    return res.json({ data: rows, page, limit, total, totalPages: Math.ceil(total / limit) });
  }
  res.status(403).json({ error: 'Accès refusé' });
});

// Add shift report
app.post('/api/shifts', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chatter' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { date, model_name, ppv_total, tips_total, shift_notes } = req.body;
  if (!model_name) return res.status(400).json({ error: 'Modèle requis' });
  const shiftDate = date || new Date().toISOString().split('T')[0];
  const { rows } = await pool.query(
    'INSERT INTO chatter_shifts (user_id, date, model_name, ppv_total, tips_total, shift_notes, agency_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
    [req.user.id, shiftDate, model_name, ppv_total || 0, tips_total || 0, shift_notes, req.user.agency_id]
  );
  broadcast('shift-added', rows[0]);
  // Check revenue objective alert
  checkRevenueObjectiveAlert(model_name, shiftDate).catch(e => console.log('Revenue alert error:', e.message));
  res.json(rows[0]);
});

// Delete shift
app.delete('/api/shifts/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'chatter') {
    const check = await pool.query('SELECT id FROM chatter_shifts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Ce shift ne t\'appartient pas' });
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  await pool.query('DELETE FROM chatter_shifts WHERE id = $1', [req.params.id]);
  broadcast('shift-deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

// Stats chatter perso
app.get('/api/shifts/my-stats', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chatter' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const uid = req.user.id;
  const today = (await pool.query("SELECT COALESCE(SUM(ppv_total), 0) as ppv, COALESCE(SUM(tips_total), 0) as tips, COUNT(*) as shifts FROM chatter_shifts WHERE user_id = $1 AND date = CURRENT_DATE::text", [uid])).rows[0];
  const week = (await pool.query("SELECT COALESCE(SUM(ppv_total), 0) as ppv, COALESCE(SUM(tips_total), 0) as tips, COUNT(*) as shifts FROM chatter_shifts WHERE user_id = $1 AND date >= (CURRENT_DATE - INTERVAL '7 days')::date::text", [uid])).rows[0];
  const total = (await pool.query("SELECT COALESCE(SUM(ppv_total), 0) as ppv, COALESCE(SUM(tips_total), 0) as tips, COUNT(*) as shifts FROM chatter_shifts WHERE user_id = $1", [uid])).rows[0];
  res.json({
    today: { ppv: parseFloat(today.ppv), tips: parseFloat(today.tips), revenue: parseFloat(today.ppv) + parseFloat(today.tips), shifts: parseInt(today.shifts) },
    week: { ppv: parseFloat(week.ppv), tips: parseFloat(week.tips), revenue: parseFloat(week.ppv) + parseFloat(week.tips), shifts: parseInt(week.shifts) },
    total: { ppv: parseFloat(total.ppv), tips: parseFloat(total.tips), revenue: parseFloat(total.ppv) + parseFloat(total.tips), shifts: parseInt(total.shifts) }
  });
});

// Stats admin globales chatters
app.get('/api/shifts/admin-stats', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id as user_id,
      u.display_name as chatter_name,
      COALESCE(SUM(cs.ppv_total), 0) as total_ppv,
      COALESCE(SUM(cs.tips_total), 0) as total_tips,
      COALESCE(SUM(cs.ppv_total) + SUM(cs.tips_total), 0) as total_revenue,
      COUNT(cs.id) as total_shifts,
      COALESCE(SUM(CASE WHEN cs.date = CURRENT_DATE::text THEN cs.ppv_total ELSE 0 END), 0) as today_ppv,
      COALESCE(SUM(CASE WHEN cs.date = CURRENT_DATE::text THEN cs.tips_total ELSE 0 END), 0) as today_tips,
      COALESCE(SUM(CASE WHEN cs.date >= (CURRENT_DATE - INTERVAL '7 days')::date::text THEN cs.ppv_total ELSE 0 END), 0) as week_ppv,
      COALESCE(SUM(CASE WHEN cs.date >= (CURRENT_DATE - INTERVAL '7 days')::date::text THEN cs.tips_total ELSE 0 END), 0) as week_tips
    FROM users u
    LEFT JOIN chatter_shifts cs ON cs.user_id = u.id
    WHERE u.role = 'chatter' AND (u.agency_id = $1 OR u.agency_id IS NULL)
    GROUP BY u.id, u.display_name
    ORDER BY total_revenue DESC
  `, [req.user.agency_id]);
  res.json(rows);
});

// ============ OUTREACH LEADS ============

// Get leads — outreach voit ses propres leads, admin voit tout
app.get('/api/leads', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const aid = req.user.agency_id;
  const { rows } = await pool.query(`
    SELECT ol.*, u.display_name as agent_name
    FROM outreach_leads ol
    JOIN users u ON ol.user_id = u.id
    WHERE (ol.agency_id = $1 OR ol.agency_id IS NULL)
    ORDER BY ol.created_at DESC
  `, [aid]);
  res.json(rows);
});

// Add lead
app.post('/api/leads', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { username, ig_link, lead_type, script_used, ig_account_used, notes, status } = req.body;
  if (!username) return res.status(400).json({ error: 'Username requis' });
  const cleanUsername = username.replace(/^@/, '');
  const exists = await pool.query("SELECT id, status FROM outreach_leads WHERE LOWER(REPLACE(username, '@', '')) = LOWER($1) AND (agency_id = $2 OR agency_id IS NULL)", [cleanUsername, req.user.agency_id]);
  if (exists.rows.length > 0) return res.status(409).json({ error: `Ce lead existe déjà (statut : ${exists.rows[0].status})` });
  const { rows } = await pool.query(
    'INSERT INTO outreach_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status, agency_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
    [req.user.id, username, ig_link, lead_type || 'model', script_used, ig_account_used, notes, status || 'to-send', req.user.agency_id]
  );
  broadcast('lead-added', { ...rows[0], by: req.user.id });
  res.json(rows[0]);
});

// Bulk update leads (MUST be before /:id to avoid Express matching "bulk-update" as an id)
app.put('/api/leads/bulk-update', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { ids, script_used, ig_account_used } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requis' });
  const sets = [];
  const params = [];
  let pi = 1;
  if (script_used !== undefined) { sets.push(`script_used = $${pi++}`); params.push(script_used); }
  if (ig_account_used !== undefined) { sets.push(`ig_account_used = $${pi++}`); params.push(ig_account_used); }
  if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  sets.push('updated_at = NOW()');
  params.push(ids);
  await pool.query(`UPDATE outreach_leads SET ${sets.join(', ')} WHERE id = ANY($${pi})`, params);
  broadcast('leads-bulk-updated', { ids, script_used, ig_account_used, by: req.user.id });
  res.json({ ok: true, updated: ids.length });
});

// Update lead
app.put('/api/leads/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { status, notes, lead_type, script_used, ig_account_used } = req.body;
  await pool.query(`UPDATE outreach_leads SET status = COALESCE($1, status), notes = COALESCE($2, notes),
    lead_type = COALESCE($3, lead_type), script_used = COALESCE($4, script_used),
    ig_account_used = COALESCE($5, ig_account_used), updated_at = NOW(),
    sent_at = CASE WHEN $1 = 'sent' AND (sent_at IS NULL) THEN NOW() ELSE sent_at END WHERE id = $6`,
    [status, notes, lead_type, script_used, ig_account_used, req.params.id]);
  // Inclure le username dans le broadcast pour les notifications
  let username = '';
  if (status === 'talking-warm' || status === 'call-booked' || status === 'signed') {
    const leadRow = (await pool.query('SELECT username FROM outreach_leads WHERE id = $1', [req.params.id])).rows[0];
    username = leadRow?.username || '';
  }
  broadcast('lead-updated', { id: parseInt(req.params.id), status, notes, username, by: req.user.id });
  res.json({ ok: true });
});

// Delete lead
app.delete('/api/leads/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM outreach_leads WHERE id = $1', [req.params.id]);
  broadcast('lead-deleted', { id: parseInt(req.params.id), by: req.user.id });
  res.json({ ok: true });
});

// Stats outreach personnelles (pour l'assistante connectée)
app.get('/api/leads/my-stats', authMiddleware, async (req, res) => {
  if (req.user.role !== 'outreach' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const uid = req.user.id;
  const today = (await pool.query(`SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND created_at >= ${SQL_TODAY_START}`, [uid])).rows[0].count;
  const dmSentToday = (await pool.query(`SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND sent_at >= ${SQL_TODAY_START}`, [uid])).rows[0].count;
  const dmSent = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status != 'to-send'", [uid])).rows[0].count;
  const warm = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'talking-warm'", [uid])).rows[0].count;
  const booked = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'call-booked'", [uid])).rows[0].count;
  const cold = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'talking-cold'", [uid])).rows[0].count;
  const signed = (await pool.query("SELECT COALESCE(COUNT(*), 0) as count FROM outreach_leads WHERE user_id = $1 AND status = 'signed'", [uid])).rows[0].count;
  const replies = parseInt(cold) + parseInt(warm) + parseInt(booked) + parseInt(signed);
  const replyRate = parseInt(dmSent) > 0 ? ((replies / parseInt(dmSent)) * 100).toFixed(1) : '0';
  res.json({
    leads_today: parseInt(today),
    dm_sent_today: parseInt(dmSentToday),
    dm_sent: parseInt(dmSent),
    talking_warm: parseInt(warm),
    call_booked: parseInt(booked),
    reply_rate: replyRate
  });
});

// Stats outreach globales (pour l'admin)
app.get('/api/leads/admin-stats', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      u.id as user_id,
      u.display_name as agent_name,
      COALESCE(COUNT(*), 0) as total_leads,
      COALESCE(SUM(CASE WHEN ol.created_at >= ${SQL_TODAY_START} THEN 1 ELSE 0 END), 0) as leads_today,
      COALESCE(SUM(CASE WHEN ol.status != 'to-send' THEN 1 ELSE 0 END), 0) as dm_sent,
      COALESCE(SUM(CASE WHEN ol.sent_at >= ${SQL_TODAY_START} THEN 1 ELSE 0 END), 0) as dm_sent_today,
      COALESCE(SUM(CASE WHEN ol.status = 'talking-cold' THEN 1 ELSE 0 END), 0) as talking_cold,
      COALESCE(SUM(CASE WHEN ol.status = 'talking-warm' THEN 1 ELSE 0 END), 0) as talking_warm,
      COALESCE(SUM(CASE WHEN ol.status = 'call-booked' THEN 1 ELSE 0 END), 0) as call_booked,
      COALESCE(SUM(CASE WHEN ol.status = 'signed' THEN 1 ELSE 0 END), 0) as signed
    FROM users u
    LEFT JOIN outreach_leads ol ON ol.user_id = u.id
    WHERE u.role = 'outreach' AND (u.agency_id = $1 OR u.agency_id IS NULL)
    GROUP BY u.id, u.display_name
    ORDER BY u.display_name
  `, [req.user.agency_id]);
  res.json(rows);
});

// ============ PERFORMANCE CHARTS DATA ============

// Followers evolution par jour
app.get('/api/charts/followers', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT ds.date, m.name as model_name, a.platform, SUM(ds.new_followers) as new_followers
    FROM daily_stats ds
    JOIN accounts a ON ds.account_id = a.id
    JOIN models m ON a.model_id = m.id
    WHERE ds.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text AND (m.agency_id = $2 OR m.agency_id IS NULL)
    GROUP BY ds.date, m.name, a.platform
    ORDER BY ds.date ASC
  `, [days, req.user.agency_id]);
  res.json(rows);
});

// Revenue chatters par jour
app.get('/api/charts/revenue', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT cs.date,
      SUM(cs.ppv_total) as ppv,
      SUM(cs.tips_total) as tips,
      SUM(cs.ppv_total) + SUM(cs.tips_total) as revenue
    FROM chatter_shifts cs
    WHERE cs.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text AND (cs.agency_id = $2 OR cs.agency_id IS NULL)
    GROUP BY cs.date
    ORDER BY cs.date ASC
  `, [days, req.user.agency_id]);
  res.json(rows);
});

// Revenue chatters par jour par chatter
app.get('/api/charts/revenue-by-chatter', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT cs.date, u.display_name as chatter_name,
      SUM(cs.ppv_total) + SUM(cs.tips_total) as revenue
    FROM chatter_shifts cs
    JOIN users u ON cs.user_id = u.id
    WHERE cs.date >= (CURRENT_DATE - $1 * INTERVAL '1 day')::date::text AND (cs.agency_id = $2 OR cs.agency_id IS NULL)
    GROUP BY cs.date, u.display_name
    ORDER BY cs.date ASC
  `, [days, req.user.agency_id]);
  res.json(rows);
});

// Leads outreach par jour
app.get('/api/charts/leads', authMiddleware, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const { rows } = await pool.query(`
    SELECT created_at::date::text as date,
      COUNT(*) as total,
      SUM(CASE WHEN status != 'to-send' THEN 1 ELSE 0 END) as dm_sent,
      SUM(CASE WHEN status IN ('talking-cold','talking-warm','call-booked','signed') THEN 1 ELSE 0 END) as replies
    FROM outreach_leads
    WHERE created_at >= CURRENT_DATE - $1 * INTERVAL '1 day' AND (agency_id = $2 OR agency_id IS NULL)
    GROUP BY created_at::date
    ORDER BY date ASC
  `, [days, req.user.agency_id]);
  res.json(rows);
});

// ============ STUDENT PROGRESSION ============
app.put('/api/students/:id/progression', authMiddleware, adminOnly, async (req, res) => {
  const { progression_step } = req.body;
  const steps = ['onboarding', 'accounts-setup', 'outreach', 'model-setup', 'traffic'];
  if (!steps.includes(progression_step)) return res.status(400).json({ error: 'Étape invalide' });
  const progression = Math.round(((steps.indexOf(progression_step) + 1) / steps.length) * 100);
  await pool.query('UPDATE students SET progression_step = $1, progression = $2 WHERE id = $3', [progression_step, progression, req.params.id]);
  res.json({ ok: true });
});

app.put('/api/students/:id/outreach-us', authMiddleware, adminOnly, async (req, res) => {
  const { enabled } = req.body;
  await pool.query('UPDATE students SET outreach_us_enabled = $1 WHERE id = $2', [!!enabled, req.params.id]);
  res.json({ ok: true });
});

// ============ CALL REQUESTS ============
app.get('/api/call-requests', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM call_requests WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    const { rows } = await pool.query(`SELECT cr.*, u.display_name as student_name FROM call_requests cr JOIN users u ON cr.user_id = u.id ORDER BY CASE cr.status WHEN 'pending' THEN 0 ELSE 1 END, cr.created_at DESC`);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/call-requests', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Réservé aux élèves' });
  const { message, availabilities } = req.body;
  const { rows } = await pool.query('INSERT INTO call_requests (user_id, message, availabilities) VALUES ($1, $2, $3) RETURNING *', [req.user.id, message, availabilities]);
  broadcast('call-request-new', rows[0]);
  await logActivity(req.user.id, req.user.display_name, 'call-request', 'call', rows[0].id, null);
  sendWhatsApp('📞 Demande de call de ' + req.user.display_name);
  res.json(rows[0]);
});

app.put('/api/call-requests/:id', authMiddleware, adminOnly, async (req, res) => {
  const { status, scheduled_at, admin_notes } = req.body;
  await pool.query('UPDATE call_requests SET status = COALESCE($1, status), scheduled_at = COALESCE($2, scheduled_at), admin_notes = COALESCE($3, admin_notes) WHERE id = $4', [status, scheduled_at, admin_notes, req.params.id]);
  broadcast('call-request-updated', { id: parseInt(req.params.id), status });
  res.json({ ok: true });
});

app.delete('/api/call-requests/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM call_requests WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM call_requests WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT RECRUITS (modèles recrutées) ============
app.get('/api/student-recruits', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    const { rows } = await pool.query('SELECT * FROM student_recruits WHERE user_id = ANY($1) ORDER BY created_at DESC', [sharedIds]);
    return res.json(rows);
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    const { rows } = await pool.query('SELECT sr.*, u.display_name as student_name FROM student_recruits sr JOIN users u ON sr.user_id = u.id ORDER BY sr.created_at DESC');
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/student-recruits', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { ig_name, ig_link, notes } = req.body;
  if (!ig_name) return res.status(400).json({ error: 'Nom Instagram requis' });
  const uid = req.body.user_id || req.user.id;
  const { rows } = await pool.query('INSERT INTO student_recruits (user_id, ig_name, ig_link, notes) VALUES ($1, $2, $3, $4) RETURNING *', [uid, ig_name, ig_link, notes]);
  res.json(rows[0]);
});

app.put('/api/student-recruits/:id', authMiddleware, async (req, res) => {
  const { status, notes } = req.body;
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_recruits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('UPDATE student_recruits SET status = COALESCE($1, status), notes = COALESCE($2, notes) WHERE id = $3', [status, notes, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/student-recruits/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_recruits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM student_recruits WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT OUTREACH ASSIGNMENTS ============
app.get('/api/student-outreach-assignments', authMiddleware, async (req, res) => {
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    const { rows } = await pool.query(`SELECT soa.*, s.display_name as student_name, o.display_name as outreach_name
      FROM student_outreach_assignments soa
      JOIN users s ON soa.student_user_id = s.id JOIN users o ON soa.outreach_user_id = o.id
      ORDER BY s.display_name`);
    return res.json(rows);
  }
  if (req.user.role === 'outreach') {
    const { rows } = await pool.query(`SELECT soa.*, s.display_name as student_name
      FROM student_outreach_assignments soa JOIN users s ON soa.student_user_id = s.id
      WHERE soa.outreach_user_id = $1 ORDER BY s.display_name`, [req.user.id]);
    return res.json(rows);
  }
  res.json([]);
});

app.post('/api/student-outreach-assignments', authMiddleware, adminOnly, async (req, res) => {
  const { student_user_id, outreach_user_id } = req.body;
  if (!student_user_id || !outreach_user_id) return res.status(400).json({ error: 'IDs requis' });
  try {
    const { rows } = await pool.query('INSERT INTO student_outreach_assignments (student_user_id, outreach_user_id) VALUES ($1, $2) RETURNING *', [student_user_id, outreach_user_id]);
    res.json(rows[0]);
  } catch(e) { res.status(409).json({ error: 'Assignation déjà existante' }); }
});

app.delete('/api/student-outreach-assignments/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM student_outreach_assignments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Helper: check if user can access student outreach
async function canAccessStudentOutreach(userId, userRole, studentUserId) {
  if (userRole === 'admin' || userRole === 'super_admin' || userRole === 'platform_admin') return true;
  if (userRole === 'student') {
    if (userId === parseInt(studentUserId)) return true;
    // Vérifier si pairés
    const sharedIds = await getSharedOutreachIds(userId);
    if (sharedIds.includes(parseInt(studentUserId))) return true;
  }
  if (userRole === 'outreach') {
    // Vérifier assignation directe ou via un partenaire
    const sharedIds = await getSharedOutreachIds(studentUserId);
    const check = await pool.query('SELECT id FROM student_outreach_assignments WHERE student_user_id = ANY($1) AND outreach_user_id = $2', [sharedIds, userId]);
    return check.rows.length > 0;
  }
  return false;
}

// ============ STUDENT OUTREACH ADMIN STATS ============
app.get('/api/student-outreach-admin-stats', authMiddleware, adminOnly, async (req, res) => {
  // Pour chaque élève qui a des assignations outreach, retourner les stats par assistante
  const { rows: allAssignments } = await pool.query(`
    SELECT soa.student_user_id, s.display_name as student_name, soa.outreach_user_id, o.display_name as outreach_name
    FROM student_outreach_assignments soa
    JOIN users s ON soa.student_user_id = s.id
    JOIN users o ON soa.outreach_user_id = o.id
    ORDER BY s.display_name, o.display_name
  `);

  const results = [];
  const studentIds = [...new Set(allAssignments.map(a => a.student_user_id))];

  for (const studentId of studentIds) {
    const studentName = allAssignments.find(a => a.student_user_id === studentId).student_name;
    const sharedIds = await getSharedOutreachIds(studentId);
    const assistants = allAssignments.filter(a => a.student_user_id === studentId);

    // Stats globales du pool de cet élève
    const totalLeads = (await pool.query('SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)', [sharedIds])).rows[0].c;
    const dmSent = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND status != 'to-send'", [sharedIds])).rows[0].c;
    const dmSentToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND sent_at >= ${SQL_TODAY_START}`, [sharedIds])).rows[0].c;
    const leadsToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND created_at >= ${SQL_TODAY_START}`, [sharedIds])).rows[0].c;

    // Stats par assistante
    const assistantStats = [];
    for (const a of assistants) {
      const aLeadsToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2) AND created_at >= ${SQL_TODAY_START}`, [a.outreach_user_id, sharedIds])).rows[0].c;
      const aDmsToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE last_modified_by = $1 AND user_id = ANY($2) AND sent_at >= ${SQL_TODAY_START}`, [a.outreach_user_id, sharedIds])).rows[0].c;
      const aDmsTotal = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE last_modified_by = $1 AND user_id = ANY($2) AND status != 'to-send'", [a.outreach_user_id, sharedIds])).rows[0].c;
      assistantStats.push({
        name: a.outreach_name,
        user_id: a.outreach_user_id,
        leads_today: parseInt(aLeadsToday),
        dms_today: parseInt(aDmsToday),
        dms_total: parseInt(aDmsTotal)
      });
    }

    results.push({
      student_user_id: studentId,
      student_name: studentName,
      total_leads: parseInt(totalLeads),
      dm_sent: parseInt(dmSent),
      dm_sent_today: parseInt(dmSentToday),
      leads_today: parseInt(leadsToday),
      assistants: assistantStats
    });
  }

  res.json(results);
});

// ============ COACHING OUTREACH OVERVIEW (admin) ============
app.get('/api/student-leads/coaching-overview', authMiddleware, adminOnly, async (req, res) => {
  // Tous les élèves avec user_id
  const { rows: students } = await pool.query(`
    SELECT s.id, s.user_id, u.display_name as name
    FROM students s JOIN users u ON s.user_id = u.id ORDER BY u.display_name
  `);

  const results = [];
  for (const student of students) {
    const sharedIds = await getSharedOutreachIds(student.user_id);

    // Pipeline counts par marché (fr + us combinés)
    const { rows: pipeline } = await pool.query(`
      SELECT status, COUNT(*) as count FROM student_leads
      WHERE user_id = ANY($1) GROUP BY status
    `, [sharedIds]);

    const counts = {};
    pipeline.forEach(r => { counts[r.status] = parseInt(r.count); });

    // Total et DMs envoyés
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const dmSent = total - (counts['to-send'] || 0);

    // Leads ajoutés aujourd'hui
    const { rows: todayRow } = await pool.query(
      `SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1) AND created_at >= ${SQL_TODAY_START}`, [sharedIds]
    );

    // Derniers leads actifs (talking/call-booked/signed) — les plus récents
    const { rows: recentLeads } = await pool.query(`
      SELECT sl.id, sl.username, sl.ig_link, sl.status, sl.lead_type, sl.notes, sl.updated_at, sl.sent_at,
        COALESCE(sl.market, 'fr') as market
      FROM student_leads sl
      WHERE sl.user_id = ANY($1) AND sl.status NOT IN ('to-send')
      ORDER BY sl.updated_at DESC NULLS LAST LIMIT 50
    `, [sharedIds]);

    results.push({
      student_id: student.id,
      student_user_id: student.user_id,
      student_name: student.name,
      total_leads: total,
      dm_sent: dmSent,
      leads_today: parseInt(todayRow[0].c),
      pipeline: {
        'to-send': counts['to-send'] || 0,
        'sent': counts['sent'] || 0,
        'talking-cold': counts['talking-cold'] || 0,
        'talking-warm': counts['talking-warm'] || 0,
        'call-booked': counts['call-booked'] || 0,
        'signed': counts['signed'] || 0
      },
      leads: recentLeads
    });
  }

  res.json(results);
});

// ============ STUDENT OUTREACH PAIRS ============
// Helper: get all user IDs sharing outreach with this student
async function getSharedOutreachIds(studentUserId) {
  const { rows } = await pool.query(
    `SELECT student_b_id as partner_id FROM student_outreach_pairs WHERE student_a_id = $1
     UNION SELECT student_a_id as partner_id FROM student_outreach_pairs WHERE student_b_id = $1`, [studentUserId]);
  const ids = [parseInt(studentUserId)];
  rows.forEach(r => ids.push(r.partner_id));
  return ids;
}

async function logActivity(userId, userName, action, targetType, targetId, details) {
  try {
    await pool.query('INSERT INTO activity_log (user_id, user_name, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
      [userId, userName, action, targetType, targetId, details]);
  } catch(e) {}
}

app.get('/api/student-outreach-pairs', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { rows } = await pool.query(`SELECT sop.*, a.display_name as student_a_name, b.display_name as student_b_name
    FROM student_outreach_pairs sop JOIN users a ON sop.student_a_id = a.id JOIN users b ON sop.student_b_id = b.id ORDER BY a.display_name`);
  res.json(rows);
});

app.post('/api/student-outreach-pairs', authMiddleware, adminOnly, async (req, res) => {
  const { student_a_id, student_b_id } = req.body;
  if (!student_a_id || !student_b_id) return res.status(400).json({ error: 'Deux élèves requis' });
  if (student_a_id === student_b_id) return res.status(400).json({ error: 'Impossible de pairer un élève avec lui-même' });
  // Toujours stocker le plus petit ID en A pour éviter les doublons inversés
  const a = Math.min(student_a_id, student_b_id);
  const b = Math.max(student_a_id, student_b_id);
  try {
    const { rows } = await pool.query('INSERT INTO student_outreach_pairs (student_a_id, student_b_id) VALUES ($1, $2) RETURNING *', [a, b]);
    res.json(rows[0]);
  } catch(e) { res.status(409).json({ error: 'Cette paire existe déjà' }); }
});

app.delete('/api/student-outreach-pairs/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM student_outreach_pairs WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT LEADS BULK IMPORT ============
app.post('/api/student-leads/import-csv', authMiddleware, async (req, res) => {
  const { csv_content, student_user_id, market } = req.body;
  const importMarket = market === 'us' ? 'us' : 'fr';
  if (!csv_content) return res.status(400).json({ error: 'Contenu CSV requis' });

  // Déterminer le propriétaire
  let ownerId;
  if (req.user.role === 'student') {
    ownerId = req.user.id;
  } else if (req.user.role === 'outreach' && student_user_id) {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, student_user_id);
    if (!allowed) return res.status(403).json({ error: 'Pas assignée à cet élève' });
    ownerId = student_user_id;
  } else if ((req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') && student_user_id) {
    ownerId = student_user_id;
  } else {
    ownerId = req.user.id;
  }

  const statusMap = {
    'sent': 'sent', 'to send': 'to-send', 'to-send': 'to-send',
    'talking - cold': 'talking-cold', 'talking-cold': 'talking-cold', 'talking cold': 'talking-cold',
    'talking - warm': 'talking-warm', 'talking-warm': 'talking-warm', 'talking warm': 'talking-warm',
    'call booked': 'call-booked', 'call-booked': 'call-booked',
    'signed': 'signed'
  };

  // Parser CSV avec gestion des guillemets
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const lines = csv_content.split('\n').filter(l => l.trim());
  let imported = 0, updated = 0, skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    let username = (cols[0] || '').trim();
    if (!username) continue;

    let igLink = (cols[1] || '').trim();
    const leadType = (cols[2] || '').trim().toLowerCase() || '';
    const rawStatus = (cols[3] || '').trim().toLowerCase();
    const script = (cols[4] || '').trim();
    const account = (cols[5] || '').trim();
    const notes = (cols[6] || '').trim();
    const status = statusMap[rawStatus] || 'sent';

    // Si le username est un lien Instagram, extraire le vrai username
    if (username.includes('instagram.com')) {
      const match = username.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
      if (match) { if (!igLink) igLink = username; username = match[1]; }
    }

    // Vérifier doublon dans le pool
    const cleanUsername = username.replace(/^@/, '');
    const sharedIds = await getSharedOutreachIds(ownerId);
    const exists = await pool.query("SELECT id FROM student_leads WHERE LOWER(REPLACE(username, '@', '')) = LOWER($1) AND user_id = ANY($2) AND COALESCE(market,'fr') = $3", [cleanUsername, sharedIds, importMarket]);

    if (exists.rows.length > 0) {
      // Mettre à jour le lead existant
      await pool.query(`UPDATE student_leads SET ig_link = COALESCE(NULLIF($1,''), ig_link), lead_type = COALESCE(NULLIF($2,''), lead_type),
        status = COALESCE(NULLIF($3,''), status), script_used = COALESCE(NULLIF($4,''), script_used),
        ig_account_used = COALESCE(NULLIF($5,''), ig_account_used), notes = COALESCE(NULLIF($6,''), notes), updated_at = NOW() WHERE id = $7`,
        [igLink, leadType, status, script, account, notes, exists.rows[0].id]);
      updated++;
    } else {
      await pool.query('INSERT INTO student_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status, added_by, market) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
        [ownerId, username, igLink, leadType, script, account, notes, status, req.user.id, importMarket]);
      imported++;
    }
  }

  res.json({ ok: true, imported, updated, skipped: lines.length - 1 - imported - updated, total: lines.length - 1 });
});

// ============ STUDENT LEADS (outreach élèves) ============
// GET: student voit les siens, outreach voit ceux de l'élève assigné (via ?student_user_id=), admin voit tout
app.get('/api/student-leads', authMiddleware, async (req, res) => {
  const studentUserId = req.query.student_user_id;
  const market = req.query.market || 'fr';
  const marketFilter = " AND COALESCE(sl.market, 'fr') = '" + (market === 'us' ? 'us' : 'fr') + "'";

  if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    const { rows } = await pool.query('SELECT sl.*, ab.display_name as added_by_name, lm.display_name as modified_by_name FROM student_leads sl LEFT JOIN users ab ON sl.added_by = ab.id LEFT JOIN users lm ON sl.last_modified_by = lm.id WHERE sl.user_id = ANY($1)' + marketFilter + ' ORDER BY sl.created_at DESC', [sharedIds]);
    return res.json(rows);
  }
  if (req.user.role === 'outreach' && studentUserId) {
    if (market === 'us') return res.status(403).json({ error: 'Outreach US réservé aux élèves' });
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, studentUserId);
    if (!allowed) return res.status(403).json({ error: 'Pas assignée à cet élève' });
    const sharedIds = await getSharedOutreachIds(studentUserId);
    const { rows } = await pool.query('SELECT sl.*, ab.display_name as added_by_name, lm.display_name as modified_by_name FROM student_leads sl LEFT JOIN users ab ON sl.added_by = ab.id LEFT JOIN users lm ON sl.last_modified_by = lm.id WHERE sl.user_id = ANY($1)' + marketFilter + ' ORDER BY sl.created_at DESC', [sharedIds]);
    return res.json(rows);
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    if (studentUserId) {
      const { rows } = await pool.query('SELECT sl.*, u.display_name as student_name, ab.display_name as added_by_name, lm.display_name as modified_by_name FROM student_leads sl JOIN users u ON sl.user_id = u.id LEFT JOIN users ab ON sl.added_by = ab.id LEFT JOIN users lm ON sl.last_modified_by = lm.id WHERE sl.user_id = $1' + marketFilter + ' ORDER BY sl.created_at DESC', [studentUserId]);
      return res.json(rows);
    }
    const { rows } = await pool.query("SELECT sl.*, u.display_name as student_name, ab.display_name as added_by_name, lm.display_name as modified_by_name FROM student_leads sl JOIN users u ON sl.user_id = u.id LEFT JOIN users ab ON sl.added_by = ab.id LEFT JOIN users lm ON sl.last_modified_by = lm.id WHERE COALESCE(sl.market, 'fr') = '" + (market === 'us' ? 'us' : 'fr') + "' ORDER BY sl.created_at DESC");
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

// POST: student ajoute pour soi, outreach ajoute pour l'élève assigné (via student_user_id), admin pour tout le monde
app.post('/api/student-leads', authMiddleware, async (req, res) => {
  const { username, ig_link, lead_type, script_used, ig_account_used, notes, status, student_user_id, market } = req.body;
  const leadMarket = market === 'us' ? 'us' : 'fr';
  if (!username) return res.status(400).json({ error: 'Username requis' });

  // Déterminer le propriétaire du lead
  let ownerId;
  if (req.user.role === 'student') {
    ownerId = req.user.id;
  } else if (req.user.role === 'outreach' && student_user_id) {
    if (leadMarket === 'us') return res.status(403).json({ error: 'Outreach US réservé aux élèves' });
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, student_user_id);
    if (!allowed) return res.status(403).json({ error: 'Pas assignée à cet élève' });
    ownerId = student_user_id;
  } else if ((req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') && student_user_id) {
    ownerId = student_user_id;
  } else {
    return res.status(400).json({ error: 'student_user_id requis' });
  }

  const cleanUsername = username.replace(/^@/, '');
  const checkIds = await getSharedOutreachIds(ownerId);
  const exists = await pool.query("SELECT id FROM student_leads WHERE LOWER(REPLACE(username, '@', '')) = LOWER($1) AND user_id = ANY($2) AND COALESCE(market,'fr') = $3", [cleanUsername, checkIds, leadMarket]);
  if (exists.rows.length > 0) return res.status(409).json({ error: 'Ce lead existe déjà' });
  const { rows } = await pool.query('INSERT INTO student_leads (user_id, username, ig_link, lead_type, script_used, ig_account_used, notes, status, added_by, market) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
    [ownerId, username, ig_link, lead_type || '', script_used, ig_account_used, notes, status || 'to-send', req.user.id, leadMarket]);
  res.json(rows[0]);
});

// Bulk update student leads (MUST be before /:id)
app.put('/api/student-leads/bulk-update', authMiddleware, async (req, res) => {
  const { ids, script_used, ig_account_used } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids requis' });
  const sets = [];
  const params = [];
  let pi = 1;
  if (script_used !== undefined) { sets.push(`script_used = $${pi++}`); params.push(script_used); }
  if (ig_account_used !== undefined) { sets.push(`ig_account_used = $${pi++}`); params.push(ig_account_used); }
  if (sets.length === 0) return res.status(400).json({ error: 'Rien à modifier' });
  sets.push(`updated_at = NOW()`);
  sets.push(`last_modified_by = $${pi++}`);
  params.push(req.user.id);
  params.push(ids);
  await pool.query(`UPDATE student_leads SET ${sets.join(', ')} WHERE id = ANY($${pi})`, params);
  res.json({ ok: true, updated: ids.length });
});

app.put('/api/student-leads/:id', authMiddleware, async (req, res) => {
  const { status, notes, lead_type, script_used, ig_account_used } = req.body;
  // Vérifier l'accès
  const lead = (await pool.query('SELECT user_id FROM student_leads WHERE id = $1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, lead.user_id);
  if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query(`UPDATE student_leads SET
    status = COALESCE($1, status), notes = COALESCE($2, notes),
    lead_type = COALESCE($3, lead_type), script_used = COALESCE($4, script_used),
    ig_account_used = COALESCE($5, ig_account_used), updated_at = NOW(),
    last_modified_by = $7,
    sent_at = CASE WHEN $1 = 'sent' AND (sent_at IS NULL) THEN NOW() ELSE sent_at END WHERE id = $6`,
    [status, notes, lead_type, script_used, ig_account_used, req.params.id, req.user.id]);
  // Activity log + WhatsApp for important status changes
  if (status === 'talking-warm' || status === 'call-booked' || status === 'signed') {
    const leadInfo = (await pool.query('SELECT sl.username, u.display_name as student_name FROM student_leads sl JOIN users u ON sl.user_id = u.id WHERE sl.id = $1', [req.params.id])).rows[0];
    const labels = {'talking-warm': 'Discussion chaude', 'call-booked': 'Call prévu', 'signed': 'Signé'};
    await logActivity(req.user.id, req.user.display_name, 'lead-' + status, 'lead', parseInt(req.params.id), leadInfo?.username + ' (' + leadInfo?.student_name + ')');
    if ((status === 'talking-warm' || status === 'call-booked') && await isNotifEnabled('notif_alert_lead_warm')) {
      sendWhatsApp('🔥 ' + (leadInfo?.username || '?') + ' est passé en ' + labels[status] + ' (élève: ' + (leadInfo?.student_name || '?') + ')');
    }
    if (status === 'signed' && await isNotifEnabled('notif_alert_lead_signed')) {
      sendWhatsApp('🎉 LEAD SIGNÉ !\n\n👤 ' + (leadInfo?.username || '?') + '\n🎓 Élève: ' + (leadInfo?.student_name || '?') + '\n📅 ' + new Date().toLocaleDateString('fr-FR') + '\n\nBravo à toute l\'équipe !');
    }
  }
  res.json({ ok: true });
});

app.delete('/api/student-leads/all', authMiddleware, async (req, res) => {
  const market = req.query.market || 'fr';
  const mf = market === 'us' ? 'us' : 'fr';
  let uid;
  if (req.user.role === 'student') uid = req.user.id;
  else if ((req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') && req.query.student_user_id) uid = req.query.student_user_id;
  else return res.status(400).json({ error: 'Accès refusé' });
  const sharedIds = await getSharedOutreachIds(uid);
  const result = await pool.query("DELETE FROM student_leads WHERE user_id = ANY($1) AND COALESCE(market, 'fr') = $2", [sharedIds, mf]);
  res.json({ ok: true, deleted: result.rowCount });
});


app.delete('/api/student-leads/:id', authMiddleware, async (req, res) => {
  const lead = (await pool.query('SELECT user_id FROM student_leads WHERE id = $1', [req.params.id])).rows[0];
  if (!lead) return res.status(404).json({ error: 'Lead introuvable' });
  const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, lead.user_id);
  if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM student_leads WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/student-leads/stats', authMiddleware, async (req, res) => {
  let uid = req.query.student_user_id || req.query.user_id;
  if (req.user.role === 'student') uid = req.user.id;
  if (uid && req.user.role === 'outreach') {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, uid);
    if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  }
  if (!uid) return res.status(400).json({ error: 'user_id requis' });
  const market = req.query.market || 'fr';
  const mf = " AND COALESCE(market, 'fr') = '" + (market === 'us' ? 'us' : 'fr') + "'";
  const sharedIds = await getSharedOutreachIds(uid);

  // Stats globales du pool
  const total = (await pool.query('SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)' + mf, [sharedIds])).rows[0].c;
  const leadsToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)${mf} AND created_at >= ${SQL_TODAY_START}`, [sharedIds])).rows[0].c;
  const dmSentToday = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)${mf} AND sent_at >= ${SQL_TODAY_START}`, [sharedIds])).rows[0].c;
  const dmSent = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)" + mf + " AND status != 'to-send'", [sharedIds])).rows[0].c;
  const cold = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)" + mf + " AND status = 'talking-cold'", [sharedIds])).rows[0].c;
  const warm = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)" + mf + " AND status = 'talking-warm'", [sharedIds])).rows[0].c;
  const booked = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)" + mf + " AND status = 'call-booked'", [sharedIds])).rows[0].c;
  const signed = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE user_id = ANY($1)" + mf + " AND status = 'signed'", [sharedIds])).rows[0].c;
  const replies = parseInt(cold) + parseInt(warm) + parseInt(booked) + parseInt(signed);
  const rate = parseInt(dmSent) > 0 ? ((replies / parseInt(dmSent)) * 100).toFixed(1) : '0';

  // Stats individuelles par membre du pool
  const contributions = [];
  for (const memberId of sharedIds) {
    const memberName = (await pool.query('SELECT display_name FROM users WHERE id = $1', [memberId])).rows[0]?.display_name || '?';
    const mLeads = (await pool.query('SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2)' + mf, [memberId, sharedIds])).rows[0].c;
    const mDms = (await pool.query(`SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2)${mf} AND sent_at >= ${SQL_TODAY_START}`, [memberId, sharedIds])).rows[0].c;
    const mTotal = (await pool.query("SELECT COUNT(*) as c FROM student_leads WHERE added_by = $1 AND user_id = ANY($2)" + mf + " AND status != 'to-send'", [memberId, sharedIds])).rows[0].c;
    contributions.push({ user_id: memberId, name: memberName, leads_added: parseInt(mLeads), dms_today: parseInt(mDms), dms_total: parseInt(mTotal) });
  }

  res.json({ total: parseInt(total), leads_today: parseInt(leadsToday), dm_sent_today: parseInt(dmSentToday), dm_sent: parseInt(dmSent), talking_cold: parseInt(cold), talking_warm: parseInt(warm), call_booked: parseInt(booked), signed: parseInt(signed), reply_rate: rate, contributions, shared: sharedIds.length > 1 });
});

// ============ STUDENT MODELS ============
app.get('/api/student-models', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    const { rows } = await pool.query('SELECT * FROM student_models WHERE user_id = ANY($1) ORDER BY name', [sharedIds]);
    return res.json(rows);
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    const userId = req.query.user_id;
    const query = userId
      ? 'SELECT sm.*, u.display_name as student_name FROM student_models sm JOIN users u ON sm.user_id = u.id WHERE sm.user_id = $1 ORDER BY sm.name'
      : 'SELECT sm.*, u.display_name as student_name FROM student_models sm JOIN users u ON sm.user_id = u.id ORDER BY u.display_name, sm.name';
    const { rows } = await pool.query(query, userId ? [userId] : []);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/student-models', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { name, of_handle, fans_count, commission_rate, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  const uid = req.body.user_id || req.user.id;
  const { rows } = await pool.query('INSERT INTO student_models (user_id, name, of_handle, fans_count, commission_rate, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [uid, name, of_handle, fans_count || 0, commission_rate || 0, status || 'onboarding']);
  res.json(rows[0]);
});

app.put('/api/student-models/:id', authMiddleware, async (req, res) => {
  const { name, of_handle, fans_count, commission_rate, status } = req.body;
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_models WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('UPDATE student_models SET name=COALESCE($1,name), of_handle=COALESCE($2,of_handle), fans_count=COALESCE($3,fans_count), commission_rate=COALESCE($4,commission_rate), status=COALESCE($5,status) WHERE id=$6',
    [name, of_handle, fans_count, commission_rate, status, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/student-models/:id', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM student_models WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM student_models WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ STUDENT REVENUE ============
app.get('/api/student-revenue', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    const { rows } = await pool.query(`SELECT sr.*, sm.name as model_name, sm.commission_rate
      FROM student_revenue sr JOIN student_models sm ON sr.student_model_id = sm.id WHERE sr.user_id = ANY($1) ORDER BY sr.month DESC`, [sharedIds]);
    return res.json(rows);
  }
  const uid = req.query.user_id;
  if (!uid && (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin')) {
    const { rows } = await pool.query(`SELECT sr.*, sm.name as model_name, sm.commission_rate, u.display_name as student_name
      FROM student_revenue sr JOIN student_models sm ON sr.student_model_id = sm.id JOIN users u ON sr.user_id = u.id ORDER BY sr.month DESC, u.display_name`);
    return res.json(rows);
  }
  if (!uid) return res.status(400).json({ error: 'user_id requis' });
  const { rows } = await pool.query(`SELECT sr.*, sm.name as model_name, sm.commission_rate
    FROM student_revenue sr JOIN student_models sm ON sr.student_model_id = sm.id WHERE sr.user_id = $1 ORDER BY sr.month DESC`, [uid]);
  res.json(rows);
});

app.post('/api/student-revenue', authMiddleware, async (req, res) => {
  if (req.user.role !== 'student' && req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { student_model_id, month, revenue } = req.body;
  if (!student_model_id || !month) return res.status(400).json({ error: 'Modèle et mois requis' });
  const uid = req.body.user_id || req.user.id;
  const { rows } = await pool.query(`INSERT INTO student_revenue (user_id, student_model_id, month, revenue) VALUES ($1, $2, $3, $4)
    ON CONFLICT (student_model_id, month) DO UPDATE SET revenue = EXCLUDED.revenue RETURNING *`, [uid, student_model_id, month, revenue || 0]);
  res.json(rows[0]);
});

// ============ MESSAGES (chat temps réel) ============
app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  const otherId = parseInt(req.params.userId);
  const myId = req.user.id;
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'student') return res.status(403).json({ error: 'Accès refusé' });
  if (req.user.role === 'student' && otherId !== myId) {
    const isAdmin = await pool.query('SELECT id FROM users WHERE id = $1 AND role = $2', [otherId, 'admin']);
    if (isAdmin.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
  }
  const { rows } = await pool.query(`SELECT * FROM messages WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1) ORDER BY created_at ASC`, [myId, otherId]);
  // Mark as read
  await pool.query('UPDATE messages SET read = true WHERE to_user_id = $1 AND from_user_id = $2 AND read = false', [myId, otherId]);
  res.json(rows);
});

app.post('/api/messages', authMiddleware, async (req, res) => {
  const { to_user_id, content } = req.body;
  if (!content || !to_user_id) return res.status(400).json({ error: 'Destinataire et message requis' });
  const { rows } = await pool.query('INSERT INTO messages (from_user_id, to_user_id, content) VALUES ($1, $2, $3) RETURNING *', [req.user.id, to_user_id, content]);
  broadcast('new-message', { ...rows[0], from_name: req.user.display_name });
  res.json(rows[0]);
});

app.get('/api/messages-unread', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`SELECT from_user_id, COUNT(*) as unread FROM messages WHERE to_user_id = $1 AND read = false GROUP BY from_user_id`, [req.user.id]);
  res.json(rows);
});

// Conversations list (admin voit tous les étudiants, étudiant voit juste l'admin)
app.get('/api/conversations', authMiddleware, async (req, res) => {
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    const { rows } = await pool.query(`SELECT u.id, u.display_name, u.avatar_url, (SELECT COUNT(*) FROM messages WHERE to_user_id = $1 AND from_user_id = u.id AND read = false) as unread,
      (SELECT content FROM messages WHERE (from_user_id = u.id AND to_user_id = $1) OR (from_user_id = $1 AND to_user_id = u.id) ORDER BY created_at DESC LIMIT 1) as last_message
      FROM users u WHERE u.role = 'student' ORDER BY unread DESC, u.display_name`, [req.user.id]);
    return res.json(rows);
  }
  // Student: find admin
  const { rows } = await pool.query(`SELECT u.id, u.display_name, u.avatar_url, (SELECT COUNT(*) FROM messages WHERE to_user_id = $1 AND from_user_id = u.id AND read = false) as unread,
    (SELECT content FROM messages WHERE (from_user_id = u.id AND to_user_id = $1) OR (from_user_id = $1 AND to_user_id = u.id) ORDER BY created_at DESC LIMIT 1) as last_message
    FROM users u WHERE u.role = 'admin' LIMIT 1`, [req.user.id]);
  res.json(rows);
});

// ============ RESOURCES ============
app.get('/api/resources', authMiddleware, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'student' && req.user.role !== 'platform_admin') return res.status(403).json({ error: 'Accès refusé' });
  const { rows } = await pool.query('SELECT id, title, category, res_type, url, file_name, description, created_at FROM resources WHERE (agency_id = $1 OR agency_id IS NULL) ORDER BY category, created_at DESC', [req.user.agency_id]);
  res.json(rows);
});

app.post('/api/resources', authMiddleware, adminOnly, async (req, res) => {
  const { title, category, res_type, url, file_data, file_name, file_mime, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Titre requis' });
  let fileBuffer = null;
  if (file_data) fileBuffer = Buffer.from(file_data.split(',')[1] || file_data, 'base64');
  const { rows } = await pool.query('INSERT INTO resources (title, category, res_type, url, file_data, file_name, file_mime, description, agency_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, title, category, res_type, url, file_name, description',
    [title, category || 'general', res_type || 'link', url, fileBuffer, file_name, file_mime, description, req.user.agency_id]);
  res.json(rows[0]);
});

app.get('/api/resources/:id/download', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT file_data, file_name, file_mime FROM resources WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  if (!rows[0] || !rows[0].file_data) return res.status(404).json({ error: 'Fichier introuvable' });
  res.set('Content-Type', rows[0].file_mime || 'application/octet-stream');
  res.set('Content-Disposition', 'attachment; filename="' + (rows[0].file_name || 'file') + '"');
  res.send(rows[0].file_data);
});

app.delete('/api/resources/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM resources WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ USER OPTIONS (scripts, comptes, types) ============
// student_user_id param: pour outreach qui gère l'outreach d'un élève, utilise les options de l'élève
app.get('/api/user-options', authMiddleware, async (req, res) => {
  let uid = req.user.id;
  if (req.query.student_user_id) {
    const sid = req.query.student_user_id;
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, sid);
    if (allowed) uid = sid;
  } else if (req.query.user_id && (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin')) {
    uid = req.query.user_id;
  }
  const { rows } = await pool.query('SELECT * FROM user_options WHERE user_id = $1 ORDER BY option_type, value', [uid]);
  const grouped = { script: [], account: [], type: [] };
  rows.forEach(r => { if (grouped[r.option_type]) grouped[r.option_type].push(r); });
  res.json(grouped);
});

app.post('/api/user-options', authMiddleware, async (req, res) => {
  const { option_type, value, student_user_id } = req.body;
  if (!option_type || !value) return res.status(400).json({ error: 'Type et valeur requis' });
  if (!['script', 'account', 'type'].includes(option_type)) return res.status(400).json({ error: 'Type invalide' });
  // Si outreach travaille pour un élève, les options sont créées sous l'ID de l'élève
  let uid = req.user.id;
  if (student_user_id) {
    const allowed = await canAccessStudentOutreach(req.user.id, req.user.role, student_user_id);
    if (allowed) uid = student_user_id;
  }
  try {
    const { rows } = await pool.query('INSERT INTO user_options (user_id, option_type, value) VALUES ($1, $2, $3) RETURNING *', [uid, option_type, value.trim()]);
    res.json(rows[0]);
  } catch (e) {
    res.status(409).json({ error: 'Cette option existe déjà' });
  }
});

app.delete('/api/user-options/:id', authMiddleware, async (req, res) => {
  // Vérifier si l'option appartient à l'utilisateur ou à un élève assigné
  const opt = (await pool.query('SELECT user_id FROM user_options WHERE id = $1', [req.params.id])).rows[0];
  if (!opt) return res.status(404).json({ error: 'Option introuvable' });
  const allowed = opt.user_id === req.user.id || req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin' || await canAccessStudentOutreach(req.user.id, req.user.role, opt.user_id);
  if (!allowed) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM user_options WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ WEEKLY OBJECTIVES ============
app.get('/api/objectives', authMiddleware, async (req, res) => {
  if (req.user.role === 'student') {
    const { rows } = await pool.query('SELECT * FROM weekly_objectives WHERE user_id = $1 ORDER BY week_start DESC, obj_type', [req.user.id]);
    return res.json(rows);
  }
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    const userId = req.query.user_id;
    const query = userId
      ? 'SELECT wo.*, u.display_name as student_name FROM weekly_objectives wo JOIN users u ON wo.user_id = u.id WHERE wo.user_id = $1 ORDER BY wo.week_start DESC, wo.obj_type'
      : 'SELECT wo.*, u.display_name as student_name FROM weekly_objectives wo JOIN users u ON wo.user_id = u.id ORDER BY wo.week_start DESC, u.display_name, wo.obj_type';
    const { rows } = await pool.query(query, userId ? [userId] : []);
    return res.json(rows);
  }
  res.status(403).json({ error: 'Accès refusé' });
});

app.post('/api/objectives', authMiddleware, adminOnly, async (req, res) => {
  const { user_id, week_start, obj_type, description, target } = req.body;
  if (!user_id || !week_start || !obj_type) return res.status(400).json({ error: 'Champs requis manquants' });
  const { rows } = await pool.query('INSERT INTO weekly_objectives (user_id, week_start, obj_type, description, target) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [user_id, week_start, obj_type, description, target || 0]);
  res.json(rows[0]);
});

app.put('/api/objectives/:id', authMiddleware, async (req, res) => {
  const { current, target, description } = req.body;
  if (req.user.role === 'student') {
    const check = await pool.query('SELECT id FROM weekly_objectives WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (check.rows.length === 0) return res.status(403).json({ error: 'Accès refusé' });
    // Élèves ne peuvent que mettre à jour le current
    await pool.query('UPDATE weekly_objectives SET current = COALESCE($1, current) WHERE id = $2', [current, req.params.id]);
  } else if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') {
    await pool.query('UPDATE weekly_objectives SET current=COALESCE($1,current), target=COALESCE($2,target), description=COALESCE($3,description) WHERE id=$4',
      [current, target, description, req.params.id]);
  } else return res.status(403).json({ error: 'Accès refusé' });
  res.json({ ok: true });
});

app.delete('/api/objectives/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM weekly_objectives WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ SERVE FRONTEND ============
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/dashboard', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.redirect('/');
  try {
    jwt.verify(token, JWT_SECRET);
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } catch {
    res.clearCookie('token');
    res.redirect('/');
  }
});

app.get('/platform', authMiddleware, (req, res) => {
  if (req.user.role !== 'platform_admin') return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'platform.html'));
});

// ============ ACTIVITY LOG ============
// ============ ONLINE PRESENCE ============
app.get('/api/online-users', authMiddleware, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.user_id, u.display_name, u.role, u.avatar_url, a.connected_at, a.last_ping
    FROM active_sessions a JOIN users u ON a.user_id = u.id
    WHERE a.last_ping > NOW() - INTERVAL '5 minutes' AND (u.agency_id = $1 OR u.agency_id IS NULL)
    ORDER BY u.display_name
  `, [req.user.agency_id]);
  res.json(rows);
});

app.get('/api/activity-log', authMiddleware, adminOnly, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 25));
  const offset = (page - 1) * limit;
  const { rows: countRows } = await pool.query('SELECT COUNT(*) as total FROM activity_log WHERE (agency_id = $1 OR agency_id IS NULL)', [req.user.agency_id]);
  const total = parseInt(countRows[0].total);
  const { rows } = await pool.query('SELECT * FROM activity_log WHERE (agency_id = $3 OR agency_id IS NULL) ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset, req.user.agency_id]);
  res.json({ data: rows, page, limit, total, totalPages: Math.ceil(total / limit) });
});

// Save notification settings & reschedule crons
app.post('/api/admin/save-notif-settings', authMiddleware, adminOnly, async (req, res) => {
  const keys = ['notif_daily_report', 'notif_weekly_report', 'notif_alert_lead_signed', 'notif_alert_lead_warm', 'notif_alert_revenue_objective', 'notif_alert_inactive_chatter', 'notif_daily_hour', 'whatsapp_extra_recipients'];
  for (const key of keys) {
    if (req.body[key] !== undefined) {
      const existing = await pool.query('SELECT id FROM settings WHERE key = $1 AND agency_id = $2', [key, req.user.agency_id]);
      if (existing.rows.length > 0) {
        await pool.query('UPDATE settings SET value = $1 WHERE key = $2 AND agency_id = $3', [String(req.body[key]), key, req.user.agency_id]);
      } else {
        await pool.query('INSERT INTO settings (key, value, agency_id) VALUES ($1, $2, $3)', [key, String(req.body[key]), req.user.agency_id]);
      }
    }
  }
  // Reschedule cron jobs with new settings
  await setupCronJobs();
  res.json({ ok: true });
});

// Test daily report
app.post('/api/admin/test-daily-report', authMiddleware, adminOnly, async (req, res) => {
  await sendDailyReport();
  res.json({ ok: true });
});

// Test weekly report
app.post('/api/admin/test-weekly-report', authMiddleware, adminOnly, async (req, res) => {
  await sendWeeklyReport();
  res.json({ ok: true });
});

// Test WhatsApp
app.post('/api/admin/test-whatsapp', authMiddleware, adminOnly, async (req, res) => {
  await sendWhatsApp('Test notification Fuzion Pilot - tout fonctionne !');
  res.json({ ok: true });
});

// ============ SHIFT CLOCK (POINTAGE) ============
app.get('/api/shift-clock', authMiddleware, async (req, res) => {
  const userId = req.query.user_id || req.user.id;
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && parseInt(userId) !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  const { rows } = await pool.query('SELECT * FROM shift_clocks WHERE user_id = $1 ORDER BY clock_in DESC LIMIT 50', [userId]);
  res.json(rows);
});

app.get('/api/shift-clock/all', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT sc.*, u.display_name as user_name FROM shift_clocks sc
    JOIN users u ON sc.user_id = u.id ORDER BY sc.clock_in DESC LIMIT 200
  `);
  res.json(rows);
});

app.post('/api/shift-clock/in', authMiddleware, async (req, res) => {
  // Check if already clocked in
  const { rows: open } = await pool.query('SELECT id FROM shift_clocks WHERE user_id = $1 AND clock_out IS NULL', [req.user.id]);
  if (open.length > 0) return res.status(400).json({ error: 'Déjà pointé' });
  const { rows } = await pool.query('INSERT INTO shift_clocks (user_id, clock_in) VALUES ($1, NOW()) RETURNING *', [req.user.id]);
  await logActivity(req.user.id, req.user.display_name, 'clock-in', 'shift', rows[0].id, null);
  res.json(rows[0]);
});

app.post('/api/shift-clock/out', authMiddleware, async (req, res) => {
  const { rows: open } = await pool.query('SELECT id, clock_in FROM shift_clocks WHERE user_id = $1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1', [req.user.id]);
  if (open.length === 0) return res.status(400).json({ error: 'Pas de pointage en cours' });
  const duration = Math.round((Date.now() - new Date(open[0].clock_in).getTime()) / 60000);
  await pool.query('UPDATE shift_clocks SET clock_out = NOW(), duration_minutes = $1 WHERE id = $2', [duration, open[0].id]);
  await logActivity(req.user.id, req.user.display_name, 'clock-out', 'shift', open[0].id, duration + ' min');
  res.json({ ok: true, duration });
});

app.get('/api/shift-clock/status', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT id, clock_in FROM shift_clocks WHERE user_id = $1 AND clock_out IS NULL LIMIT 1', [req.user.id]);
  res.json({ clocked_in: rows.length > 0, since: rows[0]?.clock_in || null });
});

// ============ MODEL REVENUE OBJECTIVES ============
app.get('/api/model-revenue-objectives', authMiddleware, async (req, res) => {
  const { rows } = await pool.query('SELECT mro.*, m.name as model_name FROM model_revenue_objectives mro JOIN models m ON mro.model_id = m.id WHERE (mro.agency_id = $1 OR mro.agency_id IS NULL) ORDER BY mro.month DESC, m.name', [req.user.agency_id]);
  res.json(rows);
});

app.post('/api/model-revenue-objectives', authMiddleware, adminOnly, async (req, res) => {
  const { model_id, month, target } = req.body;
  const { rows } = await pool.query('INSERT INTO model_revenue_objectives (model_id, month, target, agency_id) VALUES ($1,$2,$3,$4) ON CONFLICT (model_id, month) DO UPDATE SET target = EXCLUDED.target RETURNING *', [model_id, month, target || 0, req.user.agency_id]);
  res.json(rows[0]);
});

app.put('/api/model-revenue-objectives/:id', authMiddleware, adminOnly, async (req, res) => {
  const { current, target } = req.body;
  await pool.query('UPDATE model_revenue_objectives SET current = COALESCE($1, current), target = COALESCE($2, target) WHERE id = $3', [current, target, req.params.id]);
  res.json({ ok: true });
});

// ============ MODEL COCKPIT ============
app.get('/api/model-cockpit/:id', authMiddleware, async (req, res) => {
  try {
    const modelId = parseInt(req.params.id);
    const { rows: modelRows } = await pool.query('SELECT * FROM models WHERE id = $1', [modelId]);
    if (modelRows.length === 0) return res.status(404).json({ error: 'Modèle introuvable' });
    const model = modelRows[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const currentMonth = todayStr.slice(0, 7);

    // Accounts & followers
    const { rows: accounts } = await pool.query('SELECT * FROM accounts WHERE model_id = $1 ORDER BY platform', [modelId]);
    const totalFollowers = accounts.reduce((s, a) => s + (a.current_followers || 0), 0);

    // Revenue today
    const { rows: revToday } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total),0) as ppv, COALESCE(SUM(tips_total),0) as tips FROM chatter_shifts WHERE model_name = $1 AND date = $2",
      [model.name, todayStr]
    );
    const revenueToday = parseFloat(revToday[0].ppv) + parseFloat(revToday[0].tips);

    // Revenue this month
    const { rows: revMonth } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total),0) as ppv, COALESCE(SUM(tips_total),0) as tips FROM chatter_shifts WHERE model_name = $1 AND date >= $2",
      [model.name, currentMonth + '-01']
    );
    const revenueMonth = parseFloat(revMonth[0].ppv) + parseFloat(revMonth[0].tips);
    const ppvMonth = parseFloat(revMonth[0].ppv);
    const tipsMonth = parseFloat(revMonth[0].tips);

    // Revenue objective this month
    const { rows: objRows } = await pool.query(
      'SELECT * FROM model_revenue_objectives WHERE model_id = $1 AND month = $2', [modelId, currentMonth]
    );
    const objective = objRows[0] || { target: 0, current: 0 };

    // Revenue last 30 days (daily)
    const { rows: rev30 } = await pool.query(
      "SELECT date, SUM(ppv_total) as ppv, SUM(tips_total) as tips FROM chatter_shifts WHERE model_name = $1 AND date >= (CURRENT_DATE - INTERVAL '30 days')::date::text GROUP BY date ORDER BY date",
      [model.name]
    );

    // Revenue last 3 months (weekly)
    const { rows: revWeekly } = await pool.query(
      "SELECT date_trunc('week', date::date)::date::text as week, SUM(ppv_total) as ppv, SUM(tips_total) as tips FROM chatter_shifts WHERE model_name = $1 AND date >= (CURRENT_DATE - INTERVAL '3 months')::date::text GROUP BY week ORDER BY week",
      [model.name]
    );

    // Assigned team members
    const { rows: team } = await pool.query(
      "SELECT tm.*, u.id as user_id FROM team_members tm LEFT JOIN users u ON tm.user_id = u.id WHERE tm.role = 'chatter' ORDER BY tm.name"
    );
    const assignedTeam = team.filter(t => {
      try { return JSON.parse(t.models_assigned || '[]').includes(model.name); } catch { return false; }
    });

    // Online status
    const { rows: online } = await pool.query("SELECT user_id FROM active_sessions WHERE last_ping > NOW() - INTERVAL '5 minutes'");
    const onlineIds = online.map(o => o.user_id);

    // Team member revenue this month on this model
    const { rows: teamRev } = await pool.query(
      "SELECT user_id, SUM(ppv_total + tips_total) as revenue, COUNT(*) as shifts FROM chatter_shifts WHERE model_name = $1 AND date >= $2 GROUP BY user_id",
      [model.name, currentMonth + '-01']
    );
    const teamRevMap = {};
    teamRev.forEach(r => { teamRevMap[r.user_id] = { revenue: parseFloat(r.revenue), shifts: parseInt(r.shifts) }; });

    // Today's shift clocks for assigned chatters
    const { rows: todayClocks } = await pool.query(
      "SELECT user_id, clock_in, clock_out, duration_minutes FROM shift_clocks WHERE clock_in::date = CURRENT_DATE ORDER BY clock_in"
    );

    // Recent activity (last 20 related to this model)
    const { rows: activity } = await pool.query(
      "SELECT * FROM activity_log WHERE details ILIKE $1 ORDER BY created_at DESC LIMIT 20",
      ['%' + model.name + '%']
    );

    // Also get recent shifts as activity
    const { rows: recentShifts } = await pool.query(
      "SELECT cs.*, u.display_name as chatter_name FROM chatter_shifts cs JOIN users u ON cs.user_id = u.id WHERE cs.model_name = $1 ORDER BY cs.created_at DESC LIMIT 10",
      [model.name]
    );

    res.json({
      model, accounts, totalFollowers,
      revenueToday, ppvToday: parseFloat(revToday[0].ppv), tipsToday: parseFloat(revToday[0].tips),
      revenueMonth, ppvMonth, tipsMonth,
      objective: { target: parseFloat(objective.target), current: parseFloat(objective.current) },
      rev30, revWeekly,
      assignedTeam: assignedTeam.map(t => ({
        ...t,
        online: onlineIds.includes(t.user_id),
        monthRevenue: teamRevMap[t.user_id]?.revenue || 0,
        monthShifts: teamRevMap[t.user_id]?.shifts || 0,
        todayClocks: todayClocks.filter(c => c.user_id === t.user_id)
      })),
      activity, recentShifts
    });
  } catch(e) {
    console.error('Cockpit error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============ PAYMENTS ============
app.get('/api/payments', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT p.*, m.name as model_name FROM payments p JOIN models m ON p.model_id = m.id WHERE (p.agency_id = $1 OR p.agency_id IS NULL) ORDER BY p.month DESC, m.name', [req.user.agency_id]);
  res.json(rows);
});

app.post('/api/payments', authMiddleware, adminOnly, async (req, res) => {
  const { model_id, month, amount, status, notes } = req.body;
  const { rows } = await pool.query('INSERT INTO payments (model_id, month, amount, status, notes, agency_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [model_id, month, amount || 0, status || 'pending', notes, req.user.agency_id]);
  res.json(rows[0]);
});

app.put('/api/payments/:id', authMiddleware, adminOnly, async (req, res) => {
  const { amount, status, notes } = req.body;
  await pool.query('UPDATE payments SET amount = COALESCE($1, amount), status = COALESCE($2, status), notes = COALESCE($3, notes) WHERE id = $4 AND agency_id = $5', [amount, status, notes, req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

app.delete('/api/payments/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM payments WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ ANALYTICS ============
app.get('/api/analytics/daily', authMiddleware, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const isOwner = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin';
    let userFilter, params;

    if (isOwner) {
      // Admin: query outreach_leads table (their own outreach page)
      const aid = req.user.agency_id;
      const { rows: daily } = await pool.query(`
        SELECT ol.created_at::date as day, COUNT(*) as leads,
          COUNT(*) FILTER (WHERE ol.status != 'to-send') as dms
        FROM outreach_leads ol WHERE (ol.agency_id = $1 OR ol.agency_id IS NULL)
          AND ol.created_at > NOW() - INTERVAL '${days} days'
        GROUP BY day ORDER BY day
      `, [aid]);

      const { rows: hourly } = await pool.query(`
        SELECT EXTRACT(HOUR FROM ol.created_at) as hour, COUNT(*) as leads,
          COUNT(*) FILTER (WHERE ol.status != 'to-send') as dms
        FROM outreach_leads ol WHERE (ol.agency_id = $1 OR ol.agency_id IS NULL)
          AND ol.created_at > NOW() - INTERVAL '${days} days'
        GROUP BY hour ORDER BY hour
      `, [aid]);

      const { rows: byPerson } = await pool.query(`
        SELECT u.display_name as name, ol.user_id,
          COUNT(*) as leads, COUNT(*) FILTER (WHERE ol.status != 'to-send') as dms
        FROM outreach_leads ol LEFT JOIN users u ON ol.user_id = u.id
        WHERE (ol.agency_id = $1 OR ol.agency_id IS NULL)
          AND ol.created_at > NOW() - INTERVAL '${days} days'
        GROUP BY u.display_name, ol.user_id ORDER BY leads DESC
      `, [aid]);

      const { rows: todayByPerson } = await pool.query(`
        SELECT u.display_name as name, ol.user_id,
          COUNT(*) as leads, COUNT(*) FILTER (WHERE ol.status != 'to-send') as dms
        FROM outreach_leads ol LEFT JOIN users u ON ol.user_id = u.id
        WHERE (ol.agency_id = $1 OR ol.agency_id IS NULL)
          AND ol.created_at::date = CURRENT_DATE
        GROUP BY u.display_name, ol.user_id ORDER BY leads DESC
      `, [aid]);

      return res.json({ daily, hourly, byPerson, todayByPerson });
    }

    // Students: query student_leads table (their own outreach)
    var sIds = await getSharedOutreachIds(req.user.id);
    var sParams = [req.user.agency_id, sIds];
    var sFilter = 'u.agency_id = $1 AND sl.user_id = ANY($2)';

    var sDaily = (await pool.query(`
      SELECT sl.created_at::date as day, COUNT(*) as leads,
        COUNT(*) FILTER (WHERE sl.status != 'to-send') as dms
      FROM student_leads sl JOIN users u ON sl.user_id = u.id
      WHERE ${sFilter} AND sl.created_at > NOW() - INTERVAL '${days} days'
      GROUP BY day ORDER BY day
    `, sParams)).rows;

    var sHourly = (await pool.query(`
      SELECT EXTRACT(HOUR FROM sl.created_at) as hour, COUNT(*) as leads,
        COUNT(*) FILTER (WHERE sl.status != 'to-send') as dms
      FROM student_leads sl JOIN users u ON sl.user_id = u.id
      WHERE ${sFilter} AND sl.created_at > NOW() - INTERVAL '${days} days'
      GROUP BY hour ORDER BY hour
    `, sParams)).rows;

    var sByPerson = (await pool.query(`
      SELECT ab.display_name as name, sl.added_by as user_id,
        COUNT(*) as leads, COUNT(*) FILTER (WHERE sl.status != 'to-send') as dms
      FROM student_leads sl JOIN users u ON sl.user_id = u.id
      LEFT JOIN users ab ON sl.added_by = ab.id
      WHERE ${sFilter} AND sl.created_at > NOW() - INTERVAL '${days} days'
      GROUP BY ab.display_name, sl.added_by ORDER BY leads DESC
    `, sParams)).rows;

    var sTodayByPerson = (await pool.query(`
      SELECT ab.display_name as name, sl.added_by as user_id,
        COUNT(*) as leads, COUNT(*) FILTER (WHERE sl.status != 'to-send') as dms
      FROM student_leads sl JOIN users u ON sl.user_id = u.id
      LEFT JOIN users ab ON sl.added_by = ab.id
      WHERE ${sFilter} AND sl.created_at::date = CURRENT_DATE
      GROUP BY ab.display_name, sl.added_by ORDER BY leads DESC
    `, sParams)).rows;

    res.json({ daily: sDaily, hourly: sHourly, byPerson: sByPerson, todayByPerson: sTodayByPerson });
  } catch(e) { res.json({ daily: [], hourly: [], byPerson: [] }); }
});

app.get('/api/analytics/reply-rate-weekly', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT date_trunc('week', sl.created_at)::date as week,
      COUNT(*) FILTER (WHERE sl.status != 'to-send') as dm_sent,
      COUNT(*) FILTER (WHERE sl.status IN ('talking-cold','talking-warm','call-booked','signed')) as replies
    FROM student_leads sl JOIN users u ON sl.user_id = u.id
    WHERE u.agency_id = $1 AND sl.created_at > NOW() - INTERVAL '12 weeks'
    GROUP BY week ORDER BY week
  `, [req.user.agency_id]);
  res.json(rows);
});

app.get('/api/analytics/assistant-ranking', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT u.display_name as name, u.id,
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE sl.status != 'to-send') as dms_sent,
      COUNT(*) FILTER (WHERE sl.status IN ('talking-cold','talking-warm','call-booked','signed')) as replies,
      COUNT(*) FILTER (WHERE sl.status = 'signed') as signed
    FROM student_leads sl JOIN users u ON sl.added_by = u.id
    WHERE u.role = 'outreach' AND u.agency_id = $1
    GROUP BY u.id, u.display_name ORDER BY signed DESC, replies DESC
  `, [req.user.agency_id]);
  res.json(rows);
});

app.get('/api/analytics/hourly', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT EXTRACT(HOUR FROM sl.sent_at) as hour, COUNT(*) as count
    FROM student_leads sl JOIN users u ON sl.user_id = u.id
    WHERE sl.sent_at IS NOT NULL AND sl.sent_at > NOW() - INTERVAL '30 days' AND u.agency_id = $1
    GROUP BY hour ORDER BY hour
  `, [req.user.agency_id]);
  res.json(rows);
});

app.get('/api/analytics/fr-vs-us', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT COALESCE(sl.market, 'fr') as market,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE sl.status != 'to-send') as dm_sent,
      COUNT(*) FILTER (WHERE sl.status IN ('talking-cold','talking-warm','call-booked','signed')) as replies,
      COUNT(*) FILTER (WHERE sl.status = 'signed') as signed
    FROM student_leads sl JOIN users u ON sl.user_id = u.id
    WHERE u.agency_id = $1
    GROUP BY sl.market
  `, [req.user.agency_id]);
  res.json(rows);
});

// ============ EXPORT CSV ============
app.get('/api/export/leads', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT sl.username, sl.ig_link, sl.lead_type, sl.status, sl.script_used, sl.ig_account_used,
      sl.notes, sl.market, sl.created_at, sl.sent_at, u.display_name as student_name,
      ab.display_name as added_by_name
    FROM student_leads sl JOIN users u ON sl.user_id = u.id
    LEFT JOIN users ab ON sl.added_by = ab.id
    WHERE u.agency_id = $1
    ORDER BY sl.created_at DESC
  `, [req.user.agency_id]);
  let csv = 'Username,Lien IG,Type,Statut,Script,Compte,Notes,Marché,Date,Envoyé,Élève,Ajouté par\n';
  rows.forEach(r => {
    csv += [r.username, r.ig_link||'', r.lead_type||'', r.status, r.script_used||'', r.ig_account_used||'',
      (r.notes||'').replace(/,/g,';'), r.market||'fr', r.created_at, r.sent_at||'', r.student_name, r.added_by_name||''].map(v => '"'+v+'"').join(',') + '\n';
  });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="leads_export.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/export/team', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT display_name, username, role FROM users ORDER BY role, display_name');
  let csv = 'Nom,Identifiant,Rôle\n';
  rows.forEach(r => { csv += '"' + r.display_name + '","' + r.username + '","' + r.role + '"\n'; });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="equipe_export.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/export/students', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query('SELECT s.name, s.program, s.progression_step, s.models_signed, s.start_date, u.username FROM students s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.name');
  let csv = 'Nom,Programme,Étape,Modèles signés,Date début,Identifiant\n';
  rows.forEach(r => { csv += '"' + r.name + '","' + r.program + '","' + (r.progression_step||'') + '",' + (r.models_signed||0) + ',"' + (r.start_date||'') + '","' + (r.username||'') + '"\n'; });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="eleves_export.csv"');
  res.send('\uFEFF' + csv);
});

app.get('/api/export/revenue', authMiddleware, adminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.month, m.name as model_name, p.amount, p.status, p.notes
    FROM payments p JOIN models m ON p.model_id = m.id ORDER BY p.month DESC, m.name
  `);
  let csv = 'Mois,Modèle,Montant,Statut,Notes\n';
  rows.forEach(r => { csv += '"' + r.month + '","' + r.model_name + '",' + r.amount + ',"' + r.status + '","' + (r.notes||'') + '"\n'; });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="revenus_export.csv"');
  res.send('\uFEFF' + csv);
});

// ============ DB STORAGE INFO ============
app.get('/api/admin/db-size', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT pg_database_size(current_database()) as size");
    const { rows: tables } = await pool.query(`
      SELECT relname as table_name, n_live_tup as row_count
      FROM pg_stat_user_tables ORDER BY n_live_tup DESC
    `);
    res.json({ total_bytes: parseInt(rows[0].size), tables });
  } catch(e) { res.json({ total_bytes: 0, tables: [] }); }
});

// ============ DB DIAGNOSTIC ============
app.get('/api/admin/db-check', authMiddleware, adminOnly, async (req, res) => {
  try {
    const checks = {};
    const tables = ['users', 'models', 'outreach_leads', 'tasks', 'chatter_shifts', 'students', 'team_members', 'settings', 'resources', 'planning_shifts'];
    for (const t of tables) {
      try {
        const { rows } = await pool.query(`SELECT COUNT(*) as total, COUNT(agency_id) as with_agency, COUNT(*) - COUNT(agency_id) as without_agency FROM ${t}`);
        checks[t] = rows[0];
      } catch(e) { checks[t] = { error: e.message }; }
    }
    const { rows: agencyList } = await pool.query('SELECT id, name, active FROM agencies ORDER BY id');
    res.json({ tables: checks, agencies: agencyList, your_agency_id: req.user.agency_id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ USER ACCESS MANAGEMENT ============
app.put('/api/users/:id/access', authMiddleware, adminOnly, async (req, res) => {
  const { read_only, expires_at } = req.body;
  await pool.query('UPDATE users SET read_only = COALESCE($1, read_only), expires_at = $2 WHERE id = $3',
    [read_only, expires_at || null, req.params.id]);
  res.json({ ok: true });
});

// ============ DUPLICATE CHECK ============
app.post('/api/student-leads/check-duplicates', authMiddleware, async (req, res) => {
  const { usernames, student_user_id, market } = req.body;
  if (!usernames || !Array.isArray(usernames)) return res.status(400).json({ error: 'Liste de usernames requise' });
  const uid = student_user_id || req.user.id;
  const sharedIds = await getSharedOutreachIds(uid);
  const mkt = market === 'us' ? 'us' : 'fr';
  const { rows } = await pool.query(
    "SELECT LOWER(REPLACE(username, '@', '')) as clean FROM student_leads WHERE user_id = ANY($1) AND COALESCE(market,'fr') = $2",
    [sharedIds, mkt]
  );
  const existing = new Set(rows.map(r => r.clean.toLowerCase()));
  const duplicates = usernames.filter(u => existing.has(u.replace(/^@/, '').toLowerCase()));
  res.json({ duplicates, total: usernames.length, duplicate_count: duplicates.length });
});

// ============ PLANNING SHIFTS ============
app.get('/api/planning-shifts', authMiddleware, async (req, res) => {
  const { start, end, user_id } = req.query;
  let query = `SELECT ps.*, u.display_name as user_name, u.role as user_role
    FROM planning_shifts ps JOIN users u ON ps.user_id = u.id WHERE 1=1`;
  const params = [];

  if (req.user.role === 'student') {
    const sharedIds = await getSharedOutreachIds(req.user.id);
    params.push(sharedIds);
    query += ` AND ps.user_id = ANY($${params.length})`;
  } else if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin') {
    params.push(req.user.id);
    query += ` AND ps.user_id = $${params.length}`;
  } else if (user_id) {
    params.push(user_id);
    query += ` AND ps.user_id = $${params.length}`;
  }
  params.push(req.user.agency_id);
  query += ` AND (ps.agency_id = $${params.length} OR ps.agency_id IS NULL)`;
  if (start) { params.push(start); query += ` AND ps.shift_date >= $${params.length}`; }
  if (end) { params.push(end); query += ` AND ps.shift_date <= $${params.length}`; }
  query += ' ORDER BY ps.shift_date, ps.start_time';

  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.post('/api/planning-shifts', authMiddleware, async (req, res) => {
  const { shift_date, shift_type, start_time, end_time, model_ids, notes, user_id, entry_type, priority, description } = req.body;
  if (!shift_date) return res.status(400).json({ error: 'Date requise' });

  let ownerId = req.user.id;
  if ((req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin') && user_id) ownerId = user_id;

  const { rows } = await pool.query(
    'INSERT INTO planning_shifts (user_id, shift_date, shift_type, start_time, end_time, model_ids, notes, entry_type, priority, description, agency_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
    [ownerId, shift_date, shift_type || 'custom', start_time, end_time, JSON.stringify(model_ids || []), notes, entry_type || 'shift', priority || 'normal', description, req.user.agency_id]
  );
  broadcast('planning-updated', {});
  res.json(rows[0]);
});

app.put('/api/planning-shifts/:id', authMiddleware, async (req, res) => {
  const { shift_type, start_time, end_time, model_ids, notes, entry_type, priority, description } = req.body;
  const shift = (await pool.query('SELECT user_id FROM planning_shifts WHERE id = $1', [req.params.id])).rows[0];
  if (!shift) return res.status(404).json({ error: 'Shift introuvable' });
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin' && shift.user_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

  await pool.query(`UPDATE planning_shifts SET
    shift_type = COALESCE($1, shift_type), start_time = COALESCE($2, start_time),
    end_time = COALESCE($3, end_time), model_ids = COALESCE($4, model_ids),
    notes = COALESCE($5, notes), entry_type = COALESCE($7, entry_type),
    priority = COALESCE($8, priority), description = COALESCE($9, description) WHERE id = $6 AND agency_id = $10`,
    [shift_type, start_time, end_time, model_ids ? JSON.stringify(model_ids) : null, notes, req.params.id, entry_type, priority, description, req.user.agency_id]);
  broadcast('planning-updated', {});
  res.json({ ok: true });
});

app.delete('/api/planning-shifts/:id', authMiddleware, async (req, res) => {
  const shift = (await pool.query('SELECT user_id FROM planning_shifts WHERE id = $1', [req.params.id])).rows[0];
  if (!shift) return res.status(404).json({ error: 'Shift introuvable' });
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin' && shift.user_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM planning_shifts WHERE id = $1', [req.params.id]);
  broadcast('planning-updated', {});
  res.json({ ok: true });
});

// ============ LEAVE REQUESTS (CONGÉS) ============
app.get('/api/leave-requests', authMiddleware, async (req, res) => {
  let query, params;
  if (req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin' || req.user.role === 'platform_admin') {
    query = `SELECT lr.*, u.display_name as user_name, u.role as user_role
      FROM leave_requests lr JOIN users u ON lr.user_id = u.id WHERE (lr.agency_id = $1 OR lr.agency_id IS NULL) ORDER BY lr.created_at DESC`;
    params = [req.user.agency_id];
  } else {
    query = `SELECT lr.*, u.display_name as user_name, u.role as user_role
      FROM leave_requests lr JOIN users u ON lr.user_id = u.id WHERE lr.user_id = $1 ORDER BY lr.created_at DESC`;
    params = [req.user.id];
  }
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

app.post('/api/leave-requests', authMiddleware, async (req, res) => {
  const { start_date, end_date, reason } = req.body;
  if (!start_date || !end_date) return res.status(400).json({ error: 'Dates requises' });
  const { rows } = await pool.query(
    'INSERT INTO leave_requests (user_id, start_date, end_date, reason, agency_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.user.id, start_date, end_date, reason, req.user.agency_id]
  );
  // WhatsApp notification
  sendWhatsApp('🏖️ Demande de congé de ' + req.user.display_name + ' du ' + start_date + ' au ' + end_date);
  await logActivity(req.user.id, req.user.display_name, 'leave-request', 'leave', rows[0].id, start_date + ' → ' + end_date);
  broadcast('leave-request-new', rows[0]);
  res.json(rows[0]);
});

app.put('/api/leave-requests/:id', authMiddleware, adminOnly, async (req, res) => {
  const { status, admin_notes } = req.body;
  await pool.query('UPDATE leave_requests SET status = COALESCE($1, status), admin_notes = COALESCE($2, admin_notes) WHERE id = $3 AND agency_id = $4',
    [status, admin_notes, req.params.id, req.user.agency_id]);
  const lr = (await pool.query('SELECT lr.*, u.display_name as user_name FROM leave_requests lr JOIN users u ON lr.user_id = u.id WHERE lr.id = $1', [req.params.id])).rows[0];
  if (lr) {
    broadcast('leave-request-updated', { id: parseInt(req.params.id), status });
    await logActivity(req.user.id, req.user.display_name, 'leave-' + status, 'leave', parseInt(req.params.id), lr.user_name);
  }
  res.json({ ok: true });
});

app.delete('/api/leave-requests/:id', authMiddleware, async (req, res) => {
  const lr = (await pool.query('SELECT user_id FROM leave_requests WHERE id = $1', [req.params.id])).rows[0];
  if (!lr) return res.status(404).json({ error: 'Introuvable' });
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.role !== 'platform_admin' && lr.user_id !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });
  await pool.query('DELETE FROM leave_requests WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ============ PLANNING STATS ============
app.get('/api/planning-stats', authMiddleware, adminOnly, async (req, res) => {
  const { start, end } = req.query;
  // Hours planned from planning_shifts
  const { rows: planned } = await pool.query(`
    SELECT ps.user_id, u.display_name as user_name, u.role as user_role,
      COUNT(*) as shift_count,
      SUM(
        CASE WHEN ps.start_time IS NOT NULL AND ps.end_time IS NOT NULL THEN
          EXTRACT(EPOCH FROM (ps.end_time::time - ps.start_time::time)) / 3600
        ELSE 8 END
      ) as planned_hours
    FROM planning_shifts ps JOIN users u ON ps.user_id = u.id
    WHERE ($1::date IS NULL OR ps.shift_date >= $1::date)
      AND ($2::date IS NULL OR ps.shift_date <= $2::date)
      AND ps.shift_type != 'off'
    GROUP BY ps.user_id, u.display_name, u.role
    ORDER BY u.display_name
  `, [start || null, end || null]);

  // Hours actually worked from shift_clocks
  const { rows: actual } = await pool.query(`
    SELECT sc.user_id, SUM(sc.duration_minutes) as total_minutes
    FROM shift_clocks sc
    WHERE sc.clock_out IS NOT NULL
      AND ($1::date IS NULL OR sc.clock_in::date >= $1::date)
      AND ($2::date IS NULL OR sc.clock_in::date <= $2::date)
    GROUP BY sc.user_id
  `, [start || null, end || null]);

  const actualMap = {};
  actual.forEach(a => { actualMap[a.user_id] = parseInt(a.total_minutes || 0); });

  const result = planned.map(p => ({
    ...p,
    planned_hours: parseFloat(p.planned_hours || 0).toFixed(1),
    actual_hours: ((actualMap[p.user_id] || 0) / 60).toFixed(1),
    actual_minutes: actualMap[p.user_id] || 0
  }));

  // Add users with clock data but no planning
  actual.forEach(a => {
    if (!result.find(r => r.user_id === a.user_id)) {
      result.push({ user_id: a.user_id, user_name: 'Utilisateur #' + a.user_id, shift_count: 0, planned_hours: '0.0', actual_hours: (parseInt(a.total_minutes) / 60).toFixed(1), actual_minutes: parseInt(a.total_minutes) });
    }
  });

  res.json(result);
});

// ============ AGENCY SETTINGS ============
app.get('/api/agency', authMiddleware, async (req, res) => {
  if (!req.user.agency_id) return res.status(400).json({ error: 'Pas d\'agence associée' });
  const { rows } = await pool.query('SELECT * FROM agencies WHERE id = $1', [req.user.agency_id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Agence introuvable' });
  const agency = rows[0];
  // Get counts
  const users = (await pool.query('SELECT COUNT(*) as count FROM users WHERE (agency_id = $1 OR agency_id IS NULL)', [req.user.agency_id])).rows[0].count;
  const models = (await pool.query('SELECT COUNT(*) as count FROM models WHERE (agency_id = $1 OR agency_id IS NULL)', [req.user.agency_id])).rows[0].count;
  const leads = (await pool.query('SELECT COUNT(*) as count FROM outreach_leads WHERE (agency_id = $1 OR agency_id IS NULL)', [req.user.agency_id])).rows[0].count;
  res.json({ ...agency, user_count: parseInt(users), model_count: parseInt(models), lead_count: parseInt(leads) });
});

app.put('/api/agency', authMiddleware, async (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin' && req.user.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const { name, logo_url, primary_color } = req.body;
  await pool.query('UPDATE agencies SET name = COALESCE($1, name), logo_url = COALESCE($2, logo_url), primary_color = COALESCE($3, primary_color) WHERE id = $4',
    [name, logo_url, primary_color, req.user.agency_id]);
  res.json({ ok: true });
});

// ============ RECRUITMENT MODULE ============

// Settings
app.get('/api/recruitment/settings', authMiddleware, async (req, res) => {
  try {
    let { rows } = await pool.query('SELECT * FROM recruitment_settings WHERE agency_id = $1', [req.user.agency_id]);
    if (rows.length === 0) {
      await pool.query('INSERT INTO recruitment_settings (agency_id) VALUES ($1) ON CONFLICT (agency_id) DO NOTHING', [req.user.agency_id]);
      rows = (await pool.query('SELECT * FROM recruitment_settings WHERE agency_id = $1', [req.user.agency_id])).rows;
    }
    res.json(rows[0] || { enabled: false, coaching_price: 1500 });
  } catch(e) { res.json({ enabled: false, coaching_price: 1500 }); }
});

app.patch('/api/recruitment/settings', authMiddleware, adminOnly, async (req, res) => {
  const { enabled, coaching_price } = req.body;
  try {
    await pool.query(
      `INSERT INTO recruitment_settings (agency_id, enabled, coaching_price) VALUES ($1, $2, $3)
       ON CONFLICT (agency_id) DO UPDATE SET enabled = COALESCE($2, recruitment_settings.enabled), coaching_price = COALESCE($3, recruitment_settings.coaching_price), updated_at = NOW()`,
      [req.user.agency_id, enabled, coaching_price]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// Recruiters
app.get('/api/recruitment/recruiters', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, u.display_name, u.username,
        (SELECT COUNT(*) FROM recruitment_leads WHERE recruiter_id = r.id) as lead_count,
        (SELECT COUNT(*) FROM recruitment_leads WHERE recruiter_id = r.id AND status = 'paye') as paid_count
      FROM recruiters r JOIN users u ON r.user_id = u.id
      WHERE r.agency_id = $1 ORDER BY r.created_at DESC
    `, [req.user.agency_id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/recruitment/recruiters', authMiddleware, adminOnly, async (req, res) => {
  const { user_id, commission_percentage } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO recruiters (agency_id, user_id, commission_percentage) VALUES ($1, $2, $3) RETURNING *',
      [req.user.agency_id, user_id, commission_percentage || 10]
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/recruitment/recruiters/:id', authMiddleware, adminOnly, async (req, res) => {
  const { commission_percentage, is_active } = req.body;
  try {
    await pool.query(
      'UPDATE recruiters SET commission_percentage = COALESCE($1, commission_percentage), is_active = COALESCE($2, is_active), updated_at = NOW() WHERE id = $3 AND agency_id = $4',
      [commission_percentage, is_active, req.params.id, req.user.agency_id]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/recruitment/recruiters/:id', authMiddleware, adminOnly, async (req, res) => {
  await pool.query('DELETE FROM recruiters WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  res.json({ ok: true });
});

// Leads
app.get('/api/recruitment/leads', authMiddleware, async (req, res) => {
  try {
    const isOwner = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin';
    let query = `SELECT rl.*, r.commission_percentage, u.display_name as recruiter_name
      FROM recruitment_leads rl
      JOIN recruiters r ON rl.recruiter_id = r.id
      JOIN users u ON r.user_id = u.id
      WHERE rl.agency_id = $1`;
    const params = [req.user.agency_id];
    if (!isOwner) {
      // Get paired user IDs then find all their recruiter IDs
      const sharedIds = await getSharedOutreachIds(req.user.id);
      const recruiterRows = (await pool.query('SELECT id FROM recruiters WHERE user_id = ANY($1) AND agency_id = $2', [sharedIds, req.user.agency_id])).rows;
      if (recruiterRows.length === 0) return res.json([]);
      const recruiterIds = recruiterRows.map(r => r.id);
      params.push(recruiterIds);
      query += ' AND rl.recruiter_id = ANY($2)';
    }
    query += ' ORDER BY rl.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/recruitment/leads', authMiddleware, async (req, res) => {
  const { prospect_name, prospect_pseudo, platform, notes } = req.body;
  if (!prospect_pseudo) return res.status(400).json({ error: 'Pseudo requis' });
  try {
    const isOwner = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin';
    // Find recruiter_id: explicit body param > user's own recruiter row > first active recruiter (admin only)
    let recruiterId = null;
    if (req.body.recruiter_id) {
      // Verify the recruiter belongs to this agency
      const check = (await pool.query('SELECT id FROM recruiters WHERE id = $1 AND agency_id = $2', [req.body.recruiter_id, req.user.agency_id])).rows[0];
      if (check) recruiterId = check.id;
    }
    if (!recruiterId) {
      const ownRecruiter = (await pool.query('SELECT id FROM recruiters WHERE user_id = $1 AND agency_id = $2 AND is_active = true', [req.user.id, req.user.agency_id])).rows[0];
      recruiterId = ownRecruiter?.id;
    }
    if (!recruiterId && isOwner) {
      const first = (await pool.query('SELECT id FROM recruiters WHERE agency_id = $1 AND is_active = true ORDER BY id LIMIT 1', [req.user.agency_id])).rows[0];
      recruiterId = first?.id;
    }
    if (!recruiterId) return res.status(403).json({ error: isOwner ? 'Ajoutez d\'abord un recruteur' : 'Not a recruiter' });
    const { rows } = await pool.query(
      'INSERT INTO recruitment_leads (agency_id, recruiter_id, prospect_name, prospect_pseudo, platform, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.agency_id, recruiterId, prospect_name || '', prospect_pseudo, platform || 'instagram', notes || '']
    );
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/recruitment/leads/:id', authMiddleware, async (req, res) => {
  const { status, call_recruiter, call_owner, notes } = req.body;
  const isOwner = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin';
  try {
    // Verify ownership
    const lead = (await pool.query('SELECT rl.*, r.user_id as recruiter_user_id FROM recruitment_leads rl JOIN recruiters r ON rl.recruiter_id = r.id WHERE rl.id = $1 AND rl.agency_id = $2', [req.params.id, req.user.agency_id])).rows[0];
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!isOwner && lead.recruiter_user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    // Recruiters cannot set call_owner
    const updates = ['updated_at = NOW()'];
    const vals = [];
    let idx = 1;
    if (status !== undefined) { updates.push('status = $' + idx); vals.push(status); idx++; }
    if (call_recruiter !== undefined) { updates.push('call_recruiter = $' + idx); vals.push(call_recruiter); idx++; }
    if (isOwner && call_owner !== undefined) { updates.push('call_owner = $' + idx); vals.push(call_owner); idx++; }
    if (notes !== undefined) { updates.push('notes = $' + idx); vals.push(notes); idx++; }
    vals.push(req.params.id);
    await pool.query('UPDATE recruitment_leads SET ' + updates.join(', ') + ' WHERE id = $' + idx, vals);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/recruitment/leads/:id', authMiddleware, async (req, res) => {
  const isOwner = req.user.role === 'admin' || req.user.role === 'super_admin' || req.user.role === 'platform_admin';
  if (isOwner) {
    await pool.query('DELETE FROM recruitment_leads WHERE id = $1 AND agency_id = $2', [req.params.id, req.user.agency_id]);
  } else {
    await pool.query('DELETE FROM recruitment_leads WHERE id = $1 AND agency_id = $2 AND recruiter_id IN (SELECT id FROM recruiters WHERE user_id = $3)', [req.params.id, req.user.agency_id, req.user.id]);
  }
  res.json({ ok: true });
});

// Stats
app.get('/api/recruitment/stats', authMiddleware, async (req, res) => {
  try {
    const settings = (await pool.query('SELECT coaching_price FROM recruitment_settings WHERE agency_id = $1', [req.user.agency_id])).rows[0];
    const price = parseFloat(settings?.coaching_price || 1500);
    const { rows } = await pool.query(`
      SELECT status, COUNT(*) as count FROM recruitment_leads WHERE agency_id = $1 GROUP BY status
    `, [req.user.agency_id]);
    const byStatus = {};
    let total = 0;
    rows.forEach(r => { byStatus[r.status] = parseInt(r.count); total += parseInt(r.count); });
    const paid = byStatus['paye'] || 0;
    const revenue = paid * price;
    // Commission totals
    const commResult = await pool.query(`
      SELECT SUM(r.commission_percentage) as total_comm_pct, COUNT(*) as paid_count
      FROM recruitment_leads rl JOIN recruiters r ON rl.recruiter_id = r.id
      WHERE rl.agency_id = $1 AND rl.status = 'paye'
    `, [req.user.agency_id]);
    const commissions = commResult.rows[0]?.paid_count > 0
      ? (await pool.query(`SELECT SUM(r.commission_percentage * $2 / 100) as total FROM recruitment_leads rl JOIN recruiters r ON rl.recruiter_id = r.id WHERE rl.agency_id = $1 AND rl.status = 'paye'`, [req.user.agency_id, price])).rows[0]?.total || 0
      : 0;
    res.json({ total, byStatus, paid, revenue, commissions: parseFloat(commissions), coaching_price: price });
  } catch(e) { res.json({ total: 0, byStatus: {}, paid: 0, revenue: 0, commissions: 0, coaching_price: 1500 }); }
});

// ============ AGENCY ONBOARDING ============
app.get('/api/agency/onboarding-status', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT name, onboarding_completed, country, timezone, currency, service_type,
        models_count, chatters_count, target_markets, founded_at, contact_email, phone,
        legal_name, address_street, address_city, address_zip, address_country, vat_number,
        default_work_start, default_work_end, work_days, language, email_notifications_enabled,
        logo_url, primary_color
      FROM agencies WHERE id = $1`, [req.user.agency_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Agence introuvable' });
    res.json(rows[0]);
  } catch(e) {
    console.error('Onboarding status error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.put('/api/agency/onboarding/draft', authMiddleware, async (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin' && req.user.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const fields = ['name', 'logo_url', 'primary_color', 'country', 'timezone', 'currency',
    'service_type', 'models_count', 'chatters_count', 'target_markets', 'founded_at',
    'contact_email', 'phone', 'legal_name', 'address_street', 'address_city',
    'address_zip', 'address_country', 'vat_number', 'default_work_start', 'default_work_end',
    'work_days', 'language', 'email_notifications_enabled'];
  const updates = [];
  const values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${idx}`);
      values.push(req.body[f]);
      idx++;
    }
  }
  if (updates.length === 0) return res.json({ ok: true });
  values.push(req.user.agency_id);
  try {
    await pool.query(`UPDATE agencies SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    res.json({ ok: true });
  } catch(e) {
    console.error('Onboarding draft error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/agency/onboarding/complete', authMiddleware, async (req, res) => {
  if (req.user.role !== 'super_admin' && req.user.role !== 'admin' && req.user.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  // Validate required fields
  const required = ['name', 'country', 'timezone', 'currency', 'service_type',
    'models_count', 'chatters_count', 'target_markets', 'contact_email'];
  const agency = (await pool.query('SELECT * FROM agencies WHERE id = $1', [req.user.agency_id])).rows[0];
  if (!agency) return res.status(404).json({ error: 'Agence introuvable' });

  const missing = required.filter(f => !agency[f] && !req.body[f]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Champs obligatoires manquants: ${missing.join(', ')}` });
  }

  // Apply any final fields from the request body
  const fields = ['name', 'logo_url', 'primary_color', 'country', 'timezone', 'currency',
    'service_type', 'models_count', 'chatters_count', 'target_markets', 'founded_at',
    'contact_email', 'phone', 'legal_name', 'address_street', 'address_city',
    'address_zip', 'address_country', 'vat_number', 'default_work_start', 'default_work_end',
    'work_days', 'language', 'email_notifications_enabled'];
  const updates = ['onboarding_completed = TRUE', 'onboarding_completed_at = NOW()'];
  const values = [];
  let idx = 1;
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = $${idx}`);
      values.push(req.body[f]);
      idx++;
    }
  }
  values.push(req.user.agency_id);

  try {
    await pool.query(`UPDATE agencies SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    // Update settings table too (agency_name sync)
    if (req.body.name) {
      await pool.query("UPDATE settings SET value = $1 WHERE key = 'agency_name' AND agency_id = $2", [req.body.name, req.user.agency_id]);
    }

    // Log activity
    try {
      await pool.query(
        "INSERT INTO activity_log (user_id, agency_id, action, details) VALUES ($1, $2, 'onboarding_completed', $3)",
        [req.user.id, req.user.agency_id, JSON.stringify({ completed_by: req.user.display_name || req.user.username })]
      );
    } catch(e) { /* activity_log may not exist */ }

    // TODO: Send welcome email hook here
    // await sendWelcomeEmail(agency.contact_email || req.body.contact_email);

    res.json({ ok: true });
  } catch(e) {
    console.error('Onboarding complete error:', e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ============ PLATFORM ADMIN ============
app.get('/api/platform/agencies', authMiddleware, platformAdminOnly, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*,
      (SELECT COUNT(*) FROM users WHERE agency_id = a.id) as user_count,
      (SELECT COUNT(*) FROM models WHERE agency_id = a.id) as model_count,
      (SELECT COUNT(*) FROM outreach_leads WHERE agency_id = a.id) as lead_count,
      u.display_name as owner_name
    FROM agencies a
    LEFT JOIN users u ON a.owner_id = u.id
    ORDER BY a.created_at DESC
  `);
  res.json(rows);
});

app.put('/api/platform/agencies/:id', authMiddleware, platformAdminOnly, async (req, res) => {
  const { active } = req.body;
  await pool.query('UPDATE agencies SET active = $1 WHERE id = $2', [active, req.params.id]);
  res.json({ ok: true });
});

app.delete('/api/platform/agencies/:id', authMiddleware, platformAdminOnly, async (req, res) => {
  const agencyId = parseInt(req.params.id);
  try {
    // Delete all agency data in order (respect foreign keys)
    await pool.query('DELETE FROM recruitment_leads WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM recruiters WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM recruitment_settings WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM student_revenue WHERE user_id IN (SELECT id FROM users WHERE agency_id = $1)', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM student_models WHERE user_id IN (SELECT id FROM users WHERE agency_id = $1)', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM student_recruits WHERE user_id IN (SELECT id FROM users WHERE agency_id = $1)', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM student_leads WHERE user_id IN (SELECT id FROM users WHERE agency_id = $1)', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM call_requests WHERE user_id IN (SELECT id FROM users WHERE agency_id = $1)', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM activity_log WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM planning_shifts WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM tasks WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM chatter_shifts WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM outreach_leads WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM settings WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM team_members WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM students WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM models WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM objectives WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM messages WHERE sender_id IN (SELECT id FROM users WHERE agency_id = $1) OR receiver_id IN (SELECT id FROM users WHERE agency_id = $1)', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM invitation_tokens WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('UPDATE agencies SET owner_id = NULL WHERE id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE agency_id = $1', [agencyId]).catch(() => {});
    await pool.query('DELETE FROM agencies WHERE id = $1', [agencyId]);
    res.json({ ok: true });
  } catch(e) {
    console.error('Delete agency error:', e);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

app.get('/api/platform/stats', authMiddleware, platformAdminOnly, async (req, res) => {
  const agencies = (await pool.query('SELECT COUNT(*) as count FROM agencies')).rows[0].count;
  const users = (await pool.query('SELECT COUNT(*) as count FROM users')).rows[0].count;
  const models = (await pool.query('SELECT COUNT(*) as count FROM models')).rows[0].count;
  res.json({ agencies: parseInt(agencies), users: parseInt(users), models: parseInt(models) });
});

// ============ WEBSOCKET ============
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(message);
  });
}

// Présence en ligne via WebSocket
wss.on('connection', (ws) => {
  ws._userId = null;

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      // Client s'identifie
      if (msg.type === 'auth') {
        const decoded = jwt.verify(msg.token, JWT_SECRET);
        const { rows } = await pool.query('SELECT id, display_name, role, avatar_url FROM users WHERE id = $1', [decoded.id]);
        if (rows.length === 0) return;
        ws._userId = rows[0].id;
        ws._userName = rows[0].display_name;
        ws._userRole = rows[0].role;
        ws._userAvatar = rows[0].avatar_url;

        // Upsert session
        await pool.query(`INSERT INTO active_sessions (user_id, last_ping, connected_at) VALUES ($1, NOW(), NOW())
          ON CONFLICT (user_id) DO UPDATE SET last_ping = NOW(), connected_at = NOW()`, [ws._userId]);

        broadcast('user-online', { user_id: ws._userId, display_name: ws._userName, role: ws._userRole, avatar_url: ws._userAvatar });
      }

      // Ping de présence
      if (msg.type === 'ping' && ws._userId) {
        await pool.query('UPDATE active_sessions SET last_ping = NOW() WHERE user_id = $1', [ws._userId]);
      }
    } catch(e) {}
  });

  ws.on('close', async () => {
    if (ws._userId) {
      await pool.query('DELETE FROM active_sessions WHERE user_id = $1', [ws._userId]).catch(() => {});
      broadcast('user-offline', { user_id: ws._userId });
    }
  });
});

// ============ FOLLOWERS SCRAPER ============
const https = require('https');

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

// ============ DAILY WHATSAPP SUMMARY ============
// ============ SCHEDULED REPORTS (node-cron) ============

async function sendDailyReport() {
  if (!(await isNotifEnabled('notif_daily_report'))) return;
  try {
    const todayStart = new Date();
    todayStart.setHours(9, 0, 0, 0);
    const todayStr = new Date().toISOString().split('T')[0];

    // Revenue du jour (chatter shifts)
    const { rows: revRows } = await pool.query(
      "SELECT model_name, COALESCE(SUM(ppv_total),0) as ppv, COALESCE(SUM(tips_total),0) as tips FROM chatter_shifts WHERE date = $1 GROUP BY model_name ORDER BY (SUM(ppv_total) + SUM(tips_total)) DESC",
      [todayStr]
    );
    const totalRevenue = revRows.reduce((s, r) => s + parseFloat(r.ppv) + parseFloat(r.tips), 0);
    const top3 = revRows.slice(0, 3);

    // Leads du jour
    const { rows: leadStats } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= $1) as leads_today,
        COUNT(*) FILTER (WHERE sent_at >= $1) as dms_today,
        COUNT(*) FILTER (WHERE status = 'signed' AND updated_at >= $1) as signed_today
      FROM student_leads
    `, [todayStart.toISOString()]);
    const ls = leadStats[0];

    // Leads outreach du jour
    const { rows: outreachStats } = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE created_at >= $1) as contacted,
             COUNT(*) FILTER (WHERE status = 'signed' AND updated_at >= $1) as signed
      FROM outreach_leads
    `, [todayStart.toISOString()]);
    const os = outreachStats[0];
    const totalContacted = parseInt(ls.leads_today) + parseInt(os.contacted);
    const totalSigned = parseInt(ls.signed_today) + parseInt(os.signed);

    // Membres inactifs (clock_in > 4h sans clock_out)
    const { rows: inactive } = await pool.query(`
      SELECT u.display_name, sc.clock_in FROM shift_clocks sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.clock_out IS NULL AND sc.clock_in < NOW() - INTERVAL '4 hours'
    `);

    // Membres absents (team members qui ne se sont pas pointés aujourd'hui)
    const { rows: absent } = await pool.query(`
      SELECT u.display_name FROM users u
      WHERE u.role IN ('chatter', 'outreach', 'va')
      AND u.id NOT IN (SELECT user_id FROM shift_clocks WHERE clock_in::date = CURRENT_DATE)
      AND u.id NOT IN (SELECT user_id FROM leave_requests WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1)
    `, [todayStr]);

    let msg = `📊 RAPPORT QUOTIDIEN\n📅 ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n💰 REVENUS DU JOUR\n`;
    msg += `Total: $${totalRevenue.toFixed(2)}\n`;
    if (top3.length > 0) {
      msg += `\n🏆 TOP MODÈLES\n`;
      top3.forEach((m, i) => {
        const icons = ['🥇', '🥈', '🥉'];
        msg += `${icons[i]} ${m.model_name}: $${(parseFloat(m.ppv) + parseFloat(m.tips)).toFixed(2)}\n`;
      });
    }
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n📨 OUTREACH\n`;
    msg += `📩 Leads contactés: ${totalContacted}\n`;
    msg += `✅ Leads signés: ${totalSigned}\n`;
    msg += `💬 DMs envoyés: ${ls.dms_today}\n`;
    if (inactive.length > 0 || absent.length > 0) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `\n⚠️ ÉQUIPE\n`;
      if (inactive.length > 0) msg += `🔴 Inactifs +4h: ${inactive.map(m => m.display_name).join(', ')}\n`;
      if (absent.length > 0) msg += `⬜ Absents: ${absent.map(m => m.display_name).join(', ')}\n`;
    }

    await sendWhatsApp(msg);
    console.log('Daily report sent');
  } catch(e) { console.log('Daily report error:', e.message); }
}

async function sendWeeklyReport() {
  if (!(await isNotifEnabled('notif_weekly_report'))) return;
  try {
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
    const prevWeekStart = new Date(now); prevWeekStart.setDate(now.getDate() - 14);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0];
    const nowStr = now.toISOString().split('T')[0];

    // Revenue this week vs previous week
    const { rows: thisWeek } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total + tips_total), 0) as total FROM chatter_shifts WHERE date >= $1 AND date < $2",
      [weekStartStr, nowStr]
    );
    const { rows: prevWeek } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total + tips_total), 0) as total FROM chatter_shifts WHERE date >= $1 AND date < $2",
      [prevWeekStartStr, weekStartStr]
    );
    const thisTotal = parseFloat(thisWeek[0].total);
    const prevTotal = parseFloat(prevWeek[0].total);
    const evolution = prevTotal > 0 ? ((thisTotal - prevTotal) / prevTotal * 100).toFixed(1) : 'N/A';
    const evoIcon = thisTotal >= prevTotal ? '📈' : '📉';

    // Best model of the week
    const { rows: bestModel } = await pool.query(
      "SELECT model_name, SUM(ppv_total + tips_total) as total FROM chatter_shifts WHERE date >= $1 AND date < $2 GROUP BY model_name ORDER BY total DESC LIMIT 1",
      [weekStartStr, nowStr]
    );

    // Leads processed
    const { rows: weekLeads } = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'signed') as signed
      FROM student_leads WHERE created_at >= $1
    `, [weekStart.toISOString()]);

    // Revenue objectives met
    const currentMonth = now.toISOString().slice(0, 7);
    const { rows: objectives } = await pool.query(
      "SELECT m.name, mro.target, mro.current FROM model_revenue_objectives mro JOIN models m ON mro.model_id = m.id WHERE mro.month = $1",
      [currentMonth]
    );
    const metCount = objectives.filter(o => parseFloat(o.current) >= parseFloat(o.target) && parseFloat(o.target) > 0).length;
    const totalObj = objectives.filter(o => parseFloat(o.target) > 0).length;

    let msg = `📋 RAPPORT HEBDOMADAIRE\n📅 Semaine du ${weekStart.toLocaleDateString('fr-FR')} au ${now.toLocaleDateString('fr-FR')}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n💰 REVENUS\n`;
    msg += `Cette semaine: $${thisTotal.toFixed(2)}\n`;
    msg += `Semaine précédente: $${prevTotal.toFixed(2)}\n`;
    msg += `${evoIcon} Évolution: ${evolution === 'N/A' ? 'N/A' : (thisTotal >= prevTotal ? '+' : '') + evolution + '%'}\n`;
    if (bestModel.length > 0) {
      msg += `\n🏆 MEILLEUR MODÈLE\n`;
      msg += `${bestModel[0].model_name}: $${parseFloat(bestModel[0].total).toFixed(2)}\n`;
    }
    msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `\n📨 LEADS\n`;
    msg += `Total traités: ${weekLeads[0].total}\n`;
    msg += `Signés: ${weekLeads[0].signed}\n`;
    if (totalObj > 0) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `\n🎯 OBJECTIFS\n`;
      msg += `Atteints: ${metCount}/${totalObj}\n`;
      objectives.filter(o => parseFloat(o.target) > 0).forEach(o => {
        const pct = (parseFloat(o.current) / parseFloat(o.target) * 100).toFixed(0);
        const icon = parseFloat(o.current) >= parseFloat(o.target) ? '✅' : '⏳';
        msg += `${icon} ${o.name}: ${pct}%\n`;
      });
    }

    await sendWhatsApp(msg);
    console.log('Weekly report sent');
  } catch(e) { console.log('Weekly report error:', e.message); }
}

async function checkRevenueObjectiveAlert(modelName, date) {
  if (!(await isNotifEnabled('notif_alert_revenue_objective'))) return;
  try {
    const currentMonth = date.slice(0, 7);
    const { rows } = await pool.query(`
      SELECT mro.target, mro.current, m.name FROM model_revenue_objectives mro
      JOIN models m ON mro.model_id = m.id
      WHERE m.name = $1 AND mro.month = $2 AND mro.target > 0
    `, [modelName, currentMonth]);
    if (rows.length === 0) return;
    const obj = rows[0];
    // Get today's revenue for this model
    const { rows: todayRev } = await pool.query(
      "SELECT COALESCE(SUM(ppv_total + tips_total), 0) as total FROM chatter_shifts WHERE model_name = $1 AND date = $2",
      [modelName, date]
    );
    const dailyTarget = parseFloat(obj.target) / 30;
    const todayTotal = parseFloat(todayRev[0].total);
    if (todayTotal > dailyTarget && dailyTarget > 0) {
      sendWhatsApp(`🚀 OBJECTIF DÉPASSÉ !\n\n💎 ${modelName} a dépassé son objectif journalier\n💰 Aujourd'hui: $${todayTotal.toFixed(2)} (objectif: $${dailyTarget.toFixed(2)}/jour)\n📊 Progression mois: $${parseFloat(obj.current).toFixed(2)}/$${parseFloat(obj.target).toFixed(2)}`);
    }
  } catch(e) {}
}

async function checkInactiveChatters() {
  if (!(await isNotifEnabled('notif_alert_inactive_chatter'))) return;
  try {
    const { rows } = await pool.query(`
      SELECT u.display_name, sc.clock_in,
        EXTRACT(EPOCH FROM (NOW() - sc.clock_in)) / 3600 as hours_in
      FROM shift_clocks sc
      JOIN users u ON sc.user_id = u.id
      WHERE sc.clock_out IS NULL
        AND sc.clock_in < NOW() - INTERVAL '2 hours'
        AND u.role = 'chatter'
    `);
    for (const chatter of rows) {
      // Check if we already sent an alert recently (check activity_log)
      const { rows: recent } = await pool.query(
        "SELECT id FROM activity_log WHERE action = 'inactive-chatter-alert' AND details = $1 AND created_at > NOW() - INTERVAL '4 hours'",
        [chatter.display_name]
      );
      if (recent.length === 0) {
        sendWhatsApp(`⚠️ CHATTER INACTIF\n\n👤 ${chatter.display_name}\n⏱️ Pointé depuis ${Math.round(chatter.hours_in)}h sans activité\n\nVérifie que tout va bien.`);
        await pool.query("INSERT INTO activity_log (user_name, action, target_type, details) VALUES ($1, 'inactive-chatter-alert', 'system', $1)", [chatter.display_name]);
      }
    }
  } catch(e) { console.log('Inactive chatter check error:', e.message); }
}

let dailyCronJob = null;
let weeklyCronJob = null;
let inactiveCheckJob = null;

async function setupCronJobs() {
  // Get configured daily report hour (default: 20:00 Paris time)
  const dailyHour = (await getNotifSetting('notif_daily_hour')) || '20:00';
  const [hour, minute] = dailyHour.split(':').map(Number);

  // Stop existing jobs
  if (dailyCronJob) dailyCronJob.stop();
  if (weeklyCronJob) weeklyCronJob.stop();
  if (inactiveCheckJob) inactiveCheckJob.stop();

  // Daily report - configurable time (default 20:00), timezone Europe/Paris
  dailyCronJob = cron.schedule(`${minute || 0} ${hour || 20} * * *`, () => {
    sendDailyReport();
  }, { timezone: 'Europe/Paris' });

  // Weekly report - Monday 9:00 AM Paris time
  weeklyCronJob = cron.schedule('0 9 * * 1', () => {
    sendWeeklyReport();
  }, { timezone: 'Europe/Paris' });

  // Check inactive chatters every 30 minutes
  inactiveCheckJob = cron.schedule('*/30 * * * *', () => {
    checkInactiveChatters();
  }, { timezone: 'Europe/Paris' });

  console.log(`Cron jobs configured: daily report at ${dailyHour} (Paris), weekly Monday 9h, inactive check every 30min`);
}

// ============ CATCH-ALL (must be last route) ============
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route not found' });
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ============ START ============
async function start() {
  await initDB();
  await seedData();
  await migrateToMultiAgency();

  // Schedule WhatsApp reports & alerts via node-cron
  await setupCronJobs();

  // Lancer le premier scrape après 10 secondes
  setTimeout(() => updateAllFollowers(), 10000);
  // Puis toutes les 15 minutes
  setInterval(() => updateAllFollowers(), 15 * 60 * 1000);

  server.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════╗
  ║    Fuzion Pilot Dashboard              ║
  ║    http://localhost:${PORT}             ║
  ║                                       ║
  ║    Ready to serve                      ║
  ╚══════════════════════════════════════╝
    `);
  });
}

start().catch(err => {
  console.error('Erreur au démarrage:', err);
  process.exit(1);
});
