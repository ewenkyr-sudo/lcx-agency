# AUDIT LCX-AGENCY (Fuzion Pilot)

**Date :** 2026-04-20
**Commit :** `1ef51b6`
**Lignes totales :** ~15 200 (server.js 4336, dashboard.html 7368, student.js 1270, outreach-student.js 325)

---

## 1. STACK TECHNIQUE

| Composant | Technologie |
|-----------|-------------|
| **Backend** | Node.js (>=18) + Express 4.18 |
| **Frontend** | Vanilla HTML/CSS/JS (pas de framework) |
| **Base de donnees** | PostgreSQL via `pg` (pas d'ORM, raw SQL) |
| **Auth** | JWT (jsonwebtoken) + bcryptjs, cookie httpOnly |
| **Email** | Resend API |
| **Paiements** | Stripe (webhooks) |
| **Temps reel** | WebSocket (ws) |
| **Scheduled tasks** | node-cron + setInterval |
| **Securite** | helmet, express-rate-limit, CORS |
| **Hebergement backend** | Render.com (auto-deploy depuis main) |
| **Hebergement site vitrine** | Vercel |
| **PWA** | manifest.json + service worker |

### Dependances (package.json)

```
bcryptjs ^2.4.3       cookie-parser ^1.4.6    cors ^2.8.5
express ^4.18.2       express-rate-limit ^8.3.2   helmet ^8.1.0
jsonwebtoken ^9.0.2   node-cron ^4.2.1        pg ^8.13.1
resend ^6.12.0        ws ^8.16.0
```

---

## 2. STRUCTURE DU PROJET

```
lcx-agency/
  server.js               # Backend monolithique (4336 lignes, routes + DB + cron + WS)
  build.js                # Script de build (hash injection SW)
  package.json
  public/
    dashboard.html         # App principale (7368 lignes, CSS + HTML + JS inline)
    student.js             # Module eleve (1270 lignes)
    outreach-student.js    # Module outreach assigne (325 lignes)
    login.html             # Page connexion
    register.html          # Page inscription
    invite.html            # Page activation compte
    onboarding.html        # Wizard onboarding 5 etapes
    platform.html          # Panel admin plateforme
    shared.js              # JS partage (navbar, smooth scroll)
    sw.js                  # Service worker
    manifest.json          # PWA manifest
    js/
      i18n.js              # Module internationalisation
    lang/
      fr.json              # 656 cles FR
      en.json              # 656 cles EN
    assets/
      fuzion-pilot-logo.svg
    icons/
      icon.svg, icon-180.png, icon-192.png, icon-512.png
  test-analytics-isolation.js   # Test multi-tenant
  test-onboarding-flow.js       # Test onboarding E2E
```

**Organisation du code :** Monolithique. Tout le backend est dans `server.js` (routes, middlewares, DB init, cron, websocket). Tout le frontend admin est dans `dashboard.html` (CSS inline + HTML + JS inline). Pas de separation MVC, pas de controllers, pas de models.

---

## 3. MODELES DE DONNEES

### 34 tables PostgreSQL

#### Core

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **agencies** | id, name, logo_url, primary_color, owner_id, active, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_plan, onboarding_completed, country, timezone, currency, service_type, language, + 20 champs onboarding | owner_id → users |
| **users** | id, username, password, display_name, role, avatar_url, read_only, expires_at, agency_id | agency_id → agencies |
| **settings** | key, value, agency_id | agency_id → agencies |
| **invitation_tokens** | id, token, email, agency_id, role, plan, stripe_customer_id, stripe_subscription_id, expires_at, used_at | agency_id → agencies |

#### Models & Comptes

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **models** | id, name, of_link, ig_handle, tiktok_handle, telegram_handle, status, agency_id, drive_folder, lifecycle_status | agency_id → agencies |
| **accounts** | id, model_id, platform, username, current_followers, previous_followers, link, last_scraped | model_id → models |
| **daily_stats** | id, account_id, date, followers | account_id → accounts |
| **model_content_planning** | id, model_id, label, link, status | model_id → models |
| **model_revenue_objectives** | id, model_id, month, target, agency_id | model_id → models |

#### Equipe

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **team_members** | id, user_id, name, role, status, agency_id | user_id → users |
| **chatter_shifts** | id, user_id, model_id, date, ppv_revenue, tips_revenue, notes, agency_id | user_id → users, model_id → models |
| **shift_clocks** | id, user_id, clock_in, clock_out | user_id → users |
| **active_sessions** | id, user_id, last_ping | user_id → users |

#### Eleves / Coaching

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **students** | id, user_id, name, program, status, progression_step, outreach_us_enabled, drive_folder, agency_id | user_id → users |
| **student_leads** | id, user_id, username, ig_link, lead_type, status, script_used, ig_account_used, notes, market, sent_at, added_by, last_modified_by | user_id → users, added_by → users |
| **student_recruits** | id, user_id, ig_name, ig_link, status, notes | user_id → users |
| **student_models** | id, user_id, name, of_handle, fans_count, commission_rate, status | user_id → users |
| **student_revenue** | id, user_id, student_model_id, month, revenue | user_id → users, student_model_id → student_models |
| **student_outreach_assignments** | id, student_user_id, outreach_user_id | student_user_id → users, outreach_user_id → users |
| **student_outreach_pairs** | id, student_a_id, student_b_id | student_a_id → users, student_b_id → users |
| **call_requests** | id, user_id, message, availabilities, status, scheduled_at | user_id → users |

#### Outreach (admin)

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **outreach_leads** | id, user_id, username, ig_link, lead_type, status, script_used, ig_account_used, notes, sent_at, agency_id | user_id → users |

#### Planning & Taches

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **tasks** | id, title, description, status, priority, deadline, assigned_to_id, created_by, agency_id | assigned_to_id → users, created_by → users |
| **planning_shifts** | id, user_id, shift_date, shift_type, start_time, end_time, entry_type, priority, description, model_ids, notes, agency_id | user_id → users |
| **leave_requests** | id, user_id, start_date, end_date, reason, status, agency_id | user_id → users |
| **schedule** | id, user_id, day_of_week, shift_type | user_id → users |

#### Communication

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **messages** | id, sender_id, receiver_id, content, read, created_at | sender_id → users, receiver_id → users |
| **resources** | id, title, type, url, file_data, file_name, agency_id | |

#### Finance

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **payments** | id, model_id, month, amount, status, notes, agency_id | model_id → models |

#### Objectifs & Logs

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **weekly_objectives** | id, user_id, week_start, obj_type, description, target, current, agency_id | user_id → users |
| **activity_log** | id, user_id, action, target_type, target_id, details, agency_id, created_at | user_id → users |

#### Recrutement

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **recruitment_settings** | id, agency_id, enabled, coaching_price | agency_id → agencies (UNIQUE) |
| **recruiters** | id, agency_id, user_id, commission_percentage, is_active | user_id → users |
| **recruitment_leads** | id, agency_id, recruiter_id, prospect_name, prospect_pseudo, platform, status, call_recruiter, call_owner, notes | recruiter_id → recruiters |

#### Autres

| Table | Champs principaux | Relations |
|-------|------------------|-----------|
| **calls** | id, model_id, date, time, type, notes, admin_notes | model_id → models |
| **user_options** | id, user_id, option_type, value | user_id → users |

---

## 4. ROUTES / ENDPOINTS

### Auth (5 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| POST | /api/login | Connexion (rate limited) | Non |
| POST | /api/logout | Deconnexion | Non |
| GET | /api/me | Info utilisateur connecte | Oui |
| POST | /api/invite/register | Inscription via token invitation (rate limited) | Non |
| POST | /api/register | Inscription legacy (desactivee) | Non |

### Users (8 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/users | Liste utilisateurs | admin |
| POST | /api/users | Creer utilisateur (rate limited) | admin |
| PUT | /api/users/:id/password | Changer mot de passe (rate limited) | admin |
| PUT | /api/users/:id/role | Changer role | admin |
| PUT | /api/users/:id/display_name | Modifier nom | admin |
| PUT | /api/users/:id/avatar | Upload avatar | admin |
| PUT | /api/users/:id/access | Toggle read-only/expiration | admin |
| DELETE | /api/users/:id | Supprimer utilisateur (rate limited) | admin |

### Students (6 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/students | Liste eleves | Oui |
| POST | /api/students | Creer eleve | admin |
| PUT | /api/students/:id | Modifier eleve | admin |
| PUT | /api/students/:id/progression | Changer etape progression | admin |
| PUT | /api/students/:id/outreach-us | Activer outreach US | admin |
| DELETE | /api/students/:id | Supprimer eleve | admin |

### Models (7 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/models | Liste modeles | admin |
| POST | /api/models | Creer modele | admin |
| PUT | /api/models/:id | Modifier modele | admin |
| DELETE | /api/models/:id | Supprimer modele | admin |
| GET | /api/models/:id/planning | Planning contenu modele | admin |
| POST | /api/models/:id/planning | Ajouter planning | admin |
| DELETE | /api/model-planning/:id | Supprimer planning | admin |

### Accounts (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/accounts | Liste comptes | admin |
| POST | /api/accounts | Creer compte | admin |
| PUT | /api/accounts/:id | Modifier compte | admin |
| DELETE | /api/accounts/:id | Supprimer compte | admin |

### Team (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/team | Liste equipe | Oui |
| POST | /api/team | Ajouter membre | admin |
| PUT | /api/team/:id | Modifier membre | admin |
| DELETE | /api/team/:id | Supprimer membre | admin |

### Shifts / Clock (10 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/shifts | Liste shifts | Oui |
| POST | /api/shifts | Creer shift | Oui |
| DELETE | /api/shifts/:id | Supprimer shift | Oui |
| GET | /api/shifts/my-stats | Stats perso | Oui |
| GET | /api/shifts/admin-stats | Stats admin | admin |
| GET | /api/shift-clock | Statut horloge | Oui |
| GET | /api/shift-clock/all | Tous les statuts | admin |
| POST | /api/shift-clock/in | Pointer entree | Oui |
| POST | /api/shift-clock/out | Pointer sortie | Oui |
| GET | /api/shift-clock/status | Statut actuel | Oui |

### Outreach Leads admin (7 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/leads | Liste leads | Oui (filtre par role) |
| POST | /api/leads | Creer lead | outreach |
| PUT | /api/leads/bulk-update | MAJ en masse | outreach |
| PUT | /api/leads/:id | Modifier lead | outreach |
| DELETE | /api/leads/:id | Supprimer lead | outreach |
| GET | /api/leads/my-stats | Stats perso | outreach |
| GET | /api/leads/admin-stats | Stats admin | admin |

### Student Leads (8 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/student-leads | Liste leads eleve | Oui (filtre par role) |
| POST | /api/student-leads | Creer lead | Oui |
| PUT | /api/student-leads/bulk-update | MAJ en masse | Oui |
| PUT | /api/student-leads/:id | Modifier lead | Oui |
| DELETE | /api/student-leads/all | Supprimer tous | Oui |
| DELETE | /api/student-leads/:id | Supprimer lead | Oui |
| GET | /api/student-leads/stats | Stats outreach eleve | Oui |
| POST | /api/student-leads/import-csv | Import CSV | Oui |
| POST | /api/student-leads/check-duplicates | Detection doublons | Oui |

### Student Models & Revenue (7 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/student-models | Liste modeles eleve | Oui |
| POST | /api/student-models | Ajouter modele | Oui |
| PUT | /api/student-models/:id | Modifier modele | Oui |
| DELETE | /api/student-models/:id | Supprimer modele | Oui |
| GET | /api/student-revenue | Revenus eleve | Oui |
| POST | /api/student-revenue | Ajouter revenu | Oui |
| GET | /api/student-recruits | Recrutement modeles | Oui |
| POST | /api/student-recruits | Ajouter recrue | Oui |
| PUT | /api/student-recruits/:id | Modifier recrue | Oui |
| DELETE | /api/student-recruits/:id | Supprimer recrue | Oui |

### Outreach Assignments & Pairs (5 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/student-outreach-assignments | Liste assignations | Oui |
| POST | /api/student-outreach-assignments | Assigner assistante | admin |
| DELETE | /api/student-outreach-assignments/:id | Retirer assignation | admin |
| GET | /api/student-outreach-pairs | Liste paires | Oui |
| POST | /api/student-outreach-pairs | Creer paire | admin |
| DELETE | /api/student-outreach-pairs/:id | Supprimer paire | admin |

### Coaching (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/call-requests | Demandes de call | Oui |
| POST | /api/call-requests | Demander un call | student |
| PUT | /api/call-requests/:id | Accepter/refuser call | admin |
| GET | /api/student-leads/coaching-overview | Stats coaching | admin |

### Tasks (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/tasks | Liste taches | Oui (filtre par role, pairs) |
| POST | /api/tasks | Creer tache | Oui |
| PUT | /api/tasks/:id | Modifier tache | Oui |
| DELETE | /api/tasks/:id | Supprimer tache | Oui |

### Planning (7 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/planning-shifts | Liste planning | Oui (filtre par role, pairs) |
| POST | /api/planning-shifts | Creer entree planning | Oui |
| PUT | /api/planning-shifts/:id | Modifier planning | Oui |
| DELETE | /api/planning-shifts/:id | Supprimer planning | Oui |
| GET | /api/leave-requests | Demandes conge | Oui |
| POST | /api/leave-requests | Demander conge | Oui |
| PUT | /api/leave-requests/:id | Accepter/refuser conge | admin |

### Messages (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/messages/:userId | Conversation avec un user | Oui |
| POST | /api/messages | Envoyer message | Oui |
| GET | /api/messages-unread | Nombre non lus | Oui |
| GET | /api/conversations | Liste conversations | Oui |

### Resources (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/resources | Liste formations | Oui |
| POST | /api/resources | Upload ressource | admin |
| GET | /api/resources/:id/download | Telecharger | Oui |
| DELETE | /api/resources/:id | Supprimer | admin |

### Analytics (5 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/analytics/daily | Leads/DMs par jour + heures + par personne | Oui |
| GET | /api/analytics/reply-rate-weekly | Taux reponse hebdo | admin |
| GET | /api/analytics/assistant-ranking | Classement assistantes | admin |
| GET | /api/analytics/hourly | Repartition horaire | admin |
| GET | /api/analytics/fr-vs-us | Comparaison marches | admin |

### Charts (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/charts/followers | Courbe followers | admin |
| GET | /api/charts/revenue | Courbe revenus | admin |
| GET | /api/charts/revenue-by-chatter | Revenus par chatter | admin |
| GET | /api/charts/leads | Pipeline leads | admin |

### Dashboard & Stats (5 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/dashboard | Donnees dashboard principal | Oui |
| GET | /api/stats | Stats globales | admin |
| GET | /api/model-cockpit/:id | Cockpit modele detaille | admin |
| GET | /api/model-revenue-objectives | Objectifs revenus | admin |
| POST | /api/model-revenue-objectives | Creer objectif | admin |

### Payments (3 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/payments | Liste paiements | admin |
| POST | /api/payments | Enregistrer paiement | admin |
| PUT | /api/payments/:id | Modifier paiement | admin |
| DELETE | /api/payments/:id | Supprimer paiement | admin |

### Settings (6 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/settings | Parametres agence | admin |
| PUT | /api/settings | Modifier parametres | admin |
| PATCH | /api/agency/language | Changer langue | Oui |
| POST | /api/admin/save-notif-settings | Preferences notifications | admin |
| POST | /api/admin/test-whatsapp | Test WhatsApp | admin |
| POST | /api/admin/test-daily-report | Test rapport quotidien | admin |
| POST | /api/admin/test-weekly-report | Test rapport hebdo | admin |

### Agency (5 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/agency | Info agence | Oui |
| PUT | /api/agency | Modifier agence | admin |
| GET | /api/agency/onboarding-status | Statut onboarding | Oui |
| PUT | /api/agency/onboarding/draft | Sauvegarder brouillon | admin |
| POST | /api/agency/onboarding/complete | Completer onboarding | admin |

### Admin (5 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| POST | /api/admin/reset-passwords | Reset mots de passe en masse | admin |
| POST | /api/admin/import-csv | Import CSV | admin |
| POST | /api/admin/refresh-followers | Rafraichir followers | admin |
| GET | /api/admin/db-size | Taille base | admin |
| GET | /api/admin/db-check | Verification integrite | admin |

### Platform Admin (4 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/platform/agencies | Liste toutes les agences | platform_admin |
| PUT | /api/platform/agencies/:id | Modifier agence | platform_admin |
| DELETE | /api/platform/agencies/:id | Supprimer agence (cascade) | platform_admin |
| GET | /api/platform/stats | Stats plateforme | platform_admin |

### Recruitment (11 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/recruitment/settings | Config recrutement | Oui |
| PATCH | /api/recruitment/settings | Modifier config | admin |
| GET | /api/recruitment/recruiters | Liste recruteurs + stats | Oui |
| POST | /api/recruitment/recruiters | Ajouter recruteur | admin |
| PATCH | /api/recruitment/recruiters/:id | Modifier recruteur | admin |
| DELETE | /api/recruitment/recruiters/:id | Supprimer recruteur | admin |
| GET | /api/recruitment/leads | Liste leads recrutement | Oui (filtre par role, pairs) |
| POST | /api/recruitment/leads | Creer lead | Oui (recruteur ou admin) |
| PATCH | /api/recruitment/leads/:id | Modifier lead | Oui |
| DELETE | /api/recruitment/leads/:id | Supprimer lead | Oui |
| GET | /api/recruitment/stats | Stats recrutement | Oui |

### Stripe (1 route)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| POST | /api/stripe/webhook | Reception events Stripe | Non (signature HMAC) |

### Misc (3 routes)

| Methode | Route | Description | Auth |
|---------|-------|-------------|------|
| GET | /api/online-users | Utilisateurs en ligne (WS) | Oui |
| GET | /api/activity-log | Journal d'activite | admin |
| GET | /api/export/leads | Export CSV leads | admin |

**Total : ~136 endpoints**

---

## 5. MODULES FONCTIONNELS

| Module | Sous-fonctionnalites | Etat | Fichiers |
|--------|---------------------|------|----------|
| **Dashboard** | KPIs globaux, equipe en ligne, taches urgentes, stats outreach temps reel, stats chatters temps reel | Complet | dashboard.html |
| **Planning** | Planning semaine, shifts, taches planifiees, demandes conge, recap heures | Complet | dashboard.html |
| **Taches** | CRUD taches, filtres (statut/priorite/assignation), vue liste + planning semaine | Complet | dashboard.html |
| **Modeles** | CRUD modeles, cockpit detaille par modele (revenus, followers, equipe, objectifs, charts), planning contenu | Complet | dashboard.html |
| **Chatters** | Shifts avec revenus (PPV/tips), stats par chatter/modele, clock in/out temps reel | Complet | dashboard.html |
| **Outreach (admin)** | Leads pipeline, import CSV, filtres par statut/script/compte, stats par assistante | Complet | dashboard.html |
| **VA** | Section dediee aux assistants virtuels | Ebauche (section vide, reutilise planning/taches) | dashboard.html |
| **Stats & Subs** | Suivi followers par compte/plateforme, refresh automatique | Complet | dashboard.html |
| **Coaching** | Layout master-detail, KPIs, stepper progression, tabs (vue ensemble, outreach, planning, taches, revenue, messages), pairing eleves, assignation assistantes, objectifs hebdo, demandes call | Complet | dashboard.html, student.js |
| **Performances** | Graphiques followers cumules, DMs envoyes, reponses (periodes 7j/30j/60j/1an) | Complet | dashboard.html |
| **Analytics** | Stats perso leads/DMs par jour (1j-60j), par heure, par personne, stats aujourd'hui, FR vs US, classement assistantes, taux reponse hebdo | Complet | dashboard.html |
| **Finances** | Paiements, objectifs revenus modeles, commissions eleves | Complet | dashboard.html |
| **Journal** | Log d'activite (lead signed, call booked, clock in/out, alertes) | Complet | dashboard.html |
| **Parametres** | Mon agence, General, Outreach, Equipe, Coaching, Notifications, Securite, Export, Langue | Complet | dashboard.html |
| **Espace Eleve** | Tableau de bord, outreach, planning, taches, recrutement, modeles, revenus, messages, formation, objectifs, analytics | Complet | student.js |
| **Recrutement** | Recruteurs, leads prospect, pipeline (7 statuts), commissions, pairing entre recruteurs, 5 plateformes | Complet | dashboard.html |
| **Onboarding** | Wizard 5 etapes (identite, activite, contact, preferences, recap) | Complet | onboarding.html |
| **i18n** | FR/EN, 656 cles, sidebar + titres + settings traduits, contenu partiellement traduit | En cours | i18n.js, fr.json, en.json |
| **Messagerie** | Chat temps reel entre utilisateurs, notifications non lus | Complet | dashboard.html, student.js |
| **Platform Admin** | Liste agences, stats globales, activer/desactiver/supprimer agences | Complet | platform.html |

---

## 6. ROLES ET PERMISSIONS

| Role | Nav visible | Sections accessibles |
|------|------------|---------------------|
| **platform_admin** | Principal, Equipes, Outils, Admin, Plateforme | Tout + gestion multi-agence |
| **super_admin** | Principal, Equipes, Outils, Admin | Tout sauf plateforme |
| **admin** | Principal, Equipes, Outils, Admin | Tout sauf plateforme |
| **student** | Mon espace | student-home, outreach, planning, taches, recruits, modeles, revenue, messages, resources, objectifs, analytics |
| **chatter** | Principal, Equipes | planning, taches, chatters |
| **outreach** | Principal, Equipes | planning, taches, outreach |
| **va** | Principal, Equipes | planning, taches, va |
| **model** | Principal | planning, taches |

---

## 7. INTEGRATIONS EXTERNES

### Stripe
- **Mode :** Configurable via env vars (test ou live)
- **Webhook events geres :** customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded
- **Actions :** Creation token invitation, envoi email bienvenue, MAJ statut subscription, tracking plan

### Email (Resend)
- **Provider :** Resend API
- **From :** `Fuzion Pilot <contact@fuzionpilot.com>`
- **Emails envoyes :** Email d'invitation (activation compte), confirmation paiement
- **Fallback :** Si cle API absente, skip silencieux

### JWT Auth
- **Librairie :** jsonwebtoken
- **Expiration :** 30 jours
- **Stockage :** Cookie httpOnly secure (sameSite: lax)
- **Pas d'OAuth, pas de 2FA**

### WhatsApp (CallMeBot)
- **Usage :** Notifications automatiques (rapports quotidiens/hebdo, alertes inactivite chatter, objectifs atteints)
- **Providers supportes :** CallMeBot, CallMeBot WhatsApp

### Instagram / TikTok (scraping)
- **Methode :** Parsing HTML des pages publiques
- **Frequence :** Toutes les 15 minutes
- **Donnees :** Nombre de followers uniquement
- **Pas d'API officielle utilisee**

### Google Drive
- **Integration :** Liens stockes en tant qu'URLs (pas d'API)
- **Usage :** Dossiers Drive par eleve, contrats modeles, planning contenu

---

## 8. FONCTIONNALITES CLES DEJA IMPLEMENTEES

- Gestion multi-agence avec isolation des donnees (agency_id partout)
- Onboarding obligatoire 5 etapes pour nouvelles agences
- Systeme d'invitation par token (via Stripe checkout)
- Dashboard temps reel avec KPIs (followers, equipe, revenue, outreach)
- Pipeline outreach complet (leads → DMs → discussions → calls → signature)
- Gestion chatters avec suivi revenus PPV/tips par shift
- Cockpit modele avec graphiques revenus, objectifs, equipe assignee
- Planning hebdomadaire avec shifts, taches planifiees, conges
- Systeme de taches avec priorites, deadlines, assignation
- Coaching master-detail avec stepper progression (5 etapes)
- Pairing eleves (partage outreach, modeles, taches, planning, revenus, analytics, recrutement)
- Assignation assistantes outreach aux eleves
- Module recrutement complet (7 statuts, 5 plateformes, commissions automatiques)
- Analytics personnalises par role (admin voit son outreach, eleves voient le leur)
- Graphiques leads/DMs par jour avec periodes selectionnables (1j-60j)
- Stats "Aujourd'hui" avec detail par personne
- Repartition horaire de l'activite
- Messagerie interne temps reel (WebSocket)
- Import/export CSV des leads
- Notifications WhatsApp automatiques (rapports, alertes)
- Suivi followers Instagram/TikTok par scraping automatique
- Clock in/out pour chatters avec detection inactivite
- Objectifs hebdomadaires par eleve
- Systeme de ressources/formation
- i18n FR/EN (partiel)
- PWA (manifest + service worker)
- Platform admin (gestion multi-agence)

---

## 9. FONCTIONNALITES EN COURS / INCOMPLETES

- **i18n :** 656 cles FR/EN, sidebar et titres traduits, mais le contenu JS dynamique (template literals dans les fonctions de rendu) reste majoritairement en francais. ~91 appels showToast() non wrapes avec t(). Les filtres, formulaires, modals generes en JS ne passent pas par le systeme i18n.
- **Section VA :** L'onglet existe dans la sidebar mais la section est vide (reutilise juste planning/taches).
- **TODO dans le code :** `// TODO: Send welcome email hook here` (ligne 3830 de server.js) — hook d'email de bienvenue apres onboarding partiellement implemente.

---

## 10. POINTS FAIBLES TECHNIQUES IDENTIFIES

### Securite
- **Mots de passe par defaut dans le seed :** admin123, team123, eleve123 — risque si le seed tourne en prod
- **Pas de validation d'email :** aucune verification de format ou d'unicite email
- **Pas de 2FA**
- **Pas de recuperation de mot de passe** (pas de "Mot de passe oublie")
- **Rate limiting par serveur :** ne fonctionne pas si plusieurs instances (pas distribue)
- **Scraping Instagram/TikTok :** peut casser a tout moment si le HTML change

### Performance
- **server.js monolithique (4336 lignes) :** pas de separation routes/controllers/services
- **dashboard.html (7368 lignes) :** tout le CSS + HTML + JS dans un seul fichier
- **Pas d'index SQL declares** (aucun CREATE INDEX trouve)
- **Requetes N+1 :** dans student-leads/stats, boucle for sur chaque membre du pool avec une requete par membre
- **Pas de pagination** sur la plupart des endpoints (SELECT * sans LIMIT)
- **Pas de cache** (ni Redis ni cache applicatif)

### Code Quality
- **Pas de tests unitaires** (2 fichiers de test E2E seulement)
- **Pas de linter configure** (ni ESLint ni Prettier)
- **Duplication :** logique de filtrage par role repetee dans chaque endpoint
- **Pas de TypeScript**
- **Pas de separation frontend/backend** (tout dans le meme repo, fichiers monolithiques)
- **CSS inline dans le HTML** (pas de fichier CSS externe pour le dashboard)

---

## 11. CE QUI EST ABSENT

| Fonctionnalite | Present ? |
|----------------|-----------|
| Logs/audit trail | Oui (activity_log) |
| Notifications in-app | Partiel (badges non lus, pas de centre de notifications) |
| Onboarding | Oui (wizard 5 etapes) |
| Recuperation mot de passe | Non |
| 2FA | Non |
| Export de donnees | Partiel (CSV leads, equipe, eleves, revenus) |
| API publique documentee | Non |
| Webhooks sortants | Non |
| Versioning API | Non (pas de /v1/) |
| Tests automatises | Minimal (2 fichiers test E2E) |
| CI/CD | Non (auto-deploy Render depuis main, pas de pipeline) |
| Monitoring/alertes | Non (pas de Sentry, pas de health check) |
| Backup automatique DB | A verifier (depend de Render) |
| Dark mode toggle | Non (theme dark unique) |
| Multi-langue complete | En cours (structure prete, contenu partiel) |
| Notifications push | Non |
| Mobile app native | Non (PWA uniquement) |
| Tableau de bord personnalisable | Non |
| Recherche globale | Non |
| Pagination | Non |
| Rate limiting distribue | Non |
