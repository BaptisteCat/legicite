/* eslint-env node */
const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const devCerts = require("office-addin-dev-certs");

/**
 * Office exige HTTPS y compris en developpement : Word refuse de charger un
 * add-in servi en clair. office-addin-dev-certs genere et installe un certificat
 * local de confiance.
 */
async function httpsOptions() {
  try {
    const certs = await devCerts.getHttpsServerOptions();
    return { ca: certs.ca, key: certs.key, cert: certs.cert };
  } catch {
    // Les certificats ne sont pas encore generes : `npx office-addin-dev-certs install`
    return undefined;
  }
}

module.exports = async (env, argv) => {
  const dev = argv.mode !== "production";

  return {
    mode: dev ? "development" : "production",
    /*
     * Les cartes de source sont posees a la main, sur les seuls bundles.
     * Avec `devtool` global, webpack ajoutait un commentaire sourceMappingURL
     * AUX FICHIERS COPIES : les fichiers du kit servis n'etaient alors plus
     * identiques au kit, ce que la charte interdit.
     */
    devtool: false,
    entry: {
      taskpane: "./src/taskpane/taskpane.ts",
      dialog: "./src/dialog/dialog.ts",
    },
    output: {
      // GitHub Pages sert le dossier docs/ de la branche main : la sortie du
      // build est donc versionnee, comme pour les autres extensions du cabinet.
      path: path.resolve(__dirname, "docs"),
      filename: "[name].js",
      clean: true,
      // Chemins relatifs : le site est servi sous un sous-chemin
      // (/legicite/), pas a la racine du domaine.
      publicPath: "",
    },
    resolve: {
      extensions: [".ts", ".js", ".json"],
    },
    module: {
      rules: [{ test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ }],
    },
    plugins: [
      // Cartes de source pour les bundles seulement : jamais pour les fichiers
      // du kit ni pour les feuilles de style, copies tels quels.
      new webpack.SourceMapDevToolPlugin({
        filename: "[file].map",
        exclude: [/^theme\.js$/, /^icons\.js$/, /\.css$/],
      }),
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["taskpane"],
      }),
      new HtmlWebpackPlugin({
        filename: "dialog.html",
        template: "./src/dialog/dialog.html",
        chunks: ["dialog"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          { from: "assets", to: "assets" },
          // .nojekyll demande a GitHub Pages de servir les fichiers tels quels,
          // sans passer par Jekyll. `clean: true` vidant docs/ a chaque build,
          // ce marqueur doit etre re-emis par webpack.
          { from: "public", to: ".", noErrorOnMissing: true },

          /*
           * Kit Juritel et feuille de l'extension : copies telles quelles, JAMAIS
           * empaquetees ni minifiees. Les pages les chargent par <link> et
           * <script> dans l'ordre impose par la charte.
           *
           * `info: { minimized: true }` fait passer webpack son chemin : sans
           * cela, le mode production minifie les fichiers copies. Outre que la
           * charte veut le kit servi tel quel, la minification casserait des
           * declarations volontairement dupliquees — ainsi le
           * `-webkit-text-stroke` de `.brand-initial`, dont la premiere forme
           * sert de repli aux navigateurs sans `color-mix`.
           */
          ...[
            "src/juritel-design.css",
            "src/addin.css",
            "src/fonts.css",
            "src/theme.js",
            "src/icons.js",
            "src/legicite.css",
          ].map((from) => ({ from, to: ".", info: { minimized: true } })),
          { from: "src/fonts", to: "fonts", info: { minimized: true } },
        ],
      }),
    ],
    devServer: {
      static: { directory: path.join(__dirname, "dist") },
      server: {
        type: "https",
        options: await httpsOptions(),
      },
      port: 3000,
      headers: { "Access-Control-Allow-Origin": "*" },
      hot: true,
    },
  };
};
