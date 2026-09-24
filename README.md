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

```powershell
$k = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
New-Item -Path $k -Force | Out-Null
New-ItemProperty $k -Name "LegiCite" -Value "C:\Users\bcatt\LegiCite\manifest.xml" -PropertyType String -Force
```

Puis **fermer complètement Word et le rouvrir** : Word ne lit la liste des
compléments de développement qu'à son démarrage.

L'extension apparaît alors dans *Accueil → Compléments → Compléments de
Développeur*. Il faut l'y sélectionner une première fois pour qu'elle s'insère
dans le document ; le bouton du ruban apparaît ensuite.

Enfin, ouvrir le volet, bouton **⚙**, et coller le client ID et le secret PISTE.

### Le piège de l'accent

> **Word ne charge pas un manifeste dont le chemin contient un caractère accentué.**

Le dossier du projet s'appelant à l'origine `LégiWord`, son `manifest.xml` était
purement et simplement ignoré : enregistré dans le registre, valide au validateur
Microsoft, servi en HTTPS — et pourtant absent de la galerie, sans le moindre
message d'erreur. Le diagnostic a été établi en enregistrant côte à côte deux
manifestes identiques, l'un à un chemin accentué et l'autre non : seul le second
apparaissait.

D'où la **jonction de répertoire** qui donne un second chemin, sans accent, au même
dossier :

```powershell
New-Item -ItemType Junction -Path "C:\Users\bcatt\LegiCite" -Target "C:\Users\bcatt\LégiWord"
```

Ce n'est pas une copie : c'est le même fichier vu à travers un chemin ASCII.

> **Nettoyage recommandé.** Le dossier porte encore l'ancien nom, accentué. Quand
> aucun éditeur ni terminal ne l'a pour répertoire courant :
>
> ```powershell
> Move-Item "C:\Users\bcatt\LégiWord" "C:\Users\bcatt\LegiCite"
> ```
>
> Le nom devient juste **et** sans accent : la jonction n'a alors plus de raison
> d'être, il suffit d'enregistrer `C:\Users\bcatt\LegiCite\manifest.xml`
> directement et de supprimer la jonction.

---

## Le CORS, et pourquoi il n'y a pas de relais

L'API Légifrance **accepte les appels directs depuis un navigateur**. `/search`,
`/consult/getArticle` et `/list/code` renvoient un CORS complet, depuis n'importe
quelle origine — vérifié à la main sur trois origines distinctes.

Une seule exception, et elle a coûté cher : les routes de santé `/consult/ping` et
`/search/ping` répondent au contrôle préalable avec `access-control-allow-headers`
et `access-control-allow-methods`, mais **omettent `access-control-allow-origin`**.
Ce seul en-tête manquant suffit à faire rejeter la requête par le navigateur.

Le bouton « Tester la connexion » interrogeait précisément ces routes. On en a
conclu à tort que l'API ne supportait pas le CORS, et tout le trafic a été détourné
vers un relais local pendant deux semaines — sans que rien ne le signale, puisque
tout fonctionnait par ce chemin.

Le test de connexion interroge désormais un endpoint réel, et le relais a disparu.
Le réglage *Accès réseau* reste disponible pour les réseaux d'entreprise qui
bloquent les appels sortants, mais il n'est plus utilisé par défaut.

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

1. **Word tournait-il déjà ?** Il ne lit la liste des compléments de développement
   qu'à son démarrage. Fermez toutes les fenêtres, rouvrez.
2. **Le manifeste est-il enregistré ?**
   ```powershell
   Get-ItemProperty "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
   ```
3. **Le site répond-il ?** <https://baptistecat.github.io/legicite/taskpane.html>
4. **Videz le cache** de Word si un essai précédent a échoué :
   `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` — supprimez `AddinInfo`,
   `AggregatedCache` et `AppCommands`, régénérés au démarrage.
5. **Un complément de développement n'apparaît pas dans le ruban tout seul.**
   Il faut l'insérer une première fois depuis la galerie.

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
