/**
 * Installe le manifeste aupres de Word.
 *
 * Le manifeste est copie hors du projet, puis c'est la COPIE qui est enregistree
 * dans le registre. Ce detour n'est pas une precaution de style : il contourne
 * deux refus silencieux de Word, constates sur ce poste.
 *
 *   1. Word ignore un manifeste dont le chemin contient un caractere accentue.
 *      Le dossier du projet s'appelle encore « LégiWord ».
 *   2. Word ignore aussi un manifeste atteint par une JONCTION de repertoire :
 *      il la resout jusqu'au dossier reel, et retrouve l'accent. La jonction
 *      « LegiCite » creee pour masquer l'accent ne reglait donc rien — les trois
 *      autres complements de ce poste, tous a un chemin reel sans accent, se
 *      chargent ; seul celui-ci, derriere une jonction, restait invisible.
 *
 * Dans les deux cas Word n'ecrit rien dans son journal d'execution : le
 * complement est simplement absent de la galerie. C'est ce silence qui rend le
 * diagnostic long, et qui justifie de ne plus dependre du chemin du projet.
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

/** Dossier d'installation : reel, sans accent, hors du projet. */
export const DOSSIER_INSTALL = join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || "", "AppData", "Local"),
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
