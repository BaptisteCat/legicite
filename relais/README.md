# Relais d'authentification PISTE

Un seul rôle : obtenir le jeton OAuth que le navigateur ne peut pas demander
lui-même.

## Pourquoi il existe

Les deux moitiés de l'API PISTE ne se comportent pas pareil. Mesuré, en
production comme en bac à sable :

| | |
|---|---|
| `api.piste.gouv.fr` (données) | CORS complet, appels directs depuis le navigateur |
| `oauth.piste.gouv.fr` (jeton) | **403 dès qu'un en-tête `Origin` est présent**, sans en-tête CORS |

Une page web ne peut donc pas obtenir de jeton. Ce Worker émet la requête côté
serveur, sans `Origin`, et renvoie la réponse avec les en-têtes CORS.

Environ **un appel par heure** : le jeton est valable une heure, et les appels de
données ne passent pas par ici.

## Déploiement depuis GitHub

Dans le tableau de bord Cloudflare, *Workers & Pages* → importer le dépôt
`legicite`, puis régler :

| Champ | Valeur |
|---|---|
| Répertoire racine | *(vide — la racine du dépôt)* |
| Commande de build | *(vide)* |
| Commande de deploy | `npx wrangler deploy` |

La configuration du Worker, `wrangler.toml`, est **à la racine du dépôt** : c'est
de là que Cloudflare lance `wrangler deploy` par défaut, et `main` y désigne
`relais/src/index.js`. Seul ce fichier est déployé.

Laisser la commande de build vide évite de reconstruire l'extension pour rien. Si
elle reste à `npm run build`, le déploiement fonctionne quand même, il est
seulement plus lent.

> **Premier échec rencontré, et sa cause.** Sans `wrangler.toml`, wrangler
> cherchait un dossier de fichiers statiques à publier et abandonnait faute d'en
> trouver un : `Could not detect a directory containing static files`. La présence
> de `main` lui dit de déployer un script, et le problème disparaît.

Le Worker se redéploie ensuite à chaque publication de l'extension.

## Déploiement à la main

Si la liaison Git pose problème, c'est plus court : créer un Worker « Hello
World », *Edit code*, coller `src/index.js` en entier, *Deploy*. Il n'y a rien
d'autre à configurer.

## Ensuite

Le Worker répond à `https://legicite.b-cattaertgalland.workers.dev`. Coller cette
adresse dans LégiCite :
**⚙ → Accès réseau → Relais**, mode sur « Automatique », Enregistrer.

## Sécurité

- **Liste blanche d'hôtes** : seuls les quatre domaines PISTE sont joignables.
  Sans elle, ce serait un proxy ouvert utilisable pour atteindre n'importe quoi.
- **Liste blanche d'origines** : seule l'adresse du volet peut s'en servir. À
  mettre à jour dans `src/index.js` si le volet est servi ailleurs.
- Le client ID et le secret transitent par ce Worker, qui est le vôtre. Il ne les
  stocke pas et ne les journalise pas.
