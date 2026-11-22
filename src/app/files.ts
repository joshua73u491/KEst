import { cspFor, scriptHash, THEME_COLOR } from "../pwa/files.js";

/**
 * Startseite der Store-App (Android/iOS über Capacitor, `dist/app/`). Dieselbe Web-App wie `dist/pwa/`, aber:
 * - ohne Manifest und Service Worker: Die Dateien liegen in der App auf dem Gerät, ein Offline-Cache ist unnötig.
 * - ohne Schriften von Google (wie die PWA, siehe docs/HOSTING.md).
 * - ohne Relay in der CSP: Ein Relay auf `localhost` gibt es auf dem Handy nicht.
 * - mit `viewport-fit=cover`, damit die Seite bei Handys mit Notch den ganzen Bildschirm nutzt.
 */
export function appIndexHtml(html: string, inlineScript: string): string {
  const head = [
    `<meta name="theme-color" content="${THEME_COLOR}">`,
    `<meta http-equiv="Content-Security-Policy" content="${cspFor(scriptHash(inlineScript))}">`,
  ].join("\n");
  return html
    .replace(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\r?\n?/g, "")
    .replace(/<meta name="viewport" content="([^"]*)">/, (_, c: string) => `<meta name="viewport" content="${c}, viewport-fit=cover">`)
    .replace("</head>", `${head}\n</head>`);
}
