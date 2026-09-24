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
| Répertoire racine | `relais` |
| Commande de build | *(vide)* |
| Commande de deploy | `npx wrangler deploy` |

Le **répertoire racine** est le réglage qui compte : sans lui, Cloudflare
tenterait d'installer les dépendances de l'extension — dont `sharp`, qui n'a rien
à faire dans un Worker.

Le Worker se redéploie ensuite à chaque publication de l'extension.

## Déploiement à la main

Si la liaison Git pose problème, c'est plus court : créer un Worker « Hello
World », *Edit code*, coller `src/index.js` en entier, *Deploy*. Il n'y a rien
d'autre à configurer.

## Ensuite

Copier l'adresse du Worker et la coller dans LégiCite :
**⚙ → Accès réseau → Relais**, mode sur « Automatique », Enregistrer.

## Sécurité

- **Liste blanche d'hôtes** : seuls les quatre domaines PISTE sont joignables.
  Sans elle, ce serait un proxy ouvert utilisable pour atteindre n'importe quoi.
- **Liste blanche d'origines** : seule l'adresse du volet peut s'en servir. À
  mettre à jour dans `src/index.js` si le volet est servi ailleurs.
- Le client ID et le secret transitent par ce Worker, qui est le vôtre. Il ne les
  stocke pas et ne les journalise pas.
