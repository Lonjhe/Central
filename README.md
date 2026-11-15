# CENTRAL

Terminal web d'un jeu d'enquête collectif. Le site est servi par **GitHub Pages** ; la connexion et la progression commune reposent sur **Firebase** (offre gratuite Spark, largement suffisante pour 60 joueurs).

> Ce dépôt est public. Le contenu du jeu (réponses, indices, fragments, dossier de préparation) n'y figure pas : il est conservé à part par les organisateurs et saisi dans la console admin. Ne jamais l'ajouter ici.

## Ce que contient le dépôt

| Fichier | Rôle |
|---|---|
| `public/index.html` + `public/game.js` | Terminal joueur : alerte, connexion, 9 missions, final |
| `public/admin.html` | Console d'administration (réservée aux organisateurs) |
| `public/config.js` | Identifiants du projet Firebase (à remplir ; ces valeurs ne sont pas secrètes) |
| `firestore.rules` | Sécurité : c'est le serveur qui vérifie la clé et les réponses |
| `tests/rules.test.mjs` | Tests automatiques des règles |
| `.github/workflows/pages.yml` | Publie `public/` (et lui seul) sur GitHub Pages à chaque envoi sur `main` |

## Mise en route (≈ 20 minutes, une seule fois, tout se fait dans le navigateur)

1. **GitHub** : **Settings → Pages → Build and deployment → Source : GitHub Actions**. Le site est publié à chaque envoi sur `main` :
   `https://lonjhe.github.io/Central/` (joueurs) et `https://lonjhe.github.io/Central/admin.html` (organisateurs).
2. **Créer le projet Firebase** sur https://console.firebase.google.com (Google Analytics inutile).
3. **Authentication → Sign-in method** : activer **Anonyme** (joueurs) et **E-mail/Mot de passe** (organisateurs).
   Dans l'onglet **Users**, créer un compte par organisateur.
   Dans **Settings → Domaines autorisés**, ajouter `lonjhe.github.io`.
4. **Firestore Database → Créer** (mode production, région `eur3` ou `europe-west1`).
   Onglet **Règles** : remplacer le contenu par celui de `firestore.rules`, puis **Publier**.
5. **Paramètres du projet → Vos applications → Web (`</>`)** : copier la config dans `public/config.js` et l'envoyer sur `main`.
6. **Déclarer les admins** : chaque organisateur ouvre `admin.html` et se connecte. La page affiche son identifiant (UID).
   Dans **Firestore**, créer la collection `admins`, puis un document par UID (un champ quelconque, ex. `nom: "Organisateur 1"`).
7. Dans la console admin, **Contenu → Importer** le fichier de contenu conservé hors du dépôt. Cela crée les 9 secteurs, les indices, les fragments, les réponses et la clé d'accès.
8. Tester avec un téléphone et un ordinateur en même temps, puis **Zone sensible → Réinitialiser toute la progression** avant le lancement.

## En local (facultatif)

```bash
npm install
npm test                 # vérifie les règles sur l'émulateur Firestore (Java requis)
npm run deploy:rules     # publie les règles depuis un terminal (après npx firebase login et npx firebase use --add)
```

## Au quotidien (console admin)

- **Clé d'accès** : « Renouveler la clé » déconnecte tout le monde ; les joueurs ressaisissent la nouvelle.
- **Secteurs** : textes, lieu, date/heure d'ouverture, verrouillage, indices (un par ligne), fragment, réponses acceptées (variantes séparées par des virgules ; accents, espaces et majuscules ignorés).
- **Valider manuellement / Annuler la validation** : en cas de souci pendant le jeu.
- **Journal** : qui a restauré quoi, et quand.
- **Exporter** : sauvegarde des textes (sans les réponses).

## Comment c'est sécurisé

- Les réponses et la clé ne sont stockées que sous forme d'empreinte SHA-256, illisible par les joueurs.
- Un secteur ne se valide qu'une fois, seulement s'il est ouvert, et seulement avec une réponse acceptée : la règle Firestore le vérifie côté serveur.
- Les indices non révélés et les fragments non gagnés ne sont pas lisibles.
- Limite connue : le contenu des écrans de mission (ex. le texte chiffré du secteur 06) est dans `game.js`. Un développeur motivé peut lire ce fichier et en déduire des réponses. Pour un jeu entre collègues, c'est acceptable.

## Capacité

60 joueurs ≈ quelques milliers de lectures par jour. Le quota gratuit est de 50 000 lectures et 20 000 écritures par jour. Aucune carte bancaire n'est nécessaire.
