# KESt-Rücklage-App

Rechnet für Anleger in Österreich mit einem **nicht steuereinfachen Broker** (Trade Republic, IBKR, DEGIRO …) laufend die Kapitalertragsteuer aus und zeigt, wie viel man zurücklegen muss. So ist das Geld da, wenn der Steuerbescheid kommt.

Die App ist ein **Berechnungstool**: Sie gibt keine Steuer- und keine Anlageberatung.

Produktplan: https://claude.ai/artifact/Pz2JTUN4Bq72zbGKMx254i

## Stand: Phase 1 – Rechenkern

| Modul | Was es rechnet |
| --- | --- |
| `src/fx.ts` | Umrechnung in EUR zum EZB-Referenzkurs; austauschbare Kursquelle (`RateSource`), Einlesen der EZB-Kursdateien |
| `src/web/loadRates.ts` | Abruf der EZB-Referenzkurse in der Web-App (nur Währung und Zeitraum) |
| `src/costBasis.ts` | Gleitender Durchschnittspreis je ISIN und Depot (§ 27a Abs 4 Z 3 EStG) |
| `src/basket275.ts` | 27,5 %-Topf: KZ 994, 892, 863, 998, Verlustausgleich, Quellensteuer-Anrechnung |
| `src/treaty.ts` | DBA-Höchstsätze für Quellensteuer auf Dividenden je Land, mit Link auf den Abkommenstext im RIS |
| `src/tariff.ts` | Einkommensteuertarif 2026 und Mehrsteuer aus tarifbesteuerten Derivaten (KZ 857) |
| `src/reserve.ts` | Soll-Rücklage inkl. Sicherheitspuffer |
| `src/import/tradeRepublic.ts` | Import des Trade-Republic-Transaktionsexports (CSV, seit April 2026) |
| `src/import/ibkrFlex.ts` | Import einer IBKR Activity Flex Query (XML): Trades, CashTransactions, OpenPositions |
| `src/import/model.ts`, `src/import/readAny.ts` | Gemeinsames Datenmodell aller Importe; Erkennung des Brokers am Dateiinhalt |
| `src/import/xml.ts` | Minimaler XML-Leser ohne Abhängigkeiten (Node und Browser) |
| `src/yearReport.ts` | Jahresauswertung: Bestände über die ganze Historie, Kennzahlen und Steuer fürs gewählte Jahr; Dividenden mit Quellensteuer; Erträge ab „steuereinfach seit“ getrennt als endbesteuert |

Noch offen in Phase 1: lokale Historie, Prüfassistent.

## Entwickeln

```bash
npm install
npm test          # alle Tests
npm run typecheck # TypeScript-Prüfung
npm run report -- data/private/<Export>.csv 2026   # Auswertung einer echten Datei
npm run report -- data/private/<Export>.csv 2026 --steuereinfach-seit JJJJ-MM-TT   # Konto mit KESt-Abzug durch Trade Republic
npm run report -- data/private/<Export>.csv 2026 --ezb-kurse <eurofxref-hist.csv>   # Dividenden in Fremdwährung
npm run report -- data/private/<Flex>.xml 2026 --ezb-kurse <eurofxref-hist.csv> [--ibkr-zinsen 861]   # IBKR
```

IBKR: Activity Flex Query im Format XML mit den Abschnitten Trades (Detailstufe „Executions“, Felder u. a. ISIN, Proceeds, Level of Detail), Cash Transactions und Open Positions, Datumsformat yyyyMMdd, Zeitraum so weit zurück wie möglich. Fehlt ein Abschnitt oder Feld, nennt die App es konkret.

EZB-Kursdatei: [EZB, Euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) → `eurofxref-hist.zip`, entpackt. Die Web-App ruft die Kurse selbst über die [EZB-Datenschnittstelle](https://data.ecb.europa.eu/help/api/data) ab.

Trade-Republic-Export: App → Profil → Kontoauszüge → Transaktionsexport, Zeitraum seit Kontoeröffnung.

## Annahmen, die ein Steuerberater bestätigen muss

- **Verlustausgleich mit Dividenden:** Die anrechenbare Quellensteuer wird auf die österreichische Steuer gedeckelt, die auf die nach dem Verlustausgleich verbleibenden Dividenden entfällt (`src/basket275.ts`).
- **Tarif ohne Absetzbeträge:** Die Mehrsteuer aus KZ 857 wird eher zu hoch geschätzt (`src/tariff.ts`).
- **Trade-Republic-Derivate sind verbrieft:** Optionsscheine, Faktor-Zertifikate und Turbos landen in KZ 995/896 mit 27,5 % (`src/import/tradeRepublic.ts`).
- **Zinsen auf dem Trade-Republic-Verrechnungskonto** gelten als Zinsen aus Geldeinlagen bei Kreditinstituten: KZ 861, 25 %.
- **Krypto-Auslieferung ins eigene Wallet** ist ein Übertrag ohne Gewinn. Verkäufe außerhalb von Trade Republic erfasst die App noch nicht.
- **Vorzeichen von KZ 892:** Intern als positiver Betrag geführt. Wie er in FinanzOnline einzutragen ist, entscheidet erst der Bericht.
- **Kauf und Verkauf mit identischem Zeitstempel:** Der Kauf wird zuerst verbucht, unabhängig von der Reihenfolge in der Datei (`src/yearReport.ts`). Bei bereits vorhandenem Bestand beeinflusst das den Durchschnittspreis; offene Frage in `docs/HANDOFF.md`.
- **Fehlender Bestand:** Übersteigt ein Verkauf oder Übertrag den bekannten Bestand (z. B. Kauf vor dem Exportzeitraum), wird er samt allen späteren Abgängen derselben Position als „nicht berechnet“ gemeldet und die Position nicht mehr angezeigt. Dasselbe gilt ab einer übersprungenen Wertpapierbuchung (z. B. Fremdwährung, unbekannte Kapitalmaßnahme, ungültige Zahl). Die Rücklage kann dann zu niedrig sein; die App weist darauf hin.
- **Fonds und ETFs:** Ausschüttungsgleiche Erträge (KZ 937) und die Pauschalbesteuerung von Nicht-Meldefonds rechnet die App noch nicht. Käufe und Verkäufe werden gerechnet, je Fonds erscheint ein Hinweis unter „Nicht berechnet“.
- **Spalte `tax` im Export:** Bei einem Konto ohne KESt-Abzug wird ein dort ausgewiesener Steuerbetrag auf Verkäufe und Zinsen nicht angerechnet, sondern als Hinweis gemeldet. Die Rücklage fällt dadurch eher zu hoch aus. Bei Dividenden gilt er als ausländische Quellensteuer (siehe unten).
- **Steuereinfach seit:** Trade Republic ist in Österreich seit 24.04.2025 steuereinfach, Bestandskunden erst nach Zustimmung in der App ([broker-test.at](https://www.broker-test.at/news/trade-republic-wann-und-wie-werden-bestandskundschaften-steuereinfach/)). Gibt der Nutzer den Tag der Umstellung an, gelten Verkäufe, Ausschüttungen und Zinsen ab diesem Tag als endbesteuert: Sie zählen weder für die E1kv noch für die Rücklage und werden mit der von Trade Republic einbehaltenen Steuer (Spalte `tax`) getrennt ausgewiesen. Der Bestand wird weiter über die ganze Historie geführt. Ohne Angabe gilt das Konto als nicht steuereinfach (`src/yearReport.ts`).
- **Dividenden aus dem Trade-Republic-Export:** Buchungstyp `CASH/DIVIDEND` mit Anlageklasse `STOCK`. `amount` ist der Bruttobetrag in EUR, `tax` (negativ) die einbehaltene Steuer, ein negativer `amount` ein Storno. Quelle: der Trade-Republic-CSV-Importer von [Portfolio Performance](https://github.com/portfolio-performance/portfolio/blob/96f6040818d5b5e8aeaca63e60e7e6857b4befa2/name.abuchen.portfolio/src/name/abuchen/portfolio/datatransfer/traderepublic/TradeRepublicCSVExtractor.java). Ein echtes Beispiel eines österreichischen Kontos ohne KESt-Abzug lag nicht vor.
- **Quellensteuer = Spalte `tax` bei Dividenden:** Bei einem nicht steuereinfachen Konto gilt der ganze Betrag als ausländische Quellensteuer. Anrechenbar höchstens bis zum DBA-Satz (`src/treaty.ts`) und nach dem Verlustausgleich gekürzt (Annahme oben).
- **Quellenstaat = Land der ISIN:** Bei Hinterlegungsscheinen (ADR) oder Gesellschaften mit Sitz in einem anderen Land stimmt das nicht. Für Länder ohne hinterlegten DBA-Satz (z. B. Irland, Japan, Vereinigtes Königreich) wird keine Quellensteuer angerechnet und ein Hinweis gezeigt. Die MLI-synthetisierten Abkommensfassungen sind nicht geprüft.
- **Storno einer Ausschüttung:** Kehrt ein Storno eine frühere Ausschüttung derselben ISIN genau um (Betrag und Steuer), heben sich beide auf. Ohne passendes Gegenstück wird das Storno als „nicht berechnet“ gemeldet. Liegt das Storno in einem anderen Jahr als die ursprüngliche Ausschüttung, kommt ein Hinweis: Die Neubuchung zählt im Jahr ihres Buchungsdatums.
- **Nicht berechnet:** Ausschüttungen von Fonds und ETFs (steuerpflichtig ist laut § 186 InvFG 2011 bei Meldefonds der von der OeKB veröffentlichte Anteil, bei Nicht-Meldefonds die ganze Ausschüttung), Dividenden in Fremdwährung ohne EZB-Kurs am Zuflusstag oder ohne Originalbetrag, Kapitalausschüttungen (`DIVIDEND_EQUIVALENT_PAYMENT`, möglicherweise Einlagenrückzahlung; danach auch Verkäufe dieser Position), inländische Dividenden (ISIN AT), Zinsen aus Wertpapieren und Dividenden mit Steuergutschrift.
- **Altbestand wird nicht erkannt:** Krypto, angeschafft vor dem 1.3.2021, und Wertpapiere, angeschafft vor dem 1.1.2011, sind nicht steuerverfangen bzw. anders zu behandeln. Die App rechnet alle Käufe als Neubestand. Für Trade-Republic-Konten ist das in der Regel ohne Bedeutung, für ältere Depots aber zu prüfen.
- **Fremdwährung, Grundlage:** EStR 2000 Rz 6201c (Fassung vom 21.04.2026, Findok): Einkünfte in Fremdwährung (zB Dividenden, Zinsen) werden mit dem EZB-Referenzkurs im Zuflusszeitpunkt bewertet, ebenso Kursgewinne ohne tatsächliche Umrechnung in Euro. Kommt es tatsächlich zu einer Konvertierung in Euro, zählt der dabei verwendete Kurs.
- **Trades in Fremdwährung bei Trade Republic:** Trade Republic führt nur ein EUR-Konto und rechnet sofort um. Das gilt als tatsächliche Konvertierung: Es zählt der Euro-Betrag aus dem Export, kein EZB-Kurs (Entscheidung Joshua, 20.11.2026).
- **Dividenden in Fremdwährung:** Bruttobetrag = Originalbetrag (`original_amount`) zum EZB-Referenzkurs am Zuflusstag (`date`). Trade Republic weist die einbehaltene Steuer nur in EUR aus; sie wird mit dem Kurs von Trade Republic (`fx_rate`) in die Originalwährung zurückgerechnet und dann zum EZB-Kurs umgerechnet. Annahme: Trade Republic rechnet Steuer und Bruttobetrag mit demselben Kurs um.
- **IBKR, Trades in Fremdwährung:** IBKR hält Fremdwährung ohne Umtausch. Kurswert (`proceeds`, ohne Kommission) und Spesen werden deshalb zum EZB-Referenzkurs am Handelstag umgerechnet (EStR 2000 Rz 6201c, Kursgewinn ohne tatsächliche Umrechnung). Ein Konto mit automatischem Umtausch erkennt die App nicht. Ohne EZB-Kurs am Handelstag wird der Trade samt späteren Verkäufen der Position nicht berechnet. Transaktionssteuern (`taxes`) zählen wie Spesen und sind nicht abziehbar.
- **IBKR, Dividenden und Quellensteuer:** Getrennte Buchungen werden je ISIN, Währung und Zahltag (`dateTime`) zusammengeführt. Korrekturen tragen dasselbe `dateTime` und ein späteres `reportDate`; sie zählen deshalb im Jahr der ursprünglichen Zahlung. Quellensteuer ohne Dividende am selben Zahltag wird gemeldet.
- **IBKR, Zinsen auf dem Konto** („Broker Interest Received“): Einstellung KZ 863 (27,5 %, Standard, Entscheidung Joshua 20.11.2026) oder KZ 861 (25 %), offene Frage an den Steuerberater. Sollzinsen, Gebühren und Ein-/Auszahlungen sind ohne Bedeutung für die KESt.
- **IBKR, nicht berechnet:** Optionen, Futures und CFDs (Phase 2), Devisentausch (Fremdwährungsgewinne laut EStR 2000 Rz 6201 f.), Optionsscheine und strukturierte Produkte (Anlageklassen WAR, IOPT; danach auch Verkäufe dieser Position), Ersatzzahlungen für Dividenden (Wertpapierleihe), Anleihezinsen und Stückzinsen.
- **IBKR, Bestandsabgleich:** Weicht der Bestand laut Open Positions vom berechneten ab (z. B. Kauf vor dem Zeitraum der Flex Query), kommt ein Hinweis.
- **Tag ohne EZB-Kurs** (Wochenende, Feiertag): Eine offizielle Regel dafür ist nicht bekannt (EStR 2000 Rz 6201c nennt nur den Zuflusszeitpunkt). Die Dividende wird als „nicht berechnet“ gemeldet, es wird kein Kurs vom Vortag genommen.

## Daten

Echte Broker-Exporte gehören nach `data/private/` und werden **nie** committet (siehe `.gitignore`).
