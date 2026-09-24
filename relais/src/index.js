/**
 * Relais d'authentification PISTE — Cloudflare Worker.
 *
 * POURQUOI
 * --------
 * L'API Légifrance accepte parfaitement les appels directs depuis un navigateur :
 * `/search`, `/consult/getArticle` et `/list/code` renvoient un CORS complet.
 *
 * Le point d'AUTHENTIFICATION de PISTE, lui, les refuse. Mesuré :
 *
 *     POST oauth.piste.gouv.fr/api/oauth/token  sans en-tête Origin  → 400 (erreur OAuth normale)
 *     POST oauth.piste.gouv.fr/api/oauth/token  avec en-tête Origin  → 403, sans en-tête CORS
 *
 * en production comme en bac à sable. Une page web ne peut donc pas obtenir de
 * jeton — et sans jeton, rien ne fonctionne.
 *
 * Ce relais fait la seule chose qui manque : émettre la requête de jeton
 * côté serveur, sans en-tête Origin, et renvoyer la réponse avec les en-têtes
 * CORS qui permettent au volet de la lire. Un appel par heure environ, le jeton
 * étant valable une heure.
 *
 * Les appels de données continuent d'aller directement à Légifrance : LégiCite
 * ne bascule sur le relais que pour l'hôte qui en a besoin.
 *
 * DÉPLOIEMENT (gratuit, environ cinq minutes)
 * -------------------------------------------
 *   1. Créer un compte sur dash.cloudflare.com
 *   2. Workers & Pages → Create → Worker → lui donner un nom, par exemple « relais-piste »
 *   3. Deploy, puis « Edit code » : coller ce fichier en entier, Deploy
 *   4. Copier l'adresse du Worker (https://relais-piste.VOTRE-SOUS-DOMAINE.workers.dev)
 *   5. Dans LégiCite : ⚙ → Accès réseau → coller l'adresse dans « Relais »,
 *      laisser le mode sur « Automatique », Enregistrer
 *
 * Adapter ORIGINES_AUTORISEES ci-dessous si le volet est servi ailleurs.
 *
 * CE QUI TRANSITE
 * ---------------
 * Le client ID et le secret PISTE passent par ce Worker, qui est le vôtre.
 * Il ne les stocke pas et ne les journalise pas : il les transmet et oublie.
 */

/** Seuls hôtes joignables. Sans cette liste, le Worker serait un proxy ouvert. */
const HOTES_AUTORISES = new Set([
  "oauth.piste.gouv.fr",
  "sandbox-oauth.piste.gouv.fr",
  // Les hôtes de données sont joints en direct par le volet ; ils figurent ici
  // pour le cas d'un réseau d'entreprise qui bloquerait les appels sortants.
  "api.piste.gouv.fr",
  "sandbox-api.piste.gouv.fr",
]);

/**
 * Origines admises à utiliser ce relais.
 * Mettre à jour si le volet est servi depuis une autre adresse.
 */
const ORIGINES_AUTORISEES = new Set([
  "https://baptistecat.github.io",
  // Utile en développement :
  "https://localhost:3000",
]);

const EN_TETES_TRANSMIS = ["authorization", "content-type", "accept"];

function enTetesCors(origine) {
  return {
    "Access-Control-Allow-Origin": origine,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function refus(message, statut, origine) {
  return new Response(JSON.stringify({ error: message }), {
    status: statut,
    headers: { "Content-Type": "application/json; charset=utf-8", ...enTetesCors(origine) },
  });
}

export default {
  async fetch(request) {
    const origine = request.headers.get("Origin") ?? "";
    const url = new URL(request.url);

    // Contrôle préalable du navigateur.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: enTetesCors(origine) });
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "relais-piste" }), {
        headers: { "Content-Type": "application/json", ...enTetesCors(origine) },
      });
    }

    if (url.pathname !== "/relay") {
      return refus("Utilisez /relay?url=<url encodée>.", 404, origine);
    }

    if (!ORIGINES_AUTORISEES.has(origine)) {
      return refus(`Origine non autorisée : ${origine || "(absente)"}`, 403, origine);
    }

    const cible = url.searchParams.get("url");
    if (!cible) return refus("Paramètre url manquant.", 400, origine);

    let destination;
    try {
      destination = new URL(cible);
    } catch {
      return refus("URL invalide.", 400, origine);
    }

    if (destination.protocol !== "https:" || !HOTES_AUTORISES.has(destination.hostname)) {
      return refus(`Hôte non autorisé : ${destination.hostname}`, 403, origine);
    }

    const enTetes = {};
    for (const nom of EN_TETES_TRANSMIS) {
      const valeur = request.headers.get(nom);
      if (valeur) enTetes[nom] = valeur;
    }

    try {
      // Aucune en-tête Origin n'est transmise : c'est tout l'intérêt du relais.
      const amont = await fetch(destination.toString(), {
        method: request.method,
        headers: enTetes,
        body: request.method === "POST" ? await request.arrayBuffer() : undefined,
      });

      const reponse = new Response(amont.body, { status: amont.status });
      const type = amont.headers.get("content-type");
      if (type) reponse.headers.set("Content-Type", type);
      for (const [nom, valeur] of Object.entries(enTetesCors(origine))) {
        reponse.headers.set(nom, valeur);
      }
      return reponse;
    } catch (erreur) {
      return refus(`Relais impossible : ${String(erreur)}`, 502, origine);
    }
  },
};
