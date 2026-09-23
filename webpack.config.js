/* eslint-env node */
const path = require("path");
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
    devtool: dev ? "eval-source-map" : "source-map",
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
      // (/legiword/), pas a la racine du domaine.
      publicPath: "",
    },
    resolve: {
      extensions: [".ts", ".js", ".json"],
    },
    module: {
      rules: [
        { test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ },
        { test: /\.css$/, use: ["style-loader", "css-loader"] },
      ],
    },
    plugins: [
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
