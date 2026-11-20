# Hosting der installierbaren Web-App (Schritt 3.5)

Die App braucht keinen eigenen Server. `npm run build:web` erzeugt den Ordner `dist/pwa/`, der auf jedem statischen Host mit HTTPS läuft. **Wo gehostet wird, entscheidet Joshua.**

## Inhalt von `dist/pwa/`

| Datei | Zweck |
| --- | --- |
| `index.html` | die App (eine Datei mit eingebettetem Skript und CSS), ohne Schriften von Google |
| `manifest.webmanifest` | Name, Farben, Symbole: macht die App installierbar („Zum Startbildschirm hinzufügen“) |
| `sw.js` | Service Worker: legt alle Dateien beim ersten Besuch ab, danach läuft die App auch offline |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | App-Symbole (beim Bauen erzeugt) |
| `_headers` | Sicherheits-Header für Hosts, die diese Datei lesen (Netlify, Cloudflare Pages) |

## Anforderungen an den Host

- **HTTPS:** Service Worker laufen nur über HTTPS (oder `localhost`).
- **`sw.js` und `index.html` nicht lange zwischenspeichern** (`Cache-Control: no-cache`), sonst kommen Updates verzögert an. Die übrigen Dateien dürfen gecacht werden.
- **MIME-Typ** `application/manifest+json` für `manifest.webmanifest`.
- **Content-Security-Policy:**
  - Sie steht als `<meta>` in `index.html`, damit sie auch auf Hosts ohne eigene Header gilt.
  - Skripte laufen nur mit der passenden SHA-256-Prüfsumme. Verbindungen gehen nur zur eigenen Seite und zur EZB-Datenschnittstelle.
  - Die Prüfsumme wird bei jedem Build neu berechnet.
- **Keine Zugriffsprotokolle mit IP-Adressen**, oder nur kurz aufbewahrt. Die App selbst sendet keine Steuerdaten an den Host. Der Host sieht aber, wer die Seite abruft.

## Beispiele

**Netlify oder Cloudflare Pages:** Ordner `dist/pwa/` hochladen oder als Ausgabeordner eintragen. `_headers` wird automatisch gelesen.

**Eigener Server (nginx):**

```nginx
location / {
  root /srv/kest/pwa;
  add_header X-Content-Type-Options nosniff;
  add_header Referrer-Policy no-referrer;
}
location = /sw.js { root /srv/kest/pwa; add_header Cache-Control no-cache; }
location = /index.html { root /srv/kest/pwa; add_header Cache-Control no-cache; }
types { application/manifest+json webmanifest; }
```

**GitHub Pages:** liest `_headers` nicht. Die CSP gilt trotzdem über das `<meta>`-Tag, `frame-ancestors` dann aber nicht.

## Datenschutz

- **Schriften:** Die gehostete Fassung lädt keine Schriften von Google. Beim Öffnen ginge sonst die IP-Adresse an Google; das LG München I hat das am 20.01.2022 (Az. 3 O 17493/20) als Verstoß gegen die DSGVO gewertet. Die App nutzt stattdessen die Systemschriften. Die Einzeldatei `dist/kest-app.html` (Artefakt) lädt die Schriften weiterhin.
- **Was das Gerät verlässt:** nur der Abruf der EZB-Kurse (Währung und Zeitraum). Steuerdaten, Backups und Rücklage bleiben im Browser.

## Offen (Entscheidung Joshua)

- Host und Domain, in der EU.
- Impressum und Datenschutzerklärung (Anwalt, siehe `docs/FRAGEN-STEUERBERATER-ANWALT.md`, 2.3).
