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

Un rappel par e-mail peut être envoyé automatiquement ~15 minutes avant chaque objectif/rendez-vous, **même si l'application ou le téléphone est fermé** à ce moment-là. Comme l'application elle-même n'a pas de serveur, cette partie tourne indépendamment via un workflow GitHub Actions planifié (`.github/workflows/event-reminders.yml`, toutes les 5 minutes) qui lit directement le fichier `memo-temps-events.json` sur Google Drive et envoie l'e-mail via Gmail. Script : `scripts/send-reminders.mjs`.

Configuration ponctuelle nécessaire (une seule fois) :

1. **Compte de service Google** (pour lire le fichier Drive sans connexion interactive) : dans [Google Cloud Console](https://console.cloud.google.com/) → *IAM et administration* → *Comptes de service* → *Créer un compte de service* → une fois créé, onglet *Clés* → *Ajouter une clé* → *Créer une clé* → format **JSON**. Conserver ce fichier (c'est un secret).
2. **Partager le fichier Drive** : dans Google Drive, clic droit sur `memo-temps-events.json` → *Partager* → coller l'adresse `...@...iam.gserviceaccount.com` du compte de service (visible dans le JSON sous `client_email`) → rôle **Lecteur**.
3. **Compte Gmail dédié à l'envoi** : créez (ou utilisez) un compte Gmail grand public **distinct** de votre adresse habituelle, utilisé uniquement comme relais technique d'envoi (ex. `memotemps.rappels@gmail.com`) — évitez une adresse Workspace/pro, dont les politiques de sécurité de l'organisation peuvent bloquer les mots de passe d'application. Sur ce compte : activer la validation en 2 étapes ([myaccount.google.com/security](https://myaccount.google.com/security)), puis générer **un mot de passe d'application par application qui l'utilise** sur [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (donnez un nom explicite à chaque génération, ex. « Mémo Temps rappels » — chacun peut être révoqué séparément). Le même compte peut ainsi servir de relais à plusieurs applications sans qu'elles partagent le même mot de passe.
4. **Secrets GitHub** : sur la page du dépôt → *Settings* → *Secrets and variables* → *Actions* → *New repository secret*, ajouter :
   - `GOOGLE_SERVICE_ACCOUNT_KEY` : contenu complet du fichier JSON de l'étape 1
   - `GMAIL_USER` : adresse du compte Gmail dédié de l'étape 3
   - `GMAIL_APP_PASSWORD` : le mot de passe d'application généré spécifiquement pour Mémo Temps à l'étape 3
   - `GMAIL_FROM_NAME` *(optionnel)* : nom affiché comme expéditeur pour les destinataires (par défaut « Mémo Temps ») — permet de distinguer Mémo Temps d'une autre application utilisant le même compte relais, sans changer l'adresse
   - `REMINDER_EMAIL_TO` : adresse qui doit **recevoir** les rappels (peut être votre adresse @seineouest.fr habituelle — indépendante du compte technique d'envoi)
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
