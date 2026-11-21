# Automatischer Abruf der Broker-Daten

Joshua will ein integriertes Tool, das die Daten bei den Brokern, die es zulassen, automatisch abruft (20.11.2026). Stand der Möglichkeiten (geprüft am 21.11.2026):

| Broker | Automatisch? | Weg |
| --- | --- | --- |
| IBKR | **ja, umgesetzt (Schritt 4.1)** | offizieller Flex Web Service mit Token und Query-ID, nur lesend |
| DEGIRO, Trading 212 und weitere | **ja, umgesetzt (Schritt 4.2)** | SnapTrade Personal: eigenes kostenloses Konto des Nutzers (Entscheidung Joshua, 21.11.2026) |
| Trade Republic | nein | nur CSV-Export; die inoffizielle API (pytr) ist laut PRODUKTPLAN ausgeschlossen |

## IBKR: Flex Web Service

**Einmal im Client Portal einrichten:**
1. Reporting → Flex Queries → **Flex Web Service Configuration**: Dienst einschalten, „Current Token“ kopieren. Ein Token gilt 6 Stunden bis 1 Jahr; es kann auf IP-Adressen beschränkt werden.
2. Die **Activity Flex Query** wie für den Datei-Import anlegen (Format XML, Trades mit „Executions“, Cash Transactions, Open Positions, Datum yyyyMMdd) und ihre **Query-ID** notieren.

**Wie die App abruft:**
- Sie fordert mit `SendRequest` einen Bericht an und holt ihn mit `GetStatement` ab, solange IBKR „wird erzeugt“ meldet (Code 1019).
- Die Grenzen von IBKR werden eingehalten: ein Abruf je Sekunde, zehn je Minute, höchstens 365 Tage je Abruf. Längere Zeiträume werden in Fenster geteilt.
- Fehler kommen als deutsche Meldung mit IBKR-Code, ohne das Token zu nennen.
- Quellen: [Generate the Report](https://www.interactivebrokers.com/docs/web-api/flex-web-service/using-flex-web-service/generate-the-report), [SendRequest](https://www.interactivebrokers.com/docs/web-api/api-reference/send-request), [GetStatement](https://www.interactivebrokers.com/docs/web-api/api-reference/get-statement), [Fehlercodes](https://www.interactivebrokers.com/docs/web-api/flex-web-service/error-codes), [Token](https://www.interactivebrokers.com/docs/web-api/flex-web-service/client-portal-configuration/enable-and-create-access-token).

**Kommandozeile** (für Joshua sofort nutzbar, kein Relay nötig):

```bash
export IBKR_FLEX_TOKEN=…        # nie als Befehlsargument, sonst steht es im Verlauf
npm run sync -- --query 123456 --seit 2021-01-01
npm run report -- data/private/ibkr/*.xml 2026
```

Die Dateien landen in `data/private/ibkr/` und werden nie committet. Statt der Umgebungsvariable geht auch `--token-datei <pfad>`.

**Web-App:**
- Abschnitt „Automatisch von IBKR abrufen“ unter „Gespeicherte Dateien“.
- Beim ersten Abruf lädt die App ab dem angegebenen Datum, danach die letzten 365 Tage als laufende Datei.
- Wahlweise ruft sie beim Öffnen automatisch ab, höchstens einmal am Tag.
- Token, Query-ID und Relay-Adresse liegen nur in diesem Browser und sind **nicht im Backup**. „Alles löschen“ entfernt sie mit.

## Warum ein Relay?

IBKR sendet keine CORS-Header (am 21.11.2026 geprüft). Ein Browser darf deshalb aus einer Webseite heraus nicht bei IBKR abrufen. Das Relay (`src/sync/relay.ts`) leitet den Abruf weiter:
- Es ist zustandslos, speichert nichts und schreibt keine Protokolle mit Token oder Inhalt.
- Es antwortet nur erlaubten Seiten (`KEST_RELAY_ORIGINS`).
- Es läuft mit Standard-Request/Response, also in Node, Cloudflare Workers oder Deno.

- **Lokal** (Token bleibt auf dem eigenen Rechner): `npm run relay` startet es auf `http://localhost:8787`. Diese Adresse ist in der Content-Security-Policy der App immer erlaubt.
- **Öffentlich gehostet** (für Nutzer ohne Node): Dann geht das Token über diesen Server. **Entscheidung Joshua**, mit Datenschutzerklärung (Anwalt, Frage 2.3). Die Adresse beim Bauen angeben: `KEST_RELAY_ORIGINS=https://relay.example npm run build:web`. Beim Relay selbst gehört die Adresse der App in `KEST_RELAY_ORIGINS`.

## SnapTrade Personal (Schritt 4.2)

**Entscheidung Joshua (21.11.2026):** SnapTrade Personal und das Relay nur lokal.

**Einmal einrichten (Nutzer):**
1. Ein kostenloses Konto im [SnapTrade-Dashboard](https://dashboard.snaptrade.com/home) anlegen, E-Mail bestätigen und die Zwei-Faktor-Anmeldung einschalten.
2. Dort die Broker verbinden (DEGIRO, Trading 212 und weitere).
3. Unter „API Key“ einen **Personal API Key** erstellen und Client ID und Consumer Key notieren.

**Wie die App abruft:**
- Abrufe: `GET /accounts/all` (nur Anlagekonten), dann `GET /accounts/{id}/activities` seitenweise mit höchstens 1000 Einträgen je Seite.
- Jede Anfrage ist signiert: HMAC-SHA256 mit dem Consumer Key über kanonisches JSON, laut [Request Signatures](https://docs.snaptrade.com/docs/request-signatures).
- Bei 429 wartet die App laut `Retry-After`.
- Das Ergebnis kommt als **Schnappschuss** (JSON) in die Historie. Jeder neue Abruf ersetzt den vorigen.
- Jede Aktivität zählt einmal, auch wenn mehrere Abrufe gespeichert sind.
- **Kein Weg direkt aus der Webseite:** SnapTrade erlaubt Webseiten zwar Abrufe (CORS), aber nicht den Header `Signature` (geprüft am 21.11.2026). Der Abruf läuft deshalb wie bei IBKR über das lokale Relay (`POST /snaptrade`) oder die Kommandozeile:

```bash
export SNAPTRADE_CLIENT_ID=… SNAPTRADE_CONSUMER_KEY=…
npm run sync -- --snaptrade
npm run report -- data/private/snaptrade/snaptrade-2026-11-21.json 2026
```

**Zuordnung** (`src/import/snaptrade.ts`, Annahmen im README):

| SnapTrade-Typ | in der App |
| --- | --- |
| BUY, SELL | Kauf, Verkauf; Kurswert = Stück × Kurs, Spesen getrennt; Fremdwährung zum EZB-Kurs am Handelstag |
| DIVIDEND (+ TAX am selben Tag) | Dividende mit Quellensteuer; ETF und Fonds als Fondsausschüttung |
| CAPITAL_GAINS_LONG/SHORT | Fondsausschüttung (nicht berechnet) |
| INTEREST | Zinsen; bei DEGIRO/flatex wie Zinsen aus Geldeinlagen (KZ 861), sonst Broker-Zinsen laut Einstellung |
| SPLIT, Überträge, Optionen, STOCK_DIVIDEND, REI, ADJUSTMENT | gemeldet, spätere Verkäufe der Position nicht gerechnet |
| CONTRIBUTION, WITHDRAWAL, FEE | ohne Bedeutung für die KESt |

**Grenze:** SnapTrade liefert **keine ISIN**, nur FIGI.
- Steht eine ISIN in der Beschreibung einer Buchung, gilt sie für alle Buchungen desselben Wertpapiers. Sonst ist die Kennung die FIGI-Klasse.
- Käufe und Verkäufe rechnet die App auch ohne ISIN.
- Dividenden ohne ISIN rechnet sie nicht, weil der Quellenstaat dann unbekannt ist; sie meldet das unter „Nicht berechnet“.

### Vergleich der Varianten (Entscheidungsgrundlage)

Laut [SnapTrade](https://docs.snaptrade.com/docs/personal-vs-commercial) und [Preisseite](https://snaptrade.com/pricing), Stand 21.11.2026:

| | SnapTrade Personal | SnapTrade Commercial |
| --- | --- | --- |
| Wer hat das SnapTrade-Konto? | jeder Nutzer selbst | Joshua bzw. die Firma |
| Kosten | kostenlos | 100 $ pro Monat plus 1 $ je Nutzer und Monat (Stufe „Daily“, nur lesend) |
| Zugang der App | Personal Client ID und Consumer Key des Nutzers oder OAuth | eigener API-Schlüssel, Server nötig, Freigabe durch SnapTrade |
| Einrichtung für den Nutzer | SnapTrade-Konto anlegen, Broker dort verbinden, Schlüssel in die App kopieren | Broker direkt in der App verbinden |

Offen bei beiden Varianten:
- Ob alle Steuerdetails ankommen: ISIN, Gebühren, Quellensteuer, Kapitalmaßnahmen.
- Die Daten laufen über einen US-Dienstleister (Datenschutz).

## Entscheidungen

1. Relay: **nur lokal** (Joshua, 21.11.2026). Öffentliches Hosting bleibt möglich, braucht aber Host, Domain und Datenschutzerklärung.
2. SnapTrade: **Personal** (Joshua, 21.11.2026). Commercial wäre bequemer für Nutzer, kostet aber und braucht einen Server.
