# Umsetzungsauftrag für Claude Code

Stand: 19.11.2026 · Auftraggeber: Joshua

Du setzt den Produktplan der KESt-Rücklage-App Schritt für Schritt um. Lies vor jedem Arbeitsbeginn `CLAUDE.md`, `docs/HANDOFF.md`, `docs/PRODUKTPLAN.md` und diese Datei. Bei Widersprüchen gilt: Joshuas Entscheidungen unten > PRODUKTPLAN > HANDOFF.

## Joshuas Entscheidungen (verbindlich)

1. **Reihenfolge:** alles der Reihe nach, Phase für Phase. An jedem Gate **stoppst du** und meldest dich, statt weiterzubauen.
2. **Keine Nutzerkonten.** Die Steuerhistorie bleibt lokal auf dem Gerät gespeichert (Browser-Speicher, IndexedDB), über mehrere Jahre und Importe hinweg. Dazu gibt es eine Backup-Datei zum Exportieren und Wiederherstellen. Kein Login, kein eigener Server in Phase 1–3.
3. **„KI-Aufsicht“ = Buchungen prüfen + warnen und erinnern.** Umsetzung als deterministischer, getesteter **Prüfassistent** im Rechenkern (Regeln, keine Sprach-KI). Ein Sprachmodell wird nicht eingebaut; das bräuchte einen Server und ist eine spätere Entscheidung von Joshua.
4. **Ein Pull Request pro Schritt.** Joshua prüft und mergt selbst. Du mergst nie.

## Arbeitsregeln für jeden Schritt

- Branch-Name `schritt-<nummer>-<kurzname>`, z. B. `schritt-1.2-ezb-kurse`. Basis ist `main`. Ist der vorige Schritt noch nicht gemergt, baust du auf dessen Branch auf und setzt ihn als `base` des Pull Requests.
- Testgetrieben laut `CLAUDE.md`: erst roter Test, dann Code. Steuerregeln mit von Hand nachgerechnetem Testfall und Quelle im Kommentar.
- Nur erfundene Testdaten unter `test/fixtures/`. Echte Daten liegen nur in `data/private/` und werden nie committet.
- Vor jedem Commit: `npm test`, `npm run typecheck`, bei Änderungen an der Oberfläche zusätzlich `npm run build:web`.
- Fakten, die sich ändern können (Fristen, Formate, Kennzahlen), prüfst du an einer offiziellen Quelle (BMF, RIS, Broker-Doku) und verlinkst sie im Code-Kommentar oder in der Doku. Nie aus dem Gedächtnis.
- Jede neue strittige Steuerfrage: nicht entscheiden, sondern als Einstellung oder dokumentierte Annahme anlegen und in `docs/HANDOFF.md` unter „Offene Fragen“ eintragen.
- Nach jedem Schritt: `docs/HANDOFF.md` (Abschnitt „Stand des Codes“) und `README.md` aktualisieren.
- Pull-Request-Beschreibung auf Deutsch: was gebaut wurde, wie getestet, **was Joshua prüfen soll**, was offen bleibt.
- Nutzertexte: Deutsch, klar, ohne Steuer- oder Anlageempfehlung. Die App rechnet, der Nutzer entscheidet.

## Vorbedingung

Prüfe, ob Pull Request #1 (`trade-republic-import`) und #2 (`review-haertung`) gemergt sind. Wenn nicht: Stopp, bitte Joshua, beide zu mergen, und beginne erst danach.

## Phase 1 · Rechenkern abschließen

**1.1 Dividenden und Quellensteuer bei Trade Republic.** Der Buchungstyp für Dividenden im Trade-Republic-CSV ist unbekannt. Ermittle ihn aus einer belastbaren Quelle, z. B. dem quelloffenen Trade-Republic-CSV-Importer von Portfolio Performance auf GitHub, und verlinke sie. Dividenden → KZ 863, Quellensteuer → KZ 998 (Deckel: DBA-Satz, Kürzung bei Verlustausgleich wie in `src/basket275.ts`). Ist der Typ nicht sicher belegbar, bleibt er „nicht berechnet“ und du dokumentierst das.

**1.2 EZB-Referenzkurse.** Modul, das Fremdwährungsbeträge mit dem EZB-Kurs am Buchungstag umrechnet. Kursquelle austauschbar (Interface), in Tests nur Fixture-Kurse. Fehlt ein Kurs (Wochenende, Feiertag), gilt die dokumentierte Regel aus einer offiziellen Quelle; ohne Quelle: „nicht berechnet“. Danach Trades in Fremdwährung im Trade-Republic-Import unterstützen statt sie abzulehnen.

**1.3 IBKR-Flex-Import (XML).** Abschnitte Trades, CashTransactions (Dividenden, Quellensteuer, Zinsen), OpenPositions. Aktien/ETFs/Anleihen → 994/892, Dividenden → 863/998, Zinsen → Einstellung KZ 861 oder 863 (offene Frage). Optionen und Futures in diesem Schritt nur erkennen und als „nicht berechnet, kommt in Phase 2“ melden. Fehlende Abschnitte mit konkreter deutscher Meldung („Abschnitt CashTransactions fehlt“).

**1.4 Lokale Historie.** Alle Importe dauerhaft im Browser speichern (IndexedDB), mehrere Dateien und Broker zusammenführen, Duplikate über die Transaktions-ID erkennen. Backup als JSON-Datei exportieren und wiederherstellen. Klarer Hinweis in der App: Daten liegen nur auf diesem Gerät, Backup sichern.

**1.5 Prüfassistent, Teil „Buchungen prüfen“.** Eine Funktion `checkBookings` liefert eine Liste von Hinweisen mit Schweregrad und Klartext. Mindestens: Verkauf ohne ausreichenden Bestand (Kauf vermutlich vor dem Exportzeitraum), doppelte Buchungen, Lücken im Exportzeitraum, Fremdwährung ohne Kurs, Übertrag größer als Bestand, unbekannte Buchungstypen, Positionen mit Bestand nahe 0 durch Rundung. Anzeige in der Web-App über der Auswertung.

**Gate 1 – Stopp.** Bitte Joshua, `npm run report` mit seinem echten Export laufen zu lassen und das Jahr 2025 mit DepotTax oder Tax-Wizard zu vergleichen. Erst nach seiner Freigabe weiter.

## Phase 2 · Derivate und Rücklage

**2.1 Nicht verbriefte Derivate (IBKR-Optionen, Futures).** Eigener Topf KZ 857. Einstellung „Behandlung nicht verbriefter Derivate“: Tarif (Standard, vorsichtig) oder 27,5 % – solange der Steuerberater nicht entschieden hat. Stillhalter-Testfälle aus PRODUKTPLAN (Short Put verfällt, Short Call glattgestellt, Put ausgeübt, Option über den Jahreswechsel offen).

**2.2 Tarif-Schätzung.** Mehrsteuer aus KZ 857 über `src/tariff.ts`, sonstiges Einkommen als Einstellung (nur abgefragt, wenn Derivate vorkommen).

**2.3 Rücklagen-Ledger.** Soll laut Formel im PRODUKTPLAN, Ist als vom Nutzer eingetragener Marktwert mit Datum und Ort. Freigabe erst nach dem 31.12. Kriterien-Check der gewählten Anlage: Meldefonds ja/nein und Risikoklasse laut Basisinformationsblatt werden vom Nutzer eingegeben; die App warnt nur, blockiert nichts und nennt nie ein Produkt.

**2.4 Prüfassistent, Teil „Warnen und erinnern“.** In-App-Hinweise, testbar als reine Funktion mit Datum als Eingabe: Fehlbetrag in der Rücklage, letzter Import älter als 30 Tage, Hinweis im November/Dezember, dass Verluste nur im laufenden Jahr ausgleichen, Frist der Steuererklärung (Frist an BMF-Quelle prüfen und verlinken). Push-Nachrichten erst in Phase 4.

**Gate 2 – Stopp.** Erstelle `docs/FRAGEN-STEUERBERATER-ANWALT.md` mit allen offenen Fragen aus HANDOFF, jeweils mit Beispielrechnung aus den Tests. Joshua klärt sie extern. Ohne seine Freigabe kein Weiterbau an Phase 3.

## Phase 3 · Web-App Version 1

**3.1 Einrichtungsassistent:** Broker wählen, Schritt-für-Schritt-Anleitung zum Export (Text, Platz für Screenshots), Datei reinziehen mit Sofortprüfung, die drei Fragen aus dem PRODUKTPLAN. Ziel: erstes Ergebnis in etwa zwei Minuten.
**3.2 DEGIRO-Import** (CSV), gleiche Regeln wie oben.
**3.3 Verkaufs-Simulator und Kauf-Check.**
**3.4 E1kv-Bericht** als PDF und CSV mit Belegliste, Regelversion und sichtbarem Hinweis „Berechnungstool, keine Steuerberatung“.
**3.5 Installierbare Web-App (PWA):** Manifest, offline nutzbar. Hosting nur vorbereiten (statisch); wo gehostet wird, entscheidet Joshua.

**Gate 3 – Stopp.** Kurze Testanleitung für eine Testgruppe in `docs/TESTGRUPPE.md`. Joshua führt den Test durch.

## Phase 4 und 5 · nur nach ausdrücklicher Freigabe

Nicht bauen, bevor Joshua es sagt. Auf Wunsch zuerst eine Entscheidungsvorlage: SnapTrade (Kosten, Datenschutz, Datenumfang bei IBKR), Push-Nachrichten, kleiner Server in der EU, später eigene IBKR-OAuth-Freigabe und MCP-Add-on auf demselben Rechenkern.

## Wenn etwas unklar ist

Frag Joshua, statt zu raten, besonders bei Steuerregeln, Texten mit Rechtsbezug und allem, was Geld bewegt oder Daten das Gerät verlassen lässt.
