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
