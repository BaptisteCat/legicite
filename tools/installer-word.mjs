/**
 * Installe le manifeste aupres de Word.
 *
 * Le manifeste est copie hors du projet, puis c'est la COPIE qui est enregistree
 * dans le registre. Ce detour tient a une contrainte mesuree sur ce poste :
 *
 *   **Word ne lit pas un manifeste place sous %LOCALAPPDATA% ou %APPDATA%**,
 *   du moins pas dans un dossier cree apres coup. Office en Click-to-Run
 *   virtualise ces deux arborescences et n'y voit pas les nouveaux dossiers.
 *
 * Constate en faisant ouvrir les fichiers par Word lui-meme (Documents.Open),
 * ce qui distingue « Word ne trouve pas le fichier » de « Word rejette le
 * manifeste » — un rejet, lui, apparait dans le journal d'execution :
 *
 *   Documents\LegiCite\          ouvert      <- emplacement retenu
 *   <profil>\<dossier neuf>\     ouvert
 *   AppData\Local\LegiCite\      introuvable
 *   AppData\Roaming\LegiCite\    introuvable
 *
 * Le meme essai a innocente deux suspects retenus a tort auparavant : un chemin
 * accentue s'ouvre sans probleme, et une jonction de repertoire aussi.
 *
 * Le manifeste est autonome — toutes ses URL pointent vers GitHub Pages — donc
 * la copie fonctionne aussi bien que l'original. `npm run deploy` rafraichit la
 * copie a chaque publication pour qu'elle ne derive pas.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(PROJECT_DIR, "manifest.xml");

/**
 * Dossier d'installation. Sous Documents, et surtout PAS sous AppData : voir
 * l'en-tete. C'est aussi la ou vit TextCompare, qui se charge sans histoire.
 */
export const DOSSIER_INSTALL = join(
  process.env.USERPROFILE || "",
  "Documents",
  "LegiCite"
);
export const MANIFESTE_INSTALL = join(DOSSIER_INSTALL, "manifest.xml");

const CLE = "HKCU\\Software\\Microsoft\\Office\\16.0\\WEF\\Developer";

/** Lit l'<Id> du manifeste : c'est lui qui nomme l'entree du registre. */
function identifiant() {
  const xml = readFileSync(SOURCE, "utf8");
  const match = /<Id>\s*([0-9a-fA-F-]{36})\s*<\/Id>/.exec(xml);
  if (!match) throw new Error("Aucun <Id> lisible dans manifest.xml");
  return match[1];
}

/** Copie le manifeste a l'emplacement d'installation. Sans toucher au registre. */
export function rafraichirCopie() {
  mkdirSync(DOSSIER_INSTALL, { recursive: true });
  copyFileSync(SOURCE, MANIFESTE_INSTALL);
  return MANIFESTE_INSTALL;
}

/** Copie le manifeste ET l'enregistre aupres de Word. */
export function installer() {
  const id = identifiant();
  rafraichirCopie();
  execFileSync("reg", ["add", CLE, "/v", id, "/t", "REG_SZ", "/d", MANIFESTE_INSTALL, "/f"], {
    stdio: "ignore",
  });
  return { id, chemin: MANIFESTE_INSTALL };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { id, chemin } = installer();
  console.log(`Manifeste installe : ${chemin}`);
  console.log(`Enregistre sous l'identifiant ${id}.`);
  console.log("");
  console.log("Fermez completement Word et rouvrez-le : la liste des complements de");
  console.log("developpement n'est lue qu'au demarrage. Le complement apparait ensuite");
  console.log("dans Accueil > Complements > Complements de Developpeur.");
}
