// Baut die Web-App als eine einzige, eigenständige HTML-Datei: dist/kest-app.html
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const result = await build({
  entryPoints: ["src/web/main.ts"],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  loader: { ".csv": "text" },
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const html = readFileSync("web/index.html", "utf8").replace("<!--APP_SCRIPT-->", () => js);
mkdirSync("dist", { recursive: true });
writeFileSync("dist/kest-app.html", html);
console.log(`dist/kest-app.html (${Math.round(html.length / 1024)} KB)`);
