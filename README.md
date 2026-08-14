# Mémo Temps

Widget graphique de frise chronologique (échelle jour/heure) pour visualiser et saisir les objectifs et rendez-vous du jour.

## Fonctionnalités

- Frise horizontale défilante, échelle **jour et heure**, centrée automatiquement sur la date du jour.
- Flèches de défilement (jour précédent / jour suivant), bouton **« Aujourd'hui »** pour recentrer, et défilement à la molette ou au glisser-déposer.
- Ligne « maintenant » mise à jour en temps réel.
- Saisie des **objectifs** et **rendez-vous** via un formulaire modal (titre, date, heure de début/fin, notes) ; les créneaux qui se chevauchent s'empilent automatiquement sur plusieurs lignes.
- Modification et suppression d'un événement en cliquant dessus.
- Persistance locale des données (`localStorage`), aucune installation ni backend requis.
- Charte graphique : `#E9E9ED` (fond), `#009FE3` (rendez-vous / accent principal), `#95C11F` (objectifs), `#A4ACB1` (éléments neutres).

## Utilisation

Ouvrir `index.html` dans un navigateur (aucune dépendance, aucun build). Par exemple :

```bash
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

Peut aussi être installée comme application (bouton « Installer » du navigateur) ou utilisée comme véritable application Windows autonome — voir ci-dessous.

## Application de bureau Windows (.exe)

Le dossier `desktop/` contient un habillage Electron : il lance un petit serveur local puis ouvre l'application dans sa propre fenêtre, sans navigateur ni barre d'adresse.

Pour obtenir l'installateur Windows sans rien installer sur son PC : dans l'onglet **Actions** du dépôt GitHub, ouvrir le workflow **Build Windows installer**, cliquer sur **Run workflow**, attendre la fin du build (quelques minutes), puis télécharger l'artefact `memo-temps-windows-installer` généré. L'installateur n'étant pas signé, Windows SmartScreen affiche un avertissement au premier lancement (« Informations complémentaires » → « Exécuter quand même »).

Pour builder soi-même (avec Node.js installé) :

```bash
npm install
npm run dist:win   # génère l'installateur dans dist/
npm start           # lance l'app en mode développement
```

## Rappels par e-mail (15 minutes avant un évènement)

Un rappel par e-mail peut être envoyé automatiquement ~15 minutes avant chaque objectif/rendez-vous, **même si l'application ou le téléphone est fermé** à ce moment-là. Comme l'application elle-même n'a pas de serveur, cette partie tourne indépendamment via un workflow GitHub Actions planifié (`.github/workflows/event-reminders.yml`, toutes les 5 minutes) qui lit directement le fichier `memo-temps-events.json` sur Google Drive et envoie l'e-mail via l'API Gmail. Script : `scripts/send-reminders.mjs`.

Configuration ponctuelle nécessaire (une seule fois) :

1. **Compte de service Google** (pour lire le fichier Drive sans connexion interactive) : dans [Google Cloud Console](https://console.cloud.google.com/) → *IAM et administration* → *Comptes de service* → *Créer un compte de service* → une fois créé, onglet *Clés* → *Ajouter une clé* → *Créer une clé* → format **JSON**. Conserver ce fichier (c'est un secret).
2. **Partager le fichier Drive** : dans Google Drive, clic droit sur `memo-temps-events.json` → *Partager* → coller l'adresse `...@...iam.gserviceaccount.com` du compte de service (visible dans le JSON sous `client_email`) → rôle **Lecteur**.
3. **OAuth2 Gmail** (envoi de l'e-mail, sans mot de passe d'application ni accès à l'admin console Workspace) :
   - Dans [Google Cloud Console](https://console.cloud.google.com/) → *API et services* → *Bibliothèque* → activer l'**API Gmail**.
   - *API et services* → *Écran de consentement OAuth* → type d'utilisateur **Interne** (réservé au domaine) → ajouter le scope `https://www.googleapis.com/auth/gmail.send`.
   - *API et services* → *Identifiants* → *Créer des identifiants* → *ID client OAuth* → type **Application de bureau**. Noter le **Client ID** et le **Client Secret** générés.
   - En local (pas en CI), lancer une fois :
     ```bash
     GMAIL_OAUTH_CLIENT_ID=... GMAIL_OAUTH_CLIENT_SECRET=... node scripts/get-gmail-refresh-token.mjs
     ```
     Ouvrir l'URL affichée, se connecter avec l'adresse Gmail d'envoi, autoriser l'accès : le script affiche un **refresh token** à conserver.
4. **Secrets GitHub** : sur la page du dépôt → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*, ajouter :
   - `GOOGLE_SERVICE_ACCOUNT_KEY` : contenu complet du fichier JSON de l'étape 1
   - `GMAIL_USER` : adresse Gmail utilisée comme expéditeur (celle autorisée à l'étape 3)
   - `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` : identifiants OAuth de l'étape 3
   - `GMAIL_OAUTH_REFRESH_TOKEN` : refresh token obtenu à l'étape 3
   - `REMINDER_EMAIL_TO` : adresse qui doit recevoir les rappels
5. Tester : onglet **Actions** → **Send event reminders** → **Run workflow**.

La fenêtre d'envoi est volontairement large (10 à 20 minutes avant l'évènement, réglable via les variables `REMINDER_MINUTES_BEFORE`/`REMINDER_WINDOW_MINUTES` en haut du script) pour absorber les délais d'exécution de GitHub Actions, qui ne garantit pas un déclenchement à la minute près.

## Intégration dans une autre page

Le widget est autonome et réutilisable :

```html
<link rel="stylesheet" href="css/widget.css">
<div id="mon-widget"></div>
<script src="js/widget.js"></script>
<script>
  new MemoTempsWidget(document.getElementById('mon-widget'));
</script>
```

## Structure du projet

```
index.html        page de démonstration
css/widget.css     styles du widget
js/widget.js       logique (rendu de la frise, formulaire, stockage)
```
