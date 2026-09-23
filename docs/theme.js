/* global Office */
// KIT JURITEL — thème clair / sombre, aligné sur celui de WORD (et non sur Windows).
// À charger dans CHAQUE page (volet et fenêtres), après office.js :
//     <script src="theme.js" data-key="monextension.theme"></script>
// data-key : clé de stockage propre à l'extension (facultatif). Deux extensions
// ouvertes en même temps ne se marchent pas dessus si leurs clés diffèrent.
// 1) Tout de suite : dernier thème connu (mémorisé) → pas de flash de couleur.
// 2) Dès qu'Office est prêt : lit le fond du thème Office (Office.context.officeTheme) et en
//    déduit clair ou sombre, puis le RE-LIT régulièrement : le volet vit aussi longtemps que Word
//    (runtime partagé) et Word ne signale pas toujours un changement de thème.
// 3) Les fenêtres (réglages, recherche…) suivent le volet via le stockage partagé (événement storage).
// Sans information (navigateur, ancienne version), le kit suit le thème système.
(function () {
  var me = document.currentScript;
  var KEY = (me && me.dataset && me.dataset.key) || window.JT_THEME_KEY || "juritel.theme";
  function apply(t) {
    if ((t === "dark" || t === "light") && document.documentElement.dataset.theme !== t) {
      document.documentElement.dataset.theme = t;
    }
  }
  try { apply(localStorage.getItem(KEY)); } catch (e) { /* stockage bloqué : on suit le système */ }
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(e.newValue); });

  function fromOffice(ev) {
    try {
      var th = (ev && ev.officeTheme) || (Office.context && Office.context.officeTheme);
      var bg = th && th.bodyBackgroundColor;
      if (!bg) return;
      var hex = String(bg).replace("#", "");
      if (hex.length === 3) hex = hex.replace(/./g, "$&$&");
      var r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
      if (isNaN(r + g + b)) return;
      var t = 0.299 * r + 0.587 * g + 0.114 * b < 128 ? "dark" : "light";
      apply(t);
      try { if (localStorage.getItem(KEY) !== t) localStorage.setItem(KEY, t); } catch (e) { /* ignoré */ }
    } catch (e) { /* ignoré */ }
  }

  if (window.Office && Office.onReady) {
    Office.onReady(function () {
      fromOffice();
      // Événement officiel (pris en charge selon l'application/la version : sinon, sans effet).
      try {
        Office.context.document.addHandlerAsync(Office.EventType.OfficeThemeChanged, fromOffice, function () {});
      } catch (e) { /* non pris en charge */ }
      setInterval(fromOffice, 3000);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) fromOffice(); });
    });
  }
})();
