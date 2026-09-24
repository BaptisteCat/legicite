/**
 * Publie LegiCite sur GitHub Pages.
 *
 * GitHub Pages sert le dossier docs/ de la branche main. Publier revient donc a
 * committer la sortie du build et a pousser — il n'y a ni serveur a heberger,
 * ni chaine d'integration a surveiller.
 *
 * Appele par `npm run deploy`, qui construit d'abord.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { rafraichirCopie } from "./installer-word.mjs";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd: PROJECT_DIR, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    console.error(`git ${args.join(" ")} a echoue :`);
    console.error((result.stderr || result.stdout || "").trim());
    process.exit(1);
  }
  return (result.stdout || "").trim();
}

if (!existsSync(join(PROJECT_DIR, "docs", "taskpane.html"))) {
  console.error("docs/ est absent ou incomplet. Lancez `npm run build` d'abord.");
  process.exit(1);
}

if (!existsSync(join(PROJECT_DIR, ".git"))) {
  console.error("Ce dossier n'est pas un depot git. Lancez `git init` puis reliez-le a GitHub.");
  process.exit(1);
}

git(["add", "-A"]);

const staged = git(["diff", "--cached", "--name-only"]);
if (!staged) {
  console.log("Rien a publier : le contenu est deja a jour.");
  process.exit(0);
}

const horodatage = new Date().toISOString().slice(0, 16).replace("T", " ");
git(["commit", "-m", `Publication du ${horodatage}`]);
git(["push"]);

let url = "https://baptistecat.github.io/legicite/";
try {
  const remote = execFileSync("git", ["remote", "get-url", "origin"], { cwd: PROJECT_DIR, encoding: "utf8" }).trim();
  const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(remote);
  if (match) url = `https://${match[1].toLowerCase()}.github.io/${match[2]}/`;
} catch {
  /* on garde l'URL par defaut */
}

// Le manifeste enregistre aupres de Word est une copie prise hors du projet
// (voir tools/installer-word.mjs). On la rafraichit ici pour qu'elle ne derive
// pas de l'original : sans cela, une modification du manifeste resterait sans
// effet tant que l'installation n'aurait pas ete refaite a la main.
const copie = rafraichirCopie();

console.log(`Publie. GitHub Pages met le site a jour en une minute environ :\n  ${url}taskpane.html`);
console.log(`Manifeste installe rafraichi : ${copie}`);
