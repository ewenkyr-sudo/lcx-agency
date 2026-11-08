# Auto-post Reveal — mise en ligne

Le module publie automatiquement les posts, reels et stories des modèles sur Reveal (dashboard.reveal.me),
fait tourner l'ancien contenu, relève les j'aime et les stats, et envoie un rapport chaque lundi.

## Ce qu'il y a dans le code

| Fichier | Rôle |
|---|---|
| `db/autopost-schema.js` | Tables `autopost_*` (créées toutes seules au démarrage) |
| `routes/autopost.js` | API du module (`/api/autopost/...`), réservée aux admins |
| `services/autopost/planner.js` | Créneaux du jour, choix du contenu, rotation |
| `services/autopost/analysis.js` | Analyse et recommandations |
| `services/autopost/storage.js` | Stockage des médias (Cloudflare R2 / S3) |
| `services/autopost/session.js` | Connexion Reveal chiffrée |
| `worker/` | Le bot (Playwright) qui publie, tourne en service séparé |
| `public/js/modules/autopost.js` | L'onglet « Auto-post Reveal » du CRM |

Dans le code existant, seules 3 choses changent : 2 lignes dans `server.js` (route + création des tables),
l'onglet dans `dashboard.html`, et la palette de commandes.

## Mise en ligne (une fois)

### 1. Stockage des médias : Cloudflare R2 (gratuit jusqu'à 10 Go)
1. Cloudflare → R2 → *Create bucket* (ex. `lcx-autopost`).
2. R2 → *Manage API tokens* → token avec droits *Object Read & Write* sur ce bucket.
3. Dans le bucket → *Settings* → *CORS policy* :
   ```json
   [{ "AllowedOrigins": ["https://TON-DOMAINE-CRM"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```
4. Note : l'endpoint (`https://<id>.r2.cloudflarestorage.com`), le nom du bucket, l'Access Key et la Secret Key.

### 2. Render
Le `render.yaml` déclare le nouveau service **lcx-autopost-worker** (Docker, plan Standard ~25 $/mois :
Chromium a besoin de mémoire, le plan gratuit ne tient pas).

Variables à renseigner **sur le site ET sur le worker** :
- `AUTOPOST_S3_ENDPOINT`, `AUTOPOST_S3_BUCKET`, `AUTOPOST_S3_KEY`, `AUTOPOST_S3_SECRET`

Le worker reprend `DATABASE_URL` et `JWT_SECRET` du site (indispensable : la session Reveal est chiffrée avec).

Optionnel sur le worker :
- `AUTOPOST_PROXY` : proxy résidentiel français (`http://user:pass@hote:port`) si Reveal bloque l'IP du serveur.

Sans worker séparé (test) : `AUTOPOST_INLINE_WORKER=true` sur le site fait tourner le bot dans le même
process, mais il faut alors Chromium sur la machine et le plan gratuit ne suffira pas.

### 3. Dans le CRM
1. Onglet **Auto-post Reveal** → **Connecter** : glisse le bouton « Session Reveal » dans tes favoris,
   va sur dashboard.reveal.me (compte agence connecté), clique le favori, colle dans le CRM.
   Le statut passe à « Connecté » en moins d'une minute si le bot arrive à ouvrir Reveal.
2. Pour chaque modèle → **Réglages** : colle l'adresse de sa page Reveal, règle les quantités / horaires.
3. **Contenu** : glisse les photos / vidéos (posts, reels, stories).
4. Active la modèle.

## Premier test conseillé
Sur une seule modèle : ajoute 1 post, puis **Publier maintenant → Post** et regarde le résultat dans
**Historique** (et sur Reveal). Si ça échoue, la capture d'écran de l'erreur est dans l'historique.

Points à vérifier au premier vrai passage (relevés sur l'interface, mais pas encore testés en conditions réelles) :
- que le média importé depuis l'ordinateur s'attache bien au post (fenêtre « Ajouter des médias » → « Importer ») ;
- que la session copiée par le favori suffit au serveur pour rester connecté ;
- que les j'aime remontent (Journal du bot, onglet Réglages : « Stats : N posts lus »).

## Limites connues
- Reveal n'affiche pas de vues ni de ventes par post : l'analyse se base sur les j'aime par post et
  sur le revenu / les nouveaux abonnés du jour.
- Les stories n'ont pas de j'aime : elles ne comptent pas dans l'analyse par type.
- Reveal utilise un système anti-robot (FlowGuard). Si le bot est bloqué, le statut passe en erreur et
  tu es prévenu sur WhatsApp ; dans ce cas, ajouter un proxy résidentiel français est la première chose à essayer.
- Si Reveal change son interface, c'est `worker/reveal.js` qu'il faut adapter.
