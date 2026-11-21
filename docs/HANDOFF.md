# Übergabe: Stand und Kontext (20.11.2026)

Diese Datei fasst alles zusammen, was im Planungs-Chat entschieden wurde. Wer an diesem Repository weiterarbeitet, liest sie zuerst, danach `CLAUDE.md` und `README.md`.

## Produkt

**KESt-Rücklage-App:** Für Anleger in Österreich mit einem nicht steuereinfachen Broker (Trade Republic, IBKR, DEGIRO …). Die App rechnet laufend die KESt aus und zeigt, wie viel man zurücklegen muss, damit das Geld beim Steuerbescheid da ist.

- Produktplan: `docs/PRODUKTPLAN.md` (Export des Docs https://claude.ai/artifact/Pz2JTUN4Bq72zbGKMx254i)
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
- Fremdwährung (EStR 2000 Rz 6201c): Erträge (Dividenden, Zinsen) und Kursgewinne ohne tatsächlichen Umtausch zum EZB-Referenzkurs im Zuflusszeitpunkt; bei tatsächlicher Konvertierung in Euro zählt der verwendete Kurs. Trade Republic rechnet tatsächlich um, dort zählt der Euro-Betrag aus dem Export (Entscheidung Joshua, 20.11.2026).
- Verlustausgleich nur im selben Kalenderjahr, kein Vortrag. Verluste im 27,5 %-Topf dürfen Dividenden ausgleichen; dann sinkt die anrechenbare Quellensteuer. Bankzinsen (25 %) sind ein eigener Topf.
- Quellensteuer nur bis zum DBA-Satz anrechenbar (USA 15 %).
- Stillhalter: Prämie wird bei Verfall bzw. Glattstellung erfasst.
- Nicht-Meldefonds: pauschal 90 % der Wertsteigerung, mindestens 10 % des Werts am 31.12.
- Tarif 2026: 0 % bis 13.539 €, 20 % bis 21.992 €, 30 % bis 36.458 €, 40 % bis 70.365 €, 48 % bis 104.859 €, 50 % bis 1 Mio. €, darüber 55 % (laut BMF bestätigt; 2024 und 2025 ebenfalls in `src/tariff.ts`). Der Tarif 2027 ist noch nicht veröffentlicht und muss nachgetragen werden, sobald das BMF ihn nennt.

## Offene Fragen an Steuerberater/Anwalt (nicht selbst entscheiden)

- Optionen/Futures bei IBKR: KZ 857 (Tarif) oder 995? Ein Tool ordnet 995 zu, BMF-Formular und Tax-Wizard sagen 857. Laut KPMG (06/2022) erlaubt VwGH 08.03.2022, Ro 2019/15/0184 bei Abwicklung über eine Bank in einem anderen EU-Staat 27,5 % in der Veranlagung; ob das für IBKR (Interactive Brokers Ireland) gilt, ist Teil der Gate-2-Fragen.
- Broker-Zinsen: KZ 861 (25 %) oder 863 (27,5 %)?
- Reihenfolge Verlustausgleich mit Dividenden und Kürzung der Quellensteuer.
- Vorzeichen von KZ 892/896/176 in FinanzOnline.
- Grenze Berechnungstool vs. Steuerberatung; reicht der Kriterien-Check der Rücklage?
- Kauf und Verkauf derselben ISIN mit identischem Zeitstempel bei bereits vorhandenem Bestand: In welcher Reihenfolge fließen sie in den gleitenden Durchschnittspreis ein? Derzeit Annahme „Kauf zuerst“ (Review 18.11.2026).
- Falls Trade Republic in Österreich Steuern einbehält (Spalte `tax`, z. B. nach einer Umstellung auf steuereinfach): Wie sind diese Beträge in E1kv und Rücklage zu berücksichtigen? Seit Schritt 1.1: Ab dem vom Nutzer angegebenen Tag „steuereinfach seit“ gelten Erträge als endbesteuert und zählen nicht; davor nur Hinweis, keine Anrechnung.
- **Produkt (Joshua):** Trade Republic ist in Österreich seit 24.04.2025 steuereinfach (Neukunden sofort, Bestandskunden nach Zustimmung in der App; Quelle: [broker-test.at](https://www.broker-test.at/news/trade-republic-wann-und-wie-werden-bestandskundschaften-steuereinfach/), Pressemitteilung Trade Republic vom 24.04.2025). Joshuas eigenes Konto ist umgestellt. Damit braucht die laufende Rücklage bei Trade Republic nur noch, wer nicht umgestellt hat, oder für die Zeit vor der Umstellung. PRODUKTPLAN und Zielgruppe nennen Trade Republic noch als „nicht steuereinfach“.
- Endbesteuerte Erträge bei Trade Republic und Verluste bei einem anderen Broker: Wann lohnt die Regelbesteuerungs- bzw. Verlustausgleichsoption in der Veranlagung, und wie stellt die App das dar, ohne zu beraten? Derzeit zählt die App endbesteuerte Erträge gar nicht.
- Bestandskunden: Kennt Trade Republic nach der Umstellung die Anschaffungskosten von Positionen, die vorher gekauft wurden? Laut broker-test.at nicht immer; zu viel einbehaltene KESt wäre dann über die Veranlagung zurückzuholen. Die App zeigt beim endbesteuerten Verkauf ihren eigenen Gewinn neben der einbehaltenen Steuer, prüft aber nicht, ob beides zusammenpasst.
- Dividenden-Storno über den Jahreswechsel (Storno 2026 einer Dividende von 2025, danach Neubuchung): In welchem Jahr zählt die Neubuchung? Derzeit im Jahr ihres Buchungsdatums, mit Hinweis.
- „Capital Distribution“ (`DIVIDEND_EQUIVALENT_PAYMENT`): Dividende oder Einlagenrückzahlung (mindert die Anschaffungskosten)? Derzeit nicht berechnet.
- Quellensteuer aus Irland (DBA Art. 8, 15 % nur mit irischer Steuergutschrift), Japan (DBA BGBl. III Nr. 167/2018) und dem Vereinigten Königreich: DBA-Satz noch nicht hinterlegt, derzeit keine Anrechnung. Die MLI-synthetisierten Fassungen der Abkommen sind nicht geprüft.
- Quellenstaat bei Hinterlegungsscheinen (ADR) und Gesellschaften mit Sitz außerhalb des ISIN-Landes: Derzeit gilt das Land der ISIN.
- Fremdwährung an einem Tag ohne EZB-Referenzkurs (Wochenende, Feiertag): Welcher Kurs gilt? EStR 2000 Rz 6201c nennt nur den Zuflusszeitpunkt, eine Regel für fehlende Kurse ist nicht bekannt. Derzeit „nicht berechnet“.
- Optionen/Futures bei IBKR, ergänzend zur Frage KZ 857 oder 995: Sind Spesen beim Tarif abziehbar (derzeit ja)? Wie wird ein negativer Saldo in KZ 857 eingetragen und womit ist er ausgleichbar (derzeit nur innerhalb KZ 857)? Gleitender Durchschnitt bei Short-Positionen (derzeit durchschnittliche Prämie)? Futures: Ergebnis aus Eröffnungs- und Schließungswert statt täglicher Margins (derzeit so)? Spesen bei ausgeübten Optionen (derzeit nicht übertragen)?
- IBKR-Zinsen: KZ 861 oder 863? Jetzt Einstellung, Standard KZ 863 (Entscheidung Joshua 20.11.2026, bis der Steuerberater entscheidet).
- IBKR-Konten mit automatischem Umtausch in EUR: Wäre das eine tatsächliche Konvertierung (Rz 6201c, zweiter Punkt)? Derzeit rechnet die App IBKR-Trades in Fremdwährung immer zum EZB-Kurs.
- Devisentausch bei IBKR (Fremdwährungsguthaben in EUR oder andere Währung): steuerpflichtiger Tausch laut EStR 2000 Rz 6201 f., wenn das Guthaben Zinsen bringt. Derzeit nicht berechnet, nur gemeldet.
- Ersatzzahlungen für Dividenden aus der Wertpapierleihe (IBKR „Payment In Lieu Of Dividends“): Behandlung und Quellensteuer? Derzeit nicht berechnet.
- **Datenschutz (Joshua):** Die lokale Historie und das Backup enthalten die vollständigen Exportdateien, bei Trade Republic auch Kartenzahlungen, Überweisungen, Namen und IBANs von Gegenparteien. Sollen nur steuerrelevante Zeilen gespeichert werden (Datensparsamkeit), und soll das Backup verschlüsselt werden (Passwort)? Derzeit Originaldateien, mit Hinweis in der App.
- **Automatischer Abruf (Joshua):** Soll das IBKR-Relay öffentlich gehostet werden (dann geht das Token über unseren Server, Datenschutz)? SnapTrade Personal (kostenlos, Nutzer bringt eigene Schlüssel mit), Commercial (100 $/Monat plus 1 $ je Nutzer, Server) oder vorerst nicht? Siehe `docs/AUTOMATISCHER-ABRUF.md`.
- Kennzahlen der E1kv: Die App nutzt die Kennzahlen laut Formular E1kv 2024. Vor der ersten echten Abgabe mit dem Formular des jeweiligen Steuerjahres (2025, 2026) abgleichen und bei Änderungen die Regelversion in `src/rules.ts` erhöhen.
- DEGIRO: Gilt AutoFX (sofortiger Umtausch beim Handel) als tatsächliche Konvertierung (Rz 6201c), sodass der EUR-Betrag aus dem Export zählt? Und sind Guthabenzinsen der flatexDEGIRO Bank (Deutschland) Zinsen aus Geldeinlagen bei Kreditinstituten (KZ 861, 25 %)? Derzeit beides so angenommen.
- Quellensteuer bei Dividenden in Fremdwährung: Trade Republic weist sie nur in EUR aus. Die App rechnet sie mit dem Kurs von Trade Republic in die Originalwährung zurück und dann zum EZB-Kurs in EUR (Annahme: derselbe Kurs wie für den Bruttobetrag).

## Stand des Codes

- Phase 1 (Rechenkern) weitgehend fertig, 50 Tests grün (Stand vor dem Review). Module: siehe README-Tabelle.
- Trade-Republic-CSV-Import (`src/import/tradeRepublic.ts`), Jahresauswertung (`src/yearReport.ts`), Textbericht (`npm run report`), Web-App (`npm run build:web`).
- Getestet mit Joshuas echtem Export (liegt **nur** lokal unter `data/private/`, nie committen). Ergebnis 2026: KZ 892 3,52 €, KZ 995 1,99 €, KZ 896 0,08 €, KZ 174 0,19 €, KZ 861 0,01 €, Steuer 0 €, 1,42 € Verlust übrig. Handrechnung stimmt.
- Der echte Export enthält nur: TRADING BUY/SELL (STOCK, DERIVATIVE, CRYPTO), DELIVERY FREE_DELIVERY (Krypto ins Wallet), CASH INTEREST_PAYMENT sowie Karten-/Überweisungsbuchungen. **Kein Dividenden-Beispiel**: Buchungstyp für Dividenden bei Trade Republic ist noch unbekannt und wird bewusst als „Unbekannter Buchungstyp“ gemeldet.
- PR #1 (`trade-republic-import`) und PR #2 (`review-haertung`) sind am 20.11.2026 gemergt.
- Review und Härtung (PR #2): BOM, falsche/leere Datei, ungültige Zahlen und Daten, gleicher Zeitstempel, fehlender Bestand („nicht berechnet“ statt Abbruch), Übertrag größer als Bestand, Hinweise für Fonds/ETF und Spalte `tax`; Web-App zeigt Fehler klar und lässt keine alten Zahlen stehen. 77 Tests grün.
- **Schritt 1.1 (Branch `schritt-1.1-tr-dividenden`):** Dividenden aus dem Trade-Republic-Export (`CASH/DIVIDEND`, belegt über den Importer von Portfolio Performance) → KZ 863, Quellensteuer → KZ 998, gedeckelt mit dem DBA-Satz je Land (`src/treaty.ts`, 14 Länder aus dem RIS) und gekürzt nach Verlustausgleich. Stornos werden verrechnet oder gemeldet. Fondsausschüttungen, Kapitalausschüttungen, Dividenden in Fremdwährung, inländische Dividenden und Anleihezinsen werden „nicht berechnet“ gemeldet. Neu: Einstellung „steuereinfach seit“ (Web-App, `--steuereinfach-seit` im Bericht): Erträge ab dann gelten als endbesteuert und erscheinen getrennt mit der einbehaltenen Steuer. Der Hinweis zur Spalte `tax` kommt jetzt aus der Jahresauswertung und nur im betroffenen Jahr. 116 Tests grün.
- Das Ergebnis 2026 aus Joshuas Export (oben) ist ohne „steuereinfach seit“ gerechnet. Da sein Konto umgestellt ist, muss er es mit seinem Umstellungsdatum neu rechnen.
- **Schritt 1.2 (Branch `schritt-1.2-ezb-kurse`, baut auf 1.1 auf):** Austauschbare Kursquelle `RateSource` mit `RateTable` (`src/fx.ts`), Einlesen von `eurofxref-hist.csv` und der CSV der EZB-Datenschnittstelle. Dividenden in Fremdwährung zum EZB-Referenzkurs am Zuflusstag; ohne Kurs an dem Tag „nicht berechnet“. Trades in Fremdwährung bei Trade Republic werden nicht mehr abgelehnt, es zählt der tatsächlich umgerechnete Euro-Betrag. Web-App ruft die Kurse automatisch bei der EZB ab (nur Währung und Zeitraum, Entscheidung Joshua); scheitert das, kann man die EZB-Kursdatei laden. Bericht: `--ezb-kurse <datei>`. 137 Tests grün.
- **Schritt 1.3 (Branch `schritt-1.3-ibkr-flex`, baut auf 1.2 auf):** IBKR Activity Flex Query (XML) mit eigenem XML-Leser (`src/import/xml.ts`) und gemeinsamem Datenmodell (`src/import/model.ts`). Trades (nur Detailstufe EXECUTION, Stornos verrechnet) → KZ 994/892, in Fremdwährung zum EZB-Kurs am Handelstag; Dividenden und Quellensteuer je ISIN und Zahltag zusammengeführt → KZ 863/998; Zinsen → Einstellung KZ 863 (Standard) oder 861; Optionen/Futures erkannt und „kommt in Phase 2“ gemeldet; Bestandsabgleich mit Open Positions. Fehlende Abschnitte und Felder werden konkret gemeldet. „Steuereinfach seit“ gilt nur noch für das Depot von Trade Republic. Web-App und Bericht erkennen den Broker am Dateiinhalt. Geprüft auch gegen die anonymisierten echten Flex-Dateien aus den Tests von Portfolio Performance (nicht im Repository). 182 Tests grün.
- **Schritt 1.4 (Branch `schritt-1.4-lokale-historie`, baut auf 1.3 auf):** Lokale Historie (`src/history.ts`, `src/web/storage.ts`): Dateien und Einstellungen dauerhaft in IndexedDB, mehrere Dateien und Broker zusammengeführt (zeilenweise, Duplikate über die Transaktions-ID, Stornos auch über Dateigrenzen), Backup als JSON speichern und wiederherstellen (ergänzt statt ersetzt), Dateien entfernen, alles löschen. Klarer Hinweis in der App, dass die Daten nur auf diesem Gerät liegen. Importe tragen bei mehreren Dateien den Dateinamen in Hinweisen. Bericht nimmt mehrere Dateien. 199 Tests grün.
- **Schritt 1.5 (Branch `schritt-1.5-pruefassistent`, baut auf 1.4 auf):** Prüfassistent „Buchungen prüfen“ (`src/check.ts`, `checkBookings`): Verkauf ohne Bestand, Übertrag größer als Bestand, doppelte Buchungen, Lücken im Exportzeitraum (Zeiträume je Datei aus `filePeriods`), Fremdwährung ohne EZB-Kurs, unbekannte Buchungstypen, Bestand nahe 0 durch Rundung. Schweregrad Fehler/Warnung/Hinweis, Klartext und Fundstellen. Anzeige in der Web-App über der Auswertung und im Bericht. 217 Tests grün.
- **Gate 1 freigegeben** von Joshua am 20.11.2026 (Abgleich 2025 mit DepotTax/Tax-Wizard laut Joshua stimmig). PRs #3 bis #7 sind noch offen und bauen aufeinander auf.
- **Schritt 2.1 (Branch `schritt-2.1-derivate`, baut auf 1.5 auf):** Nicht verbriefte Derivate (`src/derivatives.ts`): IBKR-Optionen und -Futures mit Long/Short je Kontrakt, Stillhalter (Prämie erst bei Verfall/Glattstellung/Ausübung), Ausübung und Zuteilung mit Übertrag der Prämie auf die Aktie (EStR Rz 6174a, 6176), Erkennung über IBKR-Codes und Aktienbuchung, Einstellung Tarif (KZ 857, Standard) oder 27,5 % (KZ 995/896). Testfälle 4 und 5 aus dem PRODUKTPLAN. Geprüft gegen die echten anonymisierten Flex-Dateien von Portfolio Performance: eine Zuteilung ohne eingelesene Aktienbuchung wird korrekt „nicht berechnet“ statt als Verfall. 244 Tests grün.
- **Schritt 2.2 (Branch `schritt-2.2-tarif`, baut auf 2.1 auf):** Mehrsteuer auf KZ 857 über `src/tariff.ts` mit Tarif je Jahr (2024–2026 laut BMF, Stand 01.01.2026; 2027 noch nicht veröffentlicht), sonstiges Einkommen als Einstellung (nur bei Optionen/Futures abgefragt; ohne Angabe Hinweis statt Schätzung). Die Rücklage enthält jetzt die Mehrsteuer. 258 Tests grün.
- **Schritt 2.3 (Branch `schritt-2.3-ruecklage`, baut auf 2.2 auf):** Rücklagen-Ledger (`src/ledger.ts`) mit Ist-Einträgen (Datum, Marktwert, Ort, Notiz), „Steuer bezahlt“ je Jahr und Soll gegen Ist über alle offenen Jahre. Soll-Verlauf (`src/sollTimeline.ts`, neue Option `asOf` in `computeYear`): Freigabe erst nach dem 31.12., im laufenden Jahr bleibt der Höchststand des Solls gesperrt (Testfall 6). Kriterien-Check der Anlage nach Angaben des Nutzers (Anlageart, Meldefonds, SRI; Warnung ab SRI 3, Entscheidung Joshua), warnt nur und nennt kein Produkt. Ledger in Historie und Backup (ältere Backups ohne Ledger bleiben lesbar). Web-App: Bereich „Deine Rücklage: Soll und Ist“. 282 Tests grün.
- **Schritt 2.4 (Branch `schritt-2.4-erinnerungen`, baut auf 2.3 auf):** Erinnerungen als reine Funktion mit Stichtag (`src/reminders.ts`): Fehlbetrag oder fehlender Stand der Rücklage, letzter Import älter als 30 Tage, Frist der Steuererklärung (Papier 30.04., FinanzOnline 30.06. des Folgejahres, § 134 Abs 1 BAO, an der BMF-Seite geprüft und verlinkt; Warnung in den letzten 30 Tagen), im November/Dezember der Hinweis zum Verlustausgleich mit dem Stand des Jahres. Web-App: Bereich „Erinnerungen“ über dem Prüfassistenten, nur für eigene Daten. 302 Tests grün.
- **Gate 2 (Branch `gate-2-fragen`, baut auf 2.4 auf):** `docs/FRAGEN-STEUERBERATER-ANWALT.md` mit allen offenen Fragen, je mit Beispielrechnung aus den Tests. Joshua klärt sie extern. **Freigabe zum Weiterbau** am 20.11.2026: „Du sollst jetzt den Rest fertig bauen, komplett. Die Fragen lasse ich später beantworten.“
- **Schritt 3.1 (Branch `schritt-3.1-einrichtung`, baut auf Gate 2 auf):** Einrichtungsassistent als Dialog (`src/setup.ts`, `src/web/setupWizard.ts`): Broker wählen, Anleitung mit Checkliste und Platzhaltern für Screenshots (Wege laut ibkrguides.com bzw. Portfolio-Performance-Forum/CoinTracking für Trade Republic, kein offizieller TR-Hilfeartikel gefunden), Sofortprüfung (`checkImport`), drei Fragen (`applySetup`) plus „steuereinfach seit“ bei Trade Republic. Neue Einstellungen `reservePlace` und `setupDoneAt` (im Backup). Öffnet sich beim ersten Besuch ohne Dateien. 316 Tests grün. Screenshots fehlen noch (Platzhalter).
- **Schritt 3.2 (Branch `schritt-3.2-degiro`, baut auf 3.1 auf):** DEGIRO-Import (`src/import/degiro.ts`): „Transaktionen“ (Trades, AutoFX → EUR-Betrag, sonst EZB-Kurs) und „Kontoübersicht“ (Dividenden mit Dividendensteuer, Fondsausschüttung, Kapitalrückzahlung, Guthabenzinsen KZ 861), Erkennung am Spaltenlayout, Zusammenführen überlappender Dateien, Anleitung im Assistenten. Formate belegt über libdegiro und degiro-portfolio (kein offizielles DEGIRO-Dokument). 336 Tests grün.
- **Schritt 3.3 (Branch `schritt-3.3-simulator`, baut auf 3.2 auf):** Verkaufs-Simulator `simulateSale` (gedachter Verkauf am heutigen Tag als zusätzliche Buchung, Steuer des Jahres bis heute vorher/nachher, Soll vorher/nachher, Hinweis bei endbesteuertem TR-Verkauf) und Kauf-Check `checkOrder` (Guthaben minus Rücklage; neues Feld `requiredEur` im Rücklagen-Status = Höchststand bis 31.12.). Web-App: Bereich „Verkaufs-Simulator“ und „Kauf-Check“. 345 Tests grün.
- **Schritt 3.4 (Branch `schritt-3.4-e1kv-bericht`, baut auf 3.3 auf):** E1kv-Bericht (`src/e1kvReport.ts`): Dokumentmodell, CSV (Strichpunkt, Dezimalkomma, BOM) und PDF (eigener kleiner PDF-Schreiber, Standardschriften, WinAnsi, Hinweis im Kasten und in jeder Fußzeile, Regelversion `src/rules.ts`). Belegliste aus Verkäufen, Dividenden und Zinsen mit Fundstelle (neu: `line`/`file` in `RealizedLine` und `DividendLine`, `interest` im Jahresbericht). Knöpfe in der Web-App, `--pdf`/`--csv` im Bericht. 356 Tests grün.
- **Schritt 3.5 (Branch `schritt-3.5-pwa`, baut auf 3.4 auf):** Installierbare Web-App (`src/pwa/`, Build jetzt `scripts/build-web.ts` über tsx): `dist/pwa/` mit Manifest, Service Worker (Precache, Seite network-first, fremde Adressen nie gecacht), Symbolen (eigener PNG-Schreiber), CSP mit SHA-256 des Inline-Skripts (Zeilenumbrüche vorher auf LF, sonst blockiert der Browser das Skript), `_headers`, ohne Google Fonts (DSGVO). Im Browser geprüft: installierbar, offline nach Server-Stopp. Hosting nur vorbereitet (`docs/HOSTING.md`), Host wählt Joshua. 369 Tests grün.
- **Gate 3 (Branch `gate-3-testgruppe`):** Testanleitung `docs/TESTGRUPPE.md` (Aufgaben, Zeitmessung, Fragebogen, Kriterium: 4 von 5 schaffen die Einrichtung ohne Hilfe). Joshua führt den Test durch; auf seinen Wunsch geht es parallel mit dem automatischen Abruf der Broker-Daten weiter (20.11.2026: „ein integriertes Tool, das die Daten automatisch ausliest, bei den Brokern, bei denen es möglich ist“).
- **Schritt 4.1 (Branch `schritt-4.1-ibkr-abruf`, baut auf Gate 3 auf):** Automatischer IBKR-Abruf über den Flex Web Service v3 (`src/sync/ibkrFlexService.ts`): SendRequest/GetStatement, Warten bei 1019, Grenzen 1/s und 10/min, Fenster ≤ 365 Tage, deutsche Fehlermeldungen ohne Token. IBKR sendet keine CORS-Header (geprüft) → Web-App ruft über zustandsloses Relay ab (`src/sync/relay.ts`, `npm run relay` lokal auf 8787, in der CSP erlaubt); Kommandozeile `npm run sync` direkt. Web-App: Abschnitt „Automatisch von IBKR abrufen“, Zugangsdaten getrennt in IndexedDB, nicht im Backup; erster Abruf ab Datum, danach laufende Datei der letzten 365 Tage; optional automatisch beim Öffnen. Getestet mit Platzhalter-Token gegen den echten Dienst (Fehler 1015 kommt korrekt durch). 388 Tests grün. Doku: `docs/AUTOMATISCHER-ABRUF.md`.
- Bekannte Lücken im Rechenkern (siehe README „Annahmen“): keine ausschüttungsgleichen Erträge / Nicht-Meldefonds, keine Fondsausschüttungen, kein Altbestand (Krypto vor 1.3.2021, Wertpapiere vor 1.1.2011). Import-Hinweise unter „Nicht berechnet“ erscheinen weiterhin in jedem Jahr, nicht nur im betroffenen.

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
