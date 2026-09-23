# LégiWord

Extension Word de citation et de consultation des textes légaux français, adossée à
l'API Légifrance (plateforme PISTE).

Deux usages :

- **Citer** un article *in extenso* sans quitter le document — `/art 111-1 cpen`
- **Consulter** un article visé dans un texte — sélection, clic droit, volet latéral

Aucun modèle de langage n'intervient : la résolution des références est déterministe et
locale, seuls les appels à l'API Légifrance sortent du poste.

---

## Prérequis

- **Word Microsoft 365 récent, sous Windows.** WordApi 1.6 est nécessaire au
  déclenchement de `/art` à la frappe, WordApi 1.5 aux notes de bas de page.
  Sans eux l'extension fonctionne, mais en mode dégradé (le volet le signale).
- **Node.js 20 ou plus**, pour construire l'extension.
- **Un compte PISTE** avec une application abonnée à l'API Légifrance
  ([piste.gouv.fr](https://piste.gouv.fr)). L'accès est gratuit après inscription.

---

## Installation

```bash
npm install
npm run icons
npm run build
npm run autostart
```

`npm run autostart` installe un lanceur dans le dossier Démarrage de Windows. Le
serveur LégiWord se lance dès lors **à chaque ouverture de session, sans fenêtre**,
et l'extension est opérationnelle dès l'ouverture de Word — rien à démarrer à la
main. Le certificat local est généré au premier lancement (Windows demandera de
l'approuver).

Un seul processus suffit : il sert à la fois le volet et le relais vers l'API
Légifrance, sur le même port.

| Commande | Effet |
|---|---|
| `npm run autostart` | Installe le démarrage automatique et lance le serveur |
| `npm run autostart:status` | État du lanceur et du serveur |
| `npm run autostart:stop` | Arrête le serveur (le lanceur reste installé) |
| `npm run autostart:remove` | Désinstalle le démarrage automatique |
| `npm run serve` | Lance le serveur au premier plan, pour voir ses journaux |

> **Pourquoi c'est nécessaire.** Si rien ne répond sur `https://localhost:3000` au
> moment où Word construit sa liste de compléments, Word ne se contente pas
> d'afficher un volet vide : il **retire le complément de la galerie**, sans message.
> L'extension paraît désinstallée alors qu'elle est seulement privée de son serveur.
> C'est le symptôme d'un serveur arrêté, jamais d'une régression du code.

### Développement

```bash
npm run autostart:stop   # libère le port 3000
npm run dev              # webpack en mode watch, avec rechargement à chaud
```

Le serveur de développement expose le même point `/relay`, le comportement est donc
identique en développement et en production. Pensez à relancer
`npm run build && npm run autostart` en sortant du mode développement.

Puis, dans une autre console, chargez l'extension dans Word :

```bash
npm start
```

Cette commande ouvre Word avec le manifeste chargé. Pour l'installer à la main,
copiez `manifest.xml` dans un dossier partagé et déclarez ce dossier comme
catalogue d'add-ins : *Fichier → Options → Centre de gestion de la confidentialité
→ Paramètres du Centre de gestion → Catalogues de compléments approuvés*.

> **Fermez Word avant de lancer `npm start`.** Word ne lit la liste des add-ins de
> développement **qu'à son démarrage**. Si une instance tourne déjà, le manifeste est
> bien enregistré dans le registre mais Word l'ignore, et l'ouverture du document de
> test affiche « Ce complément n'est plus disponible ». Il faut alors fermer
> complètement Word et le rouvrir.

### Chemin du manifeste : le piège de l'accent

> **Word ne charge pas un manifeste dont le chemin contient un caractère accentué.**

Le dossier du projet s'appelant `LégiWord`, son `manifest.xml` était purement et
simplement ignoré : enregistré dans le registre, valide au validateur Microsoft,
servi en HTTPS — et pourtant absent de la galerie des compléments, sans le moindre
message d'erreur. Trois autres add-ins du même poste, tous à des chemins ASCII, se
chargeaient normalement. Le diagnostic a été établi en enregistrant côte à côte deux
manifestes identiques, l'un à un chemin accentué et l'autre non : seul le second
apparaissait.

**Solution retenue : une jonction de répertoire.** Plutôt que de renommer le dossier
— impossible tant qu'un éditeur, un terminal ou un serveur l'a pour répertoire
courant — on lui donne un second chemin, sans accent :

```powershell
New-Item -ItemType Junction -Path "C:\Users\bcatt\LegiWord" -Target "C:\Users\bcatt\LégiWord"
```

```powershell
$k = "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
New-ItemProperty $k -Name "LegiWord" -Value "C:\Users\bcatt\LegiWord\manifest.xml" -PropertyType String -Force
```

Ce n'est pas une copie : c'est le même fichier vu à travers un chemin ASCII. Le
dossier garde son nom, il n'y a qu'un seul `manifest.xml`, et rien à synchroniser.
Vérifié en conditions réelles : Word charge le complément par ce chemin.

### Autres causes si l'extension n'apparaît pas

1. **Word tournait-il déjà ?** Word ne lit la liste des compléments de développement
   qu'à son démarrage. Fermez toutes les fenêtres, rouvrez.
2. **Vérifiez l'enregistrement** — dans PowerShell :
   ```powershell
   Get-ItemProperty "HKCU:\Software\Microsoft\Office\16.0\WEF\Developer"
   ```
3. **Vérifiez le serveur** : `https://localhost:3000/taskpane.html` doit répondre.
4. **Videz le cache** de Word si un essai précédent a échoué :
   `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` — supprimez `AddinInfo`,
   `AggregatedCache` et `AppCommands`, qui sont régénérés au démarrage.
5. **Un complément de développement n'apparaît pas dans le ruban tout seul.**
   Il faut l'insérer une première fois : *Accueil → Compléments →
   Compléments de Développeur*.

### Configuration des identifiants

Ouvrez le volet, onglet **Réglages**, et collez le client ID et le secret de votre
application PISTE, puis **Tester la connexion**.

> Le secret est conservé en clair dans le stockage local de Word, sur ce poste.
> C'est le meilleur niveau atteignable pour une extension web : le code d'un
> add-in est intégralement lisible côté client, un secret embarqué serait public.
> À ne pas utiliser sur un poste partagé.

### Le relais local

Un add-in Word s'exécute dans un navigateur et reste soumis à la politique CORS.

**Vérifié en conditions réelles : l'appel direct à l'API Légifrance est bloqué.**
`api.piste.gouv.fr` ne renvoie pas d'en-tête `Access-Control-Allow-Origin`, le
navigateur refuse donc la requête quels que soient les identifiants. Le relais local
n'est pas une précaution théorique, il est **nécessaire**.

Le relais est **monté sur la même origine que le volet**, sous `/relay`, et servi par
le même processus. C'est ce qui évite d'un seul coup le CORS, le blocage de contenu
mixte et le contrôle Private Network Access — et surtout, cela supprime le second
serveur qu'il fallait lancer à la main.

Il n'écoute que sur la boucle locale et n'accepte que les quatre domaines PISTE
(liste blanche stricte : sans elle, ce serait un proxy ouvert utilisable par
n'importe quelle page pour atteindre le réseau interne). Aucun identifiant n'y est
stocké : ils transitent depuis le volet à chaque appel.

Le choix « aucun serveur à héberger » reste tenable : rien ne sort du poste hormis
les appels à Légifrance eux-mêmes.

---

## Utilisation

### Citer

Trois entrées possibles, toutes branchées sur le même moteur :

| Entrée | Comment |
|---|---|
| Dans le document | Tapez `/art 111-1 cpen` puis **Entrée** |
| Dans le volet | Le préfixe est facultatif : `111-1 cpen` suffit |
| Ruban | Onglet *Accueil*, groupe **LégiWord** |

Syntaxes acceptées :

```
/art  111-1 cpen                 un article
/art  111-1, 111-2 et 111-3 cpen une liste
/art  111-1 à 111-5 cpen         une plage
/artv 1353 cciv 2020             version en vigueur en 2020
/artv 1353 cciv 15/03/2020       version à une date précise
```

Le mot **à** est le seul séparateur de plage : le tiret ne peut pas l'être,
puisque les numéros d'articles en contiennent déjà (`L. 622-1-1`).

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

Comme la phrase nomme déjà l'article, **l'intitulé est masqué par défaut** pour ne
pas le répéter. Trois réglages : masquage de l'intitulé, nombre de paragraphes
remontés (3 par défaut), et citation de tous les articles annoncés ou du premier
seulement.

`/citart 2020` et `/citart 15/03/2020` citent l'article annoncé dans sa version
d'alors.

Si aucune référence n'est trouvée, **rien n'est inséré et la commande reste en
place** : le message indique ce qui a été lu, il n'y a qu'à corriger la phrase.

Les plages sont résolues via le **sommaire du code**, jamais par incrémentation :
la numérotation n'est pas arithmétique (`bis`, `ter`, articles intercalaires,
articles abrogés).

### Versions datées

`/artv` suit le parcours suivant :

1. Vous donnez une **année** (ou directement une date complète).
2. Si l'année tombe dans une période stable → insertion directe.
3. Si l'article a changé cette année-là → les versions de l'année s'affichent avec
   leurs périodes, un clic tranche. Un champ permet aussi de saisir `JJ/MM`.
4. Si l'article n'existait pas ou était abrogé → message indiquant la période
   d'existence réelle, **rien n'est inséré**.

### Composition des citations

Le bouton **⚙** du volet ouvre une fenêtre de réglages où chaque élément de la
citation s'active et se règle indépendamment, avec un aperçu qui se met à jour en
direct :

- **Intitulé** — présence, forme longue ou courte, gras / italique / souligné,
  sur sa propre ligne ou en tête du texte
- **Mention de version** — présence, emplacement (sous l'intitulé, à la suite du
  texte, ou en note), formulation complète ou date seule, parenthèses, italique
- **Texte** — guillemets français, anglais ou aucun, guillemet ouvrant répété à
  chaque alinéa, italique, gras
- **Mise en forme** — retrait du bloc, retrait de première ligne, espacements,
  alignement, taille, police, interligne
- **Référence et source** — référence courte accolée au texte, mention de source
  dans le corps ou en note, date de consultation
- **Citations groupées** — ligne vide entre articles, rappel de l'intitulé

Quatre **présélections** (Bloc, Inline, Note, Brut) servent de point de départ ;
toute modification donne un style personnalisé.

Aucune citation ne comporte de lien hypertexte. La structure des articles est
reproduite fidèlement : les tableaux deviennent de vrais tableaux Word, les listes
des listes, les alinéas sont préservés. **Ce qui n'est pas explicitement demandé
n'est pas imposé** : sans réglage de mise en forme, la citation suit le style du
document d'accueil.

### Latence

Le chemin entre `/art 111-1 cpen` et l'article inséré a été optimisé :

- **préchargement pendant la frappe** — l'article est récupéré avant la validation,
  la touche Entrée ne déclenche plus qu'une écriture locale ;
- **accès en temps constant au paragraphe** de la commande, au lieu de parcourir
  tout le document à chaque appui sur Entrée ;
- **résolution parallèle** des listes et des plages, au lieu d'une file séquentielle ;
- **serveur en double pile IPv4/IPv6** : `localhost` se résolvant d'abord en `::1`
  sous Windows, un serveur IPv4 seul faisait payer ~200 ms de repli à chaque
  connexion.

Au-delà d'un seuil configurable (2 000 caractères par défaut), un avertissement
propose d'insérer l'intégralité ou les premiers alinéas.

### Consulter

Sélectionnez « l'article 1353 du Code civil », clic droit → **Consulter dans
LégiWord**. Le volet propose l'article repéré dans la sélection.

Le site legifrance.gouv.fr ne peut pas être affiché en iframe ; le volet rend
lui-même le contenu renvoyé par l'API.

### Vérifier

L'onglet **Vérifier** balaye le document, repère les articles visés et signale ceux
qui ont été abrogés ou modifiés récemment. Il travaille sur le **texte visible** :
les références rédigées à la main sont traitées au même titre que celles insérées
par l'extension — un document reçu d'un confrère est donc vérifiable.

> Ce que la vérification ne peut pas dire : si le texte cité correspondait à la
> version en vigueur au moment de la rédaction. Les citations n'étant pas ancrées,
> cette information n'existe pas dans le fichier.

### Abréviations

48 codes sont reconnus par défaut, avec plusieurs graphies chacun : `cciv`,
`C. civ.`, `c civ`, `CIV`, `code civil` mènent tous au Code civil.

Six saisies ne sont **jamais** résolues automatiquement et ouvrent une liste de
choix : `cc`, `cp`, `cs`, `ce`, `cca`, et `cpce` — qui désigne dans l'usage aussi
bien le code des procédures civiles d'exécution (`cpcex`) que celui des postes et
communications électroniques (`cpost`).

Vos propres abréviations se définissent dans les réglages. Elles sont **locales à
ce poste**, prioritaires sur les défauts, et peuvent les écraser sans restriction.
Un export/import JSON permet de les transmettre à un collègue.

Deux systèmes distincts coexistent : l'abréviation de **saisie** (`cpen`, tapée
vite) et celle d'**affichage** (`C. pén.`, écrite dans le document par les modèles
`inline` et `note`). Les deux sont modifiables.

---

## Déploiement de cabinet

1. `npm run build` produit `dist/`.
2. Hébergez `dist/` derrière une URL **HTTPS**.
3. Remplacez `https://localhost:3000` par cette URL dans `manifest.xml`
   (quatre occurrences dans `Resources`, plus `SourceLocation` et les icônes).
4. Déployez le manifeste via le centre d'administration Microsoft 365
   (*Paramètres → Applications intégrées*) ou par catalogue de dossier partagé.
5. Chaque utilisateur saisit ses propres identifiants PISTE au premier lancement.

---

## Organisation du code

```
src/
  core/          logique pure, testable sans Word ni réseau
    normalize.ts       normalisation des saisies, distance d'édition
    abbreviations.ts   résolution des codes, collisions, suggestions
    parser.ts          grammaire /art et /artv
    references.ts      détection des références dans du texte rédigé
    versions.ts        résolution temporelle (année, date, hors période)
    blocks.ts          format pivot entre l'API et Word
    html-to-blocks.ts  conversion du HTML Légifrance
    citation.ts        les quatre modèles
  api/           accès réseau
    transport.ts       appel direct, bascule vers le relais local
    auth.ts            OAuth2 PISTE, cache de jeton
    legifrance.ts      client
    cache.ts           cache à durée de vie, mode hors ligne
  services/      orchestration
    articles.ts        commande analysée → article prêt à insérer
    verify.ts          vérification du document
  word/          intégration Office.js
  taskpane/      interface du volet
  settings/      réglages
tools/
  generate-icons.mjs   encodeur PNG minimal (aucune dépendance)
  legiword-proxy.mjs   relais local
tests/           90 tests sur la logique pure
```

```bash
npm test        # 90 tests
npm run typecheck
npm run build
npm run validate  # validation du manifeste
```

---

## Limites connues

Ce qui n'a **pas** pu être vérifié en conditions réelles, faute de compte PISTE et
d'un Word instrumenté :

- **La forme exacte des réponses de l'API.** Le client extrait les articles en
  parcourant récursivement les réponses plutôt qu'en suivant un chemin figé, ce qui
  le rend tolérant aux variations de structure — mais les noms de champs
  (`texteHtml`, `listArticle`, `lienArt`) restent à confirmer au premier appel réel.
- **Le comportement CORS de PISTE**, d'où la bascule automatique vers le relais.
- **Le rendu dans Word** : insertion des tableaux, notes de bas de page, listes.
- **Les quotas PISTE**, fixés par la DILA et modifiables à tout moment.

Points fonctionnels restés ouverts au cadrage :

- Les quatre modèles de citation utilisent des valeurs par défaut de style Dalloz,
  à recaler sur un exemple réel de conclusions.
- Le seuil de 2 000 caractères pour les articles longs est arbitraire.
- Le nom « LégiWord » reprend un nom de service public de l'État. Sans risque en
  interne, à trancher avant toute diffusion hors cabinet.

---

## Conformité

Les données proviennent de Légifrance et sont diffusées sous **Licence Ouverte
2.0** : leur réutilisation est libre, sous réserve de mentionner la source et la
date d'extraction. L'option « Mentionner la source » est active par défaut dans les
réglages et alimente les modèles `bloc` et `note`.

L'usage de l'API est soumis aux CGU de l'API Légifrance et aux CGU de PISTE.

LégiWord n'est pas un service officiel et n'émane ni de la DILA ni de Légifrance.
