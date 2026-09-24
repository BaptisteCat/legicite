/**
 * Installe le manifeste aupres de Word, par l'outillage officiel.
 *
 * Deux etapes, et la seconde n'est pas facultative :
 *
 *   register — inscrit le chemin du manifeste dans
 *              HKCU\Software\Microsoft\Office\16.0\WEF\Developer.
 *   sideload — lance Word sur un document ou le complement est DEJA insere.
 *
 * `register` seul ne suffit pas. La galerie « Complements de Developpeur » sert
 * une liste qui peut rester figee : une entree fraichement inscrite n'y apparait
 * pas, et aucun redemarrage de Word, aucune purge du cache %LOCALAPPDATA%\
 * Microsoft\Office\16.0\Wef, aucune modification du manifeste n'y change quoi
 * que ce soit. Le refus est muet — rien dans le journal d'execution de Word.
 *
 * `sideload` contourne la galerie : il fabrique un .docx temporaire portant le
 * complement et ouvre Word dessus. Word enumere alors les manifestes et retient
 * TOUS ceux inscrits, y compris ceux qu'il ignorait jusque-la. Une fois ce
 * declic passe, le complement se comporte normalement.
 *
 * Ce diagnostic a coute cher parce que trois hypotheses intermediaires ont ete
 * prises pour des causes : un accent dans le chemin, une jonction de repertoire,
 * un emplacement sous AppData. Verification faite en faisant ouvrir les fichiers
 * par Word lui-meme, aucune des trois ne genait. Le manifeste n'a jamais ete en
 * cause, et c'est pourquoi rien n'etait journalise.
 *
 * Le manifeste du projet est inscrit tel quel : il est autonome (toutes ses URL
 * pointent vers GitHub Pages) et son emplacement est indifferent.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFESTE = join(PROJECT_DIR, "manifest.xml");

function outil(args) {
  execFileSync("npx", ["office-addin-dev-settings", ...args], {
    cwd: PROJECT_DIR,
    stdio: "inherit",
    shell: true,
  });
}

/** Inscrit le manifeste. Necessaire, pas suffisant : voir l'en-tete. */
export function enregistrer() {
  outil(["register", MANIFESTE]);
}

/** Lance Word avec le complement insere. C'est ce qui le rend visible. */
export function chargerDansWord() {
  outil(["sideload", MANIFESTE, "desktop"]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  enregistrer();
  console.log("Manifeste inscrit.");
  chargerDansWord();
  console.log("");
  console.log("Word s'ouvre sur un document ou LegiCite est deja charge.");
  console.log("Le complement est desormais connu de Word : il figure dans");
  console.log("Accueil > Complements > Complements de Developpeur, et le bouton");
  console.log("du ruban apparait dans l'onglet Accueil.");
}
