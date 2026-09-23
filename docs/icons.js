/* ==========================================================================
   KIT JURITEL · icônes                                           v1 · 2026-09
   --------------------------------------------------------------------------
   Jeu Lucide (lucide.dev, licence ISC) : viewBox 24, trait 2, extrémités
   arrondies, currentColor. C'est LE jeu de la famille — aucune extension ne
   mélange deux jeux d'icônes.

   Usage :
     <script src="icons.js"></script>
     el.innerHTML = JT.icon("search");            // 14 px, trait 2
     el.innerHTML = JT.icon("trash", 16);         // taille libre
     el.innerHTML = JT.icon("check", 18, 2.6);    // trait plus gras

   Ajouter une icône propre à l'extension (sans toucher au kit) :
     JT.addIcons({ gavel: '<path d="…"/><path d="…"/>' });
   Copier le contenu du <svg> depuis lucide.dev, SANS l'enveloppe <svg>.

   Tailles usuelles : 13 à 17 px dans le volet, 18 à 20 px dans une fenêtre.
   ========================================================================== */
(function (root) {
  "use strict";

  var PATHS = {
    // navigation et structure
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    menu: '<path d="M4 12h16"/><path d="M4 6h16"/><path d="M4 18h16"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',

    // actions
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>' +
      '<path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/>' +
      '<line x1="14" x2="14" y1="11" y2="17"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
      '<path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
      '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>' +
      '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/>' +
      '<path d="M12 15V3"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/>' +
      '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',

    // documents
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>' +
      '<path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    list: '<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/>' +
      '<path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.8 8.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8Z"/>' +
      '<circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    // curseur de texte + « + » : insérer au point d'insertion
    insert: '<path d="M4 4h1a3 3 0 0 1 3 3 3 3 0 0 1 3-3h1"/>' +
      '<path d="M12 20h-1a3 3 0 0 1-3-3 3 3 0 0 1-3 3H4"/><path d="M8 7v10"/>' +
      '<path d="M18 9v6"/><path d="M15 12h6"/>',

    // états
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/>' +
      '<path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/>' +
      '<path d="M12 17h.01"/>',
    settings: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2 2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0 2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7 2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7 2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7 2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7 2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2 2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0 2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7 2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7 2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7 2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7 2 2 0 0 0-2-2Z"/>' +
      '<circle cx="12" cy="12" r="3"/>'
  };

  var JT = root.JT || (root.JT = {});

  JT.ICON_PATHS = PATHS;

  /** Renvoie le SVG d'une icône, prêt à poser en innerHTML. */
  JT.icon = function (name, size, strokeWidth) {
    var d = PATHS[name];
    if (!d) { throw new Error('JT.icon : icône inconnue « ' + name + ' »'); }
    size = size || 14;
    strokeWidth = strokeWidth || 2;
    return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  };

  /** Ajoute des icônes propres à l'extension. */
  JT.addIcons = function (more) {
    for (var k in more) { if (Object.prototype.hasOwnProperty.call(more, k)) { PATHS[k] = more[k]; } }
  };

  /**
   * Remplit tous les <span data-icon="search" data-icon-size="16"> de la page.
   * Pratique pour poser les icônes directement dans le HTML, sans JS d'appoint.
   */
  JT.paintIcons = function (root_) {
    var scope = root_ || document;
    var nodes = scope.querySelectorAll("[data-icon]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.innerHTML = JT.icon(n.dataset.icon, +n.dataset.iconSize || 14, +n.dataset.iconStroke || 2);
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { JT.paintIcons(); });
  } else {
    JT.paintIcons();
  }
})(window);
