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

Noch offen in Phase 1: Import der Trade-Republic-Abrechnungen, EZB-Kursabruf, Jahresauswertung über alle Buchungen.

## Entwickeln

```bash
npm install
npm test          # alle Tests
npm run typecheck # TypeScript-Prüfung
```

## Annahmen, die ein Steuerberater bestätigen muss

- **Verlustausgleich mit Dividenden:** Die anrechenbare Quellensteuer wird auf die österreichische Steuer gedeckelt, die auf die nach dem Verlustausgleich verbleibenden Dividenden entfällt (`src/basket275.ts`).
- **Tarif ohne Absetzbeträge:** Die Mehrsteuer aus KZ 857 wird eher zu hoch geschätzt (`src/tariff.ts`).
- **Vorzeichen von KZ 892:** Intern als positiver Betrag geführt. Wie er in FinanzOnline einzutragen ist, entscheidet erst der Bericht.

## Daten

Echte Broker-Exporte gehören nach `data/private/` und werden **nie** committet (siehe `.gitignore`).
