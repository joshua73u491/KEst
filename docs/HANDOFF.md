# Übergabe: Stand und Kontext (18.11.2026)

Diese Datei fasst alles zusammen, was im Planungs-Chat entschieden wurde. Wer an diesem Repository weiterarbeitet, liest sie zuerst, danach `CLAUDE.md` und `README.md`.

## Produkt

**KESt-Rücklage-App:** Für Anleger in Österreich mit einem nicht steuereinfachen Broker (Trade Republic, IBKR, DEGIRO …). Die App rechnet laufend die KESt aus und zeigt, wie viel man zurücklegen muss, damit das Geld beim Steuerbescheid da ist.

- Produktplan (Doc): https://claude.ai/artifact/Pz2JTUN4Bq72zbGKMx254i
- Aktuelle Web-App (Artefakt, aus `dist/kest-app.html`): https://claude.ai/artifact/1qjjh43KFpb7VtprnBRdAe
- Zielgruppe: normale Nutzer **ohne Claude**. Einrichtung muss extrem einfach sein (Datei reinziehen, drei Fragen, Ergebnis in ~2 Minuten, kein Konto).
- Alleinstellungsmerkmal: laufende Rücklage über das ganze Jahr. Konkurrenz (DepotTax, Tax-Wizard, KestKlar) rechnet nur einmal im Jahr die E1kv.
- MCP-Server ist nur ein optionales Add-on auf demselben Rechenkern.

## Harte Regeln (Recht)

- **Berechnungstool, keine Steuerberatung.** Strittige Punkte sind Einstellungen oder dokumentierte Annahmen.
- **Keine Anlageberatung.** Anlageberatung = „Abgabe persönlicher Empfehlungen“ und braucht eine FMA-Konzession (WAG 2018). Die App nennt **nie** ein konkretes Produkt für die Rücklage. Sie prüft nur Kriterien der Nutzerwahl (Meldefonds ja/nein, Risikoklasse) und warnt; sie blockiert nichts.
- Geld bewegt immer der Nutzer selbst.
- Version 1 rechnet komplett lokal im Browser; Steuerdaten verlassen das Gerät nicht.
- Trade Republic nur per offiziellem CSV-Export, **nie** über die inoffizielle API (pytr).

## Steuerregeln (Österreich), Quellen im Produktplan

| Topf | Satz | KZ Überschuss / Verlust |
| --- | --- | --- |
| Aktien, ETFs, Anleihen | 27,5 % | 994 / 892 |
| Verbriefte Derivate (Optionsscheine, Turbos, Zertifikate) | 27,5 % | 995 / 896 |
| Nicht verbriefte Derivate (Optionen, Futures, CFDs) ohne freiwilligen KESt-Abzug | Tarif bis 55 % | 857 |
| Krypto | 27,5 % | 174 / 176 (172 laufend) |
| Dividenden, Wertpapierzinsen | 27,5 % | 863 |
| Fonds: Ausschüttungen / AgE | 27,5 % | 898 / 937 |
| Zinsen aus Geldeinlagen | 25 % | 861 |
| Anrechenbare Quellensteuer | – | 998 |

- Anschaffungskosten: **gleitender Durchschnittspreis** je ISIN und Depot, in EUR. FIFO ist verboten. Spesen zählen im 27,5 %-Topf nicht.
- Fremdwährung: EZB-Referenzkurs am Buchungstag.
- Verlustausgleich nur im selben Kalenderjahr, kein Vortrag. Verluste im 27,5 %-Topf dürfen Dividenden ausgleichen; dann sinkt die anrechenbare Quellensteuer. Bankzinsen (25 %) sind ein eigener Topf.
- Quellensteuer nur bis zum DBA-Satz anrechenbar (USA 15 %).
- Stillhalter: Prämie wird bei Verfall bzw. Glattstellung erfasst.
- Nicht-Meldefonds: pauschal 90 % der Wertsteigerung, mindestens 10 % des Werts am 31.12.
- Tarif 2026: 0 % bis 13.539 €, 20 % bis 21.992 €, 30 % bis 36.458 €, 40 % bis 70.365 €, 48 % bis 104.859 €, 50 % bis 1 Mio. €, darüber 55 %.

## Offene Fragen an Steuerberater/Anwalt (nicht selbst entscheiden)

- Optionen/Futures bei IBKR: KZ 857 (Tarif) oder 995? Ein Tool ordnet 995 zu, BMF-Formular und Tax-Wizard sagen 857.
- Broker-Zinsen: KZ 861 (25 %) oder 863 (27,5 %)?
- Reihenfolge Verlustausgleich mit Dividenden und Kürzung der Quellensteuer.
- Vorzeichen von KZ 892/896/176 in FinanzOnline.
- Grenze Berechnungstool vs. Steuerberatung; reicht der Kriterien-Check der Rücklage?

## Stand des Codes

- Phase 1 (Rechenkern) weitgehend fertig, 50 Tests grün. Module: siehe README-Tabelle.
- Trade-Republic-CSV-Import (`src/import/tradeRepublic.ts`), Jahresauswertung (`src/yearReport.ts`), Textbericht (`npm run report`), Web-App (`npm run build:web`).
- Getestet mit Joshuas echtem Export (liegt **nur** lokal unter `data/private/`, nie committen). Ergebnis 2026: KZ 892 3,52 €, KZ 995 1,99 €, KZ 896 0,08 €, KZ 174 0,19 €, KZ 861 0,01 €, Steuer 0 €, 1,42 € Verlust übrig. Handrechnung stimmt.
- Der echte Export enthält nur: TRADING BUY/SELL (STOCK, DERIVATIVE, CRYPTO), DELIVERY FREE_DELIVERY (Krypto ins Wallet), CASH INTEREST_PAYMENT sowie Karten-/Überweisungsbuchungen. **Kein Dividenden-Beispiel**: Buchungstyp für Dividenden bei Trade Republic ist noch unbekannt und wird bewusst als „Unbekannter Buchungstyp“ gemeldet.
- Offen: PR #1 (`trade-republic-import`) ist noch nicht gemergt.

## Roadmap (Kurzform)

1. Rechenkern (fast fertig) · Gate: Ergebnis deckt sich mit DepotTax/Tax-Wizard
2. Derivate (Optionen, Stillhalter, KZ 857 mit Tarif) und Rücklagen-Ledger mit Kriterien-Check · Gate: Steuerberater und Anwalt
3. Web-App Version 1 mit Einrichtungsassistent, IBKR-Flex- und DEGIRO-Import, E1kv-Bericht
4. Broker-Verbindung über SnapTrade, Push-Erinnerungen
5. Eigene IBKR-OAuth-Freigabe, MCP-Add-on

## Arbeitsweise

- Testgetrieben, Beträge nur mit `decimal.js`, nie still schätzen (siehe `CLAUDE.md`).
- Arbeit auf einem Branch, Pull Request statt direkt auf `main`.
- Texte für Nutzer auf Deutsch, klar und ohne Beratung.
