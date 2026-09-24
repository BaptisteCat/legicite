# LégiCite

Extension Word de citation et de consultation des textes légaux français, adossée à
l'API Légifrance (plateforme PISTE).

Deux usages :

- **Citer** un article *in extenso* sans quitter le document — `/art 111-1 cpen`
- **Consulter** un article visé dans un texte — sélection, clic droit, volet latéral

Aucun modèle de langage n'intervient : la résolution des références est déterministe
et locale. **Aucun serveur non plus** : le volet est servi par GitHub Pages et appelle
l'API Légifrance directement depuis le navigateur.

> Hébergé sur <https://baptistecat.github.io/legicite/>

---

## Prérequis

- **Word Microsoft 365 récent, sous Windows.** WordApi 1.6 est nécessaire au
  déclenchement de `/art` à la frappe, WordApi 1.5 aux notes de bas de page.
  Sans eux l'extension fonctionne, mais en mode dégradé (le volet le signale).
- **Un compte PISTE** avec une application abonnée à l'API Légifrance
  ([piste.gouv.fr](https://piste.gouv.fr)). L'accès est gratuit après inscription.

---

## Installation

L'extension est hébergée : il n'y a rien à construire ni à lancer. Il suffit
d'enregistrer le manifeste auprès de Word, une fois.

```bash
npm run install:word
```

Le script fait deux choses, et la seconde n'est pas facultative :

- **`register`** inscrit le chemin du manifeste dans
  `HKCU\Software\Microsoft\Office\16.0\WEF\Developer` ;
- **`sideload`** lance Word sur un document où le complément est déjà inséré.

Word s'ouvre alors avec LégiCite chargé. Le complément figure ensuite dans
*Accueil → Compléments → Compléments de Développeur*, et le bouton du ruban
apparaît dans l'onglet *Accueil*.

Enfin, ouvrir le volet, bouton **⚙**, et coller le client ID et le secret PISTE.

### Pourquoi `register` seul ne suffit pas

> **La galerie « Compléments de Développeur » sert une liste qui peut rester
> figée.** Une entrée fraîchement inscrite n'y apparaît pas — et rien ne le
> signale.

Ni un redémarrage de Word, ni la purge complète de
`%LOCALAPPDATA%\Microsoft\Office\16.0\Wef`, ni une modification du manifeste n'y
changent quoi que ce soit. Le refus est **muet** : aucune ligne dans le journal
d'exécution de Word, alors que ce journal nomme les manifestes qu'il rejette pour
une autre raison.

`sideload` contourne la galerie : il fabrique un `.docx` temporaire portant le
complément et ouvre Word dessus. Word énumère alors les manifestes et retient
**tous** ceux qui sont inscrits, y compris ceux qu'il ignorait. Après ce déclic,
le complément se comporte normalement.

Ce diagnostic a coûté cher parce que trois hypothèses intermédiaires ont été
prises pour des causes, et documentées comme telles :

| Hypothèse | Verdict |
|---|---|
| un accent dans le chemin du manifeste | fausse |
| une jonction de répertoire vers ce chemin | fausse |
| un emplacement sous `AppData` | fausse |

Chacune reposait sur une corrélation observée à travers la galerie. Ce qui a
tranché, c'est de **faire ouvrir chaque fichier par Word lui-même** via
`Documents.Open` en automatisation COM : aucune des trois ne gênait Word. Le
manifeste n'a jamais été en cause, et c'est précisément pour cela que rien
n'était journalisé.

La leçon vaut au-delà d'ici : quand Office ignore un complément **en silence**,
le manifeste est le mauvais endroit où chercher. Un manifeste refusé, lui, se
plaint.

---

## Le CORS : données en direct, authentification par relais

Les deux moitiés de l'API ne se comportent pas de la même façon, et c'est toute la
difficulté du montage.

**Les données passent en direct.** `/search`, `/consult/getArticle` et `/list/code`
renvoient un CORS complet — contrôle préalable avec `access-control-allow-origin`,
`-methods` et `-headers`, et en-tête sur la réponse réelle — depuis n'importe
quelle origine.

**L'authentification, non.** Mesuré, en production comme en bac à sable :

| Requête vers `oauth.piste.gouv.fr/api/oauth/token` | Réponse |
|---|---|
| Sans en-tête `Origin` (appel serveur) | **400** — l'erreur OAuth normale |
| Avec en-tête `Origin` (appel navigateur) | **403**, sans aucun en-tête CORS |

Une page web ne peut donc pas obtenir de jeton. Et sans jeton, rien ne fonctionne.

### Relais pour l'authentification

`relais/` contient un Cloudflare Worker d'une centaine de lignes qui fait
la seule chose qui manque : émettre la requête de jeton côté serveur, sans en-tête
`Origin`, et renvoyer la réponse avec les en-têtes CORS. Gratuit, déployé sur votre
compte, rien à faire tourner sur le poste. Les instructions sont dans
`relais/README.md` ; l'adresse obtenue se colle dans ⚙ → *Accès réseau* → **Relais**.

Environ un appel par heure, le jeton étant valable une heure.

**LégiCite ne bascule sur le relais que pour l'hôte qui en a besoin** : les appels
de données continuent d'aller directement à Légifrance. Le mode retenu est mémorisé
par hôte, pas pour toute la session.

### Une fausse piste qui a coûté deux semaines

Les routes de santé `/consult/ping` et `/search/ping` répondent au contrôle
préalable avec `access-control-allow-headers` et `-methods`, mais **omettent
`access-control-allow-origin`**. Le bouton « Tester la connexion » interrogeait
précisément ces routes : on en a conclu que l'API entière refusait le CORS, et tout
le trafic — authentification comprise — a été détourné vers un relais local. Le
montage fonctionnait, donc rien ne signalait l'erreur de diagnostic.

Le test porte désormais sur un endpoint réel, et distingue explicitement l'échec
d'authentification de l'échec d'un point d'entrée.

---

## Utilisation

### Citer

| Entrée | Comment |
|---|---|
| Dans le document | Tapez `/art 111-1 cpen` puis **Entrée** |
| Dans le volet | Le préfixe est facultatif : `111-1 cpen` suffit |
| Ruban | Onglet *Accueil*, groupe **LégiCite** |

```
/art  111-1 cpen                 un article
/art  111-1, 111-2 et 111-3 cpen une liste
/art  111-1 à 111-5 cpen         une plage
/artv 1353 cciv 2020             version en vigueur en 2020
/artv 1353 cciv 15/03/2020       version à une date précise
```

Le mot **à** est le seul séparateur de plage : le tiret ne peut pas l'être,
puisque les numéros d'articles en contiennent déjà (`L. 622-1-1`).

Les plages sont résolues via le **sommaire du code**, jamais par incrémentation :
la numérotation n'est pas arithmétique (`bis`, `ter`, articles intercalaires,
articles abrogés).

### Citer un article déjà annoncé — `/citart`

Dans un acte ou des conclusions, la citation est presque toujours introduite. La
commande `/citart` évite de renseigner deux fois le même article :

```
L'article 121-5 du code pénal dispose que :
/citart
```

L'extension relit les paragraphes précédents, y repère la référence annoncée et
insère l'article. La phrase introductive est libre — `Aux termes de l'article 1353
du Code civil :`, `Il résulte de l'article 700 du CPC que`, `C. civ., art. 1353` :
c'est le même analyseur que celui du clic droit et de la vérification du document.

Comme la phrase nomme déjà l'article, **l'intitulé est masqué par défaut**.
`/citart 2020` cite l'article annoncé dans sa version d'alors. Si aucune référence
n'est trouvée, **rien n'est inséré et la commande reste en place**.

### Versions datées

`/artv` suit le parcours suivant :

1. Vous donnez une **année** (ou directement une date complète).
2. Si l'année tombe dans une période stable → insertion directe.
3. Si l'article a changé cette année-là → les versions de l'année s'affichent avec
   leurs périodes, un clic tranche.
4. Si l'article n'existait pas ou était abrogé → message indiquant la période
   d'existence réelle, **rien n'est inséré**.

### Le bouton du ruban bascule le volet

Le bouton **LégiCite** de l'onglet *Accueil* ouvre **et referme** le volet. Cela
suppose un **runtime partagé** (`SharedRuntime 1.1`) : le volet, les commandes du
ruban et le déclencheur `/art` partagent alors un seul contexte d'exécution, qui
survit à la fermeture du volet.

Le manifeste déclare donc `ExecuteFunction` et non `ShowTaskpane` — ce dernier
ouvre à chaque clic sans jamais refermer. La fonction `basculerVolet` appelle
`Office.addin.hide()` ou `Office.addin.showAsTaskpane()` selon l'état courant,
suivi par `Office.addin.onVisibilityModeChanged`.

> **Effet de bord bienvenu** : le déclencheur `/art` ne fonctionnait jusqu'ici que
> volet ouvert, puisqu'il vivait dans la page du volet. Avec le runtime partagé et
> un démarrage réglé sur `load`, il fonctionne **volet fermé**.

Le clic droit *Consulter dans LégiCite*, lui, reste en `ShowTaskpane` : il doit
toujours ouvrir, jamais refermer.

### Logo

`assets/logo.svg` est la source de vérité, et les PNG du manifeste en dérivent :

```bash
npm run icons
```

Monogramme L + C sur le dégradé de marque, en diagonale, légèrement superposés,
le L un peu plus haut que le C. Deux choix méritent d'être connus avant toute
retouche :

- Les lettres sont les **vraies courbes** de Playfair Display SemiBold Italic —
  la police du wordmark — extraites du woff2 du kit et converties en tracés. Le
  SVG ne dépend donc d'aucune police installée sur la machine.
- Les couleurs sont **lues dans `juritel-design.css`** (`--jt-grad-a`,
  `--jt-grad-b`, `--jt-cta-ink`). Retoucher la palette du kit et relancer
  `npm run icons` suffit : le logo suit la charte sans intervention.

La composition se règle par quatre constantes en tête de `tools/generate-icons.mjs` :
hauteur de capitale, chevauchement, décalage vertical, marge.

### Charte graphique

L'interface suit la charte commune aux extensions Word du cabinet, matérialisée
par le kit `juritel-kit`. Les fichiers du kit vivent dans `src/` et **ne se
modifient jamais sur place** : une retouche se fait dans le kit, puis on
resynchronise.

```bash
node ../juritel-kit/tools/sync-kit.js src            # mettre à niveau
node ../juritel-kit/tools/sync-kit.js src --check    # signaler les écarts
grep -nE '#[0-9a-fA-F]{3,8}\b' src/*.css             # ne doit sortir que le kit
```

`src/legicite.css` est la seule feuille propre à l'extension : onglets, encarts
de message, aperçu d'article, fenêtre de réglages. Elle n'emploie que des jetons
`--jt-*`, d'où le thème sombre sans travail supplémentaire.

Le build copie le kit dans `docs/` **tel quel** : ni empaqueté, ni minifié. La
minification casserait des déclarations volontairement dupliquées, comme le
`-webkit-text-stroke` de `.brand-initial` dont la première forme sert de repli
aux navigateurs sans `color-mix`.

### Composition des citations

Le bouton **⚙** ouvre une fenêtre où chaque élément s'active et se règle
indépendamment, avec un aperçu en direct : intitulé (forme, casse, position),
mention de version (emplacement, formulation), guillemets, italique, retraits,
espacements, alignement, police, référence courte, mention de source, citations
groupées.

Quatre **présélections** (Bloc, Inline, Note, Brut) servent de point de départ.

> Le gras et l'italique sont **toujours** ceux réglés ici, jamais ceux hérités du
> texte qui précède la citation. La police, le corps et la couleur, eux, suivent le
> document — sauf à les imposer explicitement.

### Vérifier

L'onglet **Vérifier** balaye le document, repère les articles visés et signale ceux
qui ont été abrogés ou modifiés récemment. Il travaille sur le **texte visible** :
un document reçu d'un confrère est donc vérifiable au même titre.

> Ce que la vérification ne peut pas dire : si le texte cité correspondait à la
> version en vigueur au moment de la rédaction. Cette information n'existe pas dans
> le fichier.

### Abréviations

48 codes reconnus, avec plusieurs graphies chacun : `cciv`, `C. civ.`, `c civ`,
`CIV`, `code civil` mènent tous au Code civil.

Six saisies ne sont **jamais** résolues automatiquement et ouvrent une liste de
choix : `cc`, `cp`, `cs`, `ce`, `cca`, et `cpce` — qui désigne dans l'usage aussi
bien le code des procédures civiles d'exécution (`cpcex`) que celui des postes et
communications électroniques (`cpost`).

Vos propres abréviations se définissent dans les réglages. Deux systèmes distincts
coexistent : l'abréviation de **saisie** (`cpen`) et celle d'**affichage**
(`C. pén.`), toutes deux modifiables.

---

## Développement

```bash
npm install
npm run dev        # webpack-dev-server sur https://localhost:3000
```

Pour tester en local plutôt que depuis GitHub Pages, remplacer temporairement
l'URL du manifeste par `https://localhost:3000`, ou enregistrer un second
manifeste avec un autre `<Id>`.

### Publier

```bash
npm run deploy
```

Construit dans `docs/`, committe et pousse. GitHub Pages sert ce dossier depuis la
branche `main` et se met à jour en une minute environ. Il n'y a ni chaîne
d'intégration à surveiller, ni serveur à redémarrer.

```bash
npm test        # 134 tests
npm run typecheck
npm run validate  # validation du manifeste
```

### Organisation du code

```
src/
  core/          logique pure, testable sans Word ni réseau
    normalize.ts       normalisation des saisies, distance d'édition
    abbreviations.ts   résolution des codes, collisions, suggestions
    parser.ts          grammaire /art, /artv et /citart
    references.ts      détection des références dans du texte rédigé
    versions.ts        résolution temporelle (année, date, hors période)
    blocks.ts          format pivot entre l'API et Word
    html-to-blocks.ts  conversion du HTML Légifrance
    citation-style.ts  modèle de composition et présélections
    citation.ts        composition d'une citation
  api/           accès réseau (OAuth PISTE, client, cache)
  services/      orchestration : commande → article prêt à insérer
  word/          intégration Office.js
  taskpane/      interface du volet
  dialog/        fenêtre de réglages
  settings/      réglages
docs/            sortie du build, servie par GitHub Pages
tests/           134 tests sur la logique pure
```

---

## Si l'extension n'apparaît pas

**Le premier réflexe, et il suffit presque toujours :**

```bash
npm run install:word
```

`sideload` force Word à réénumérer les manifestes inscrits. C'est le seul geste
qui débloque une galerie figée, et il est sans effet de bord.

Si cela ne suffit pas :

1. **Le manifeste est-il inscrit ?**
   ```bash
   npx office-addin-dev-settings registered
   ```
   L'outil doit citer `5297a284-1216-4fd6-864a-8d21bfcaa5e7` et le chemin du
   `manifest.xml` du projet. Le nom donné à la valeur du registre est sans
   importance ; son emplacement aussi, accents compris.
2. **Le manifeste est-il valide ?**
   ```bash
   npm run validate
   ```
3. **Que dit le journal de Word ?** Activez-le, videz-le, redémarrez Word :
   ```powershell
   New-Item "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer\RuntimeLogging" -Force | Out-Null
   Set-ItemProperty "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer\RuntimeLogging" `
     -Name "(default)" -Value "C:\Users\bcatt\legicite-runtime.log"
   ```
   Il nomme les manifestes refusés **et la raison**. Un silence complet ne veut
   pas dire « tout va bien » : il veut dire que le manifeste n'est pas en cause,
   et qu'il faut chercher du côté de l'inscription (point 1) — c'est exactement
   le piège décrit dans *Pourquoi `register` seul ne suffit pas*.
4. **Le site répond-il ?** <https://baptistecat.github.io/legicite/taskpane.html>
5. **Un complément de développement n'apparaît pas dans le ruban tout seul.**
   Il faut l'insérer une première fois — ce que `sideload` fait pour vous.

---

## Conformité

Les données proviennent de Légifrance et sont diffusées sous **Licence Ouverte
2.0** : réutilisation libre, sous réserve de mentionner la source et la date
d'extraction. L'option correspondante est active par défaut dans les réglages.

L'usage de l'API est soumis aux CGU de l'API Légifrance et à celles de PISTE.

Le client ID et le secret PISTE sont conservés dans le stockage local de Word, sur
le poste de l'utilisateur. Ils ne figurent pas dans ce dépôt et ne transitent par
aucun tiers : les appels vont du navigateur directement à PISTE.

LégiCite n'est pas un service officiel et n'émane ni de la DILA ni de Légifrance.
