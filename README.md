# KESt-Rücklage-App

Rechnet für Anleger in Österreich mit einem **nicht steuereinfachen Broker** (Trade Republic, IBKR, DEGIRO …) laufend die Kapitalertragsteuer aus und zeigt, wie viel man zurücklegen muss. So ist das Geld da, wenn der Steuerbescheid kommt.

Die App ist ein **Berechnungstool**: Sie gibt keine Steuer- und keine Anlageberatung.

Produktplan: https://claude.ai/artifact/Pz2JTUN4Bq72zbGKMx254i

## Stand: Phase 1 – Rechenkern

| Modul | Was es rechnet |
| --- | --- |
| `src/fx.ts` | Umrechnung in EUR zum EZB-Referenzkurs am Buchungstag |
| `src/costBasis.ts` | Gleitender Durchschnittspreis je ISIN und Depot (§ 27a Abs 4 Z 3 EStG) |
| `src/basket275.ts` | 27,5 %-Topf: KZ 994, 892, 863, 998, Verlustausgleich, Quellensteuer-Anrechnung |
| `src/tariff.ts` | Einkommensteuertarif 2026 und Mehrsteuer aus tarifbesteuerten Derivaten (KZ 857) |
| `src/reserve.ts` | Soll-Rücklage inkl. Sicherheitspuffer |
| `src/import/tradeRepublic.ts` | Import des Trade-Republic-Transaktionsexports (CSV, seit April 2026) |
| `src/yearReport.ts` | Jahresauswertung: Bestände über die ganze Historie, Kennzahlen und Steuer fürs gewählte Jahr |

Noch offen in Phase 1: Dividenden und Quellensteuer aus dem Trade-Republic-Export (Buchungstyp noch unbekannt), EZB-Kursabruf für Fremdwährungs-Trades, IBKR-Import.

## Entwickeln

```bash
npm install
npm test          # alle Tests
npm run typecheck # TypeScript-Prüfung
npm run report -- data/private/<Export>.csv 2026   # Auswertung einer echten Datei
```

Trade-Republic-Export: App → Profil → Kontoauszüge → Transaktionsexport, Zeitraum seit Kontoeröffnung.

## Annahmen, die ein Steuerberater bestätigen muss

- **Verlustausgleich mit Dividenden:** Die anrechenbare Quellensteuer wird auf die österreichische Steuer gedeckelt, die auf die nach dem Verlustausgleich verbleibenden Dividenden entfällt (`src/basket275.ts`).
- **Tarif ohne Absetzbeträge:** Die Mehrsteuer aus KZ 857 wird eher zu hoch geschätzt (`src/tariff.ts`).
- **Trade-Republic-Derivate sind verbrieft:** Optionsscheine, Faktor-Zertifikate und Turbos landen in KZ 995/896 mit 27,5 % (`src/import/tradeRepublic.ts`).
- **Zinsen auf dem Trade-Republic-Verrechnungskonto** gelten als Zinsen aus Geldeinlagen bei Kreditinstituten: KZ 861, 25 %.
- **Krypto-Auslieferung ins eigene Wallet** ist ein Übertrag ohne Gewinn. Verkäufe außerhalb von Trade Republic erfasst die App noch nicht.
- **Vorzeichen von KZ 892:** Intern als positiver Betrag geführt. Wie er in FinanzOnline einzutragen ist, entscheidet erst der Bericht.

## Daten

Echte Broker-Exporte gehören nach `data/private/` und werden **nie** committet (siehe `.gitignore`).
