# LégiCite — cahier des charges

> Extension Word de citation et de consultation des textes légaux français,
> adossée à l'API Légifrance (plateforme PISTE).
>
> Document de référence, tenu à jour avec le produit. Il vit dans
> `documentation/` et **non** dans `docs/`, qui est la sortie du build servie par
> GitHub Pages et vidée à chaque compilation.

---

## 1. Objectif

Deux usages, dans un seul outil :

1. **Citer** un article de loi *in extenso* dans Word, sans quitter le document.
2. **Consulter** un article visé dans un texte, par sélection et clic droit.

Cible : outil de cabinet, plusieurs postes.

---

## 2. Périmètre

**Inclus**

- Codes (fonds `CODE_DATE`) et textes non codifiés (fonds `LODA_DATE`)
- Insertion d'un article, d'une liste, d'une plage
- Insertion d'une version en vigueur à une date passée
- Citation d'un article déjà annoncé par la phrase précédente (`/citart`)
- Volet de consultation avec historique des versions et textes liés
- Vérification du document : articles modifiés ou abrogés

**Exclu**

- Jurisprudence (Judilibre, ArianeWeb), droit de l'Union, conventions collectives
- Toute intervention d'un modèle de langage
- Mise à jour automatique des citations déjà insérées — impossible, les citations
  n'étant pas ancrées (§6)

---

## 3. Architecture

| Élément | Choix | Motif |
|---|---|---|
| Type | Office Add-in (Office.js) | Déploiement centralisé possible |
| Manifeste | XML « add-in only » | Seul format acceptant l'`ExtensionPoint` de type `ContextMenu` |
| Cible | Word Microsoft 365 récent, Windows | WordApi 1.6 (surveillance des paragraphes), 1.5 (notes de bas de page) |
| Hébergement | GitHub Pages, dossier `docs/` de `main` | Aucun serveur à tenir |
| Accès API | Appels directs depuis le navigateur | L'API accepte le CORS depuis toute origine (§4) |
| Identifiants | Saisis par l'utilisateur, stockage local | Aucun serveur, quotas individuels |
| Runtime | Partagé, `lifetime="long"` | Bascule du volet au ruban, et `/art` fonctionnel volet fermé |
| Interface | Kit Juritel, jetons `--jt-*` | Unité visuelle de la suite d'extensions du cabinet |

**Sécurité.** Le secret PISTE n'est jamais écrit dans le code : celui-ci est
lisible côté client. Il est saisi par l'utilisateur et conservé dans le stockage
local du poste — non chiffré, ce que l'interface signale explicitement.

**Conformité.** Données sous Licence Ouverte 2.0 : mention de la source et de la
date d'extraction. CGU de l'API Légifrance et quotas PISTE applicables.

---

## 4. Ce qui a été tranché en conditions réelles

Quatre points ont coûté du temps et méritent d'être consignés.

### Le CORS de l'API Légifrance

`/search`, `/consult/getArticle` et `/list/code` renvoient un CORS complet, depuis
n'importe quelle origine. **Mais** les routes de santé `/consult/ping` et
`/search/ping` répondent au contrôle préalable sans
`access-control-allow-origin` : ce seul en-tête manquant suffit à faire rejeter la
requête.

Le bouton « Tester la connexion » interrogeait précisément ces routes. On en a
conclu à tort que l'API ne supportait pas le CORS, et tout le trafic a été
détourné vers un relais local pendant deux semaines. Le test porte désormais sur
un endpoint réel ; il n'y a plus de relais.

### Le chemin accentué du manifeste

**Word ignore silencieusement un manifeste dont le chemin contient un caractère
accentué.** Le complément n'apparaît pas dans la galerie, sans message d'erreur,
alors que le manifeste est enregistré, valide et servi. Établi en enregistrant
côte à côte deux manifestes identiques, l'un accentué, l'autre non.

Contourné par une jonction de répertoire donnant un second chemin ASCII au même
dossier.

### Un complément de développement ne s'affiche pas seul

Il faut l'insérer une première fois depuis *Accueil → Compléments → Compléments de
Développeur*. Le bouton du ruban n'apparaît qu'ensuite. Et Word ne lit cette liste
qu'à son démarrage : toute modification du manifeste impose de fermer Word
complètement.

### La fenêtre de dialogue ne partage pas le stockage du volet

Ouverte avec `displayInIframe: false`, elle s'exécute dans une fenêtre distincte
au stockage cloisonné. Les réglages transitent donc par la messagerie Office, le
volet restant seule autorité : il envoie l'état à l'ouverture, enregistre ce que
la fenêtre lui renvoie.

---

## 5. Grammaire des commandes

```
/art    <articles> <code>
/artv   <articles> <code> <date>
/citart [date]
```

- `<articles>` : `111-1` · `111-1, 111-2, 111-3` · `111-1 à 111-5`
- `<date>` : `2020` ou `15/03/2020`

Le tiret ne peut **jamais** séparer une plage : les numéros en contiennent déjà
(`L. 622-1-1`). Seul le mot `à` le fait.

Une plage est résolue via le **sommaire du code**, jamais par incrémentation : la
numérotation comporte des `bis`, des intercalaires et des articles abrogés.

Le découpage articles / code ne devine pas la position du code : il reconnaît les
articles à leur forme et considère le reste comme étant le code — ce qui
fonctionne même quand le code est inconnu de la table.

**Trois déclencheurs**, branchés sur le même moteur : la commande tapée dans le
document (détectée à la validation par Entrée), la barre de recherche du volet, le
bouton du ruban.

---

## 6. Résolution des références

| Situation | Comportement |
|---|---|
| Référence claire | Insertion directe |
| Abréviation ambiguë (`cc`, `cp`, `cpce`, `cs`, `ce`, `cca`) | Liste de choix, jamais de résolution automatique |
| Numéro présent dans plusieurs codes | Liste de choix |
| Abréviation mal orthographiée | Suggestions, **aucune insertion** sans confirmation |
| Abréviation d'un code abrogé (`cmp`) | Résolution vers le code en vigueur, avec avertissement |
| Article inexistant à la date demandée | Période réelle d'existence, aucune insertion |

Principe directeur : **jamais d'insertion silencieuse d'un texte non confirmé.**

Deux systèmes d'abréviations coexistent : celle de **saisie** (`cpen`) et celle
d'**affichage** (`C. pén.`), toutes deux modifiables. 48 codes par défaut, plus
les abréviations personnelles, locales au poste et prioritaires.

---

## 7. Composition des citations

Les citations sont insérées en **texte brut**, sans marqueur : parfaitement
portables, mais non modifiables automatiquement par la suite.

Chaque élément est activable et réglable indépendamment — intitulé (forme, casse,
position), mention de version (emplacement, formulation), guillemets, italique,
retraits, espacements, alignement, police, référence courte, mention de source,
citations groupées. Quatre présélections servent de point de départ.

**Le gras et l'italique sont absolus**, jamais hérités du texte qui précède : ils
correspondent à des cases à cocher, donc à une décision de l'utilisateur. La
police, le corps et la couleur, eux, suivent le document — sauf à être imposés.

La structure est reproduite fidèlement : tableaux Word, listes, alinéas.

---

## 8. Versions et dates

1. L'utilisateur saisit une **année**, ou directement une date complète.
2. Année dans une période stable → insertion directe.
3. Année couvrant plusieurs versions → les versions de l'année s'affichent avec
   leurs périodes et un aperçu ; un clic tranche, ou la saisie de `JJ/MM`.
4. Hors période d'existence → message indiquant la période réelle, rien n'est
   inséré.

---

## 9. Latence

Le chemin entre la commande et l'article inséré a été optimisé :

- **préchargement pendant la frappe** : l'article est récupéré avant validation,
  la touche Entrée ne déclenche plus qu'une écriture locale ;
- **accès en temps constant** au paragraphe de la commande, au lieu de parcourir
  tout le document à chaque appui sur Entrée ;
- **résolution parallèle** des listes et des plages ;
- **deux synchronisations Word** par insertion au lieu de trois ou quatre ;
- cache local : recherches 6 h, articles 24 h.

Reste incompressible : l'API impose deux appels successifs, une recherche puis une
consultation. Le cache et le préchargement font qu'ils ne sont payés qu'une fois.

---

## 10. Identité visuelle

L'interface suit la charte commune aux extensions du cabinet, matérialisée par le
kit `juritel-kit`. Les fichiers du kit ne se modifient jamais sur place ; une
retouche se fait dans le kit puis se resynchronise. `src/legicite.css` est la
seule feuille propre à l'extension et n'emploie que des jetons `--jt-*`.

Le logo est un monogramme **L + C** sur le dégradé de marque, en diagonale,
légèrement superposés. Les lettres sont les vraies courbes de Playfair Display
SemiBold Italic — la police du wordmark — extraites du woff2 du kit ; les couleurs
sont lues dans `juritel-design.css`. Un calage optique épaissit les déliés aux
petites tailles, le didone étant illisible à 16 px sans cela.

---

## 11. Points ouverts

1. **Exemple réel de mise en forme** — un extrait de conclusions permettrait de
   caler les présélections sur le style effectivement pratiqué, plutôt que sur des
   valeurs de style Dalloz.
2. Le dossier du projet porte encore l'ancien nom, accentué (`LégiWord`). Le
   renommer en `LegiCite` réglerait du même coup le piège de l'accent et rendrait
   la jonction inutile.
3. Confirmation du seuil de 2 000 caractères pour les articles longs.
4. Noms de champs de l'API (`texteHtml`, `listArticle`, `lienArt`) : lus de façon
   défensive, mais issus de sources communautaires et non du Swagger officiel.
