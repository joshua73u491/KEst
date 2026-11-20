# Fragen an Steuerberater und Anwalt (Gate 2)

Stand 20.11.2026, Code-Stand Schritt 2.4 (Branch `schritt-2.4-erinnerungen`). Diese Liste fasst alle offenen Fragen aus `docs/HANDOFF.md` und `docs/PRODUKTPLAN.md` zusammen. Joshua klärt sie extern. Ohne seine Freigabe geht es nicht mit Phase 3 weiter.

**Wie die Liste aufgebaut ist:** Jede Frage nennt, was die App heute rechnet, eine Beispielrechnung aus den Tests (Datei und Testname, damit sich jede Zahl nachprüfen lässt) und die andere Auslegung mit ihrer Auswirkung. Zahlen, die nicht aus einem Test stammen, sind als **Handrechnung** markiert. Die Zeile „Antwort“ ist für das Ergebnis des Gesprächs gedacht. Jede Antwort wird in der App zu einer festen Regel oder zu einer erklärten Einstellung.

**Was die App ist:** Ein Berechnungstool für Anleger in Österreich mit Broker ohne KESt-Abzug (vor allem IBKR, Trade Republic vor der Umstellung auf steuereinfach). Es rechnet die E1kv-Kennzahlen und eine laufende „Soll-Rücklage“ für die spätere Steuer. Alles läuft lokal im Browser, nichts verlässt das Gerät außer dem Abruf öffentlicher EZB-Kurse (nur Währung und Zeitraum).

**Priorität:** A = verändert Steuer oder Rücklage stark, B = mittel, C = Randfall.

---

## Teil 1 · Fragen an den Steuerberater

### 1.1 · Optionen und Futures bei IBKR: Tarif (KZ 857) oder 27,5 % (KZ 995/896)? · Priorität A

**Derzeit:** Nicht verbriefte Derivate ohne freiwilligen KESt-Abzug fallen laut § 27a Abs. 2 Z 7 EStG nicht unter den Sondersteuersatz. Die App rechnet deshalb standardmäßig zum Tarif in KZ 857 und schätzt die Mehrsteuer. Der Nutzer kann auf 27,5 % (KZ 995/896) umstellen. DepotTax ordnet solche Ergebnisse KZ 995 zu, das BMF-Formular und Tax-Wizard nennen KZ 857.

**Wichtiger Hinweis:** Ein [KPMG-Newsletter (06/2022)](https://kpmg.com/at/de/media/newsletter/tax-news/2022/06/tn-anwendung-des-besonderen-steuersatzes-auch-fuer-im-ausland-abgewickelte-einkuenfte-aus-nicht-verbrieften-derivaten.html) berichtet über VwGH 08.03.2022, Ro 2019/15/0184:
- Die Beschränkung des freiwilligen KESt-Abzugs auf inländische Banken verletzt die Dienstleistungsfreiheit (Art. 56 AEUV).
- Für nicht verbriefte Derivate, die über eine Bank in einem anderen EU-Staat ohne KESt-Abzug abgewickelt wurden, kann laut KPMG der Satz von 27,5 % in der Veranlagung beantragt werden.
- Seit 01.03.2022 können auch ausländische Zahlstellen und Wertpapierfirmen freiwillig KESt abziehen.

Das spricht bei einem EU-Broker für 27,5 %. Die App berücksichtigt es noch nicht.

**Beispiel aus den Tests** (`test/derivatives.test.ts`):
- „Testfall 4a: Short Put verfällt wertlos …“: Prämie 200 €, Verfall am 18.12.2026 → KZ 857 = 200 €, KZ 995 = 0.
- „2026: 30.000 € sonstiges Einkommen, 5.000 € Prämie -> 1.500 € Mehrsteuer“: Mehrsteuer = ESt(35.000) − ESt(30.000) = 30 % × 5.000 € = **1.500 €**.
- „Einstellung 27,5 %: Ergebnis in KZ 995/896 und im 27,5 %-Topf mit Verlustausgleich“: Prämie 200 € in KZ 995, Aktienverlust 50 € in KZ 892 → Bemessungsgrundlage 150 €. Beim Tarif bliebe der Aktienverlust ohne Wirkung auf die Prämie.

**Handrechnung zur Spannweite:** dieselbe Prämie von 5.000 € mit 27,5 % ergibt 1.375 €. Bei 80.000 € sonstigem Einkommen (2026, Stufe 48 %) ergibt der Tarif 2.400 €.

**Fragen:**
- Welche Kennzahl und welcher Satz gelten für Optionen und Futures bei IBKR ohne KESt-Abzug? Gilt das auch für Stillhalterprämien?
- Gilt das VwGH-Erkenntnis für IBKR? Österreichische Kunden werden nach unserem Verständnis über Interactive Brokers Ireland geführt, eine Wertpapierfirma und keine Bank (bitte prüfen).
- Muss der Satz von 27,5 % eigens beantragt werden, und wie wird das in FinanzOnline eingetragen?
- Was gilt für Broker außerhalb der EU?

**Antwort:**

### 1.2 · Einzelheiten zu Optionen und Futures · Priorität B

Nur relevant, wenn 1.1 „Tarif“ ergibt (einige Punkte auch bei 27,5 %).

| Punkt | Derzeit | Beispiel aus `test/derivatives.test.ts` |
| --- | --- | --- |
| a) Spesen | beim Tarif abziehbar (der Ausschluss in § 27a Abs. 4 Z 2 gilt nur beim Sondersteuersatz), bei 27,5 % nicht | „Spesen: beim Tarif abziehbar, bei 27,5 % nicht“: Prämie 200 €, Rückkauf 50 €, je 2 € Kommission → KZ 857 = 146 €, mit 27,5 % KZ 995 = 150 € |
| b) Verlust in KZ 857 | bleibt in KZ 857 negativ und gleicht keine Einkünfte im 27,5 %-Topf aus (EStR 2000 Rz 6234, Annahme) | „Long Option verfällt“: KZ 857 = −120 €, Mehrsteuer 0 € |
| c) Short-Positionen | gleitender Durchschnitt der erhaltenen Prämie (Annahme analog zu § 27a Abs. 4 Z 3) | „ein Trade schließt Long und eröffnet Short“: Long 1 zu 100 €, Verkauf 2 für 300 € → +50 € realisiert, Short 1 mit Prämie 150 € offen |
| d) Futures | Ergebnis = Schließungs- minus Eröffnungswert, nicht die täglichen Margin-Zahlungen (Rz 6175, Annahme) | „Future: Gewinn aus der Differenz …“: 250.000 € → 250.500 € = +500 € |
| e) Spesen bei Ausübung | nur die Prämie geht in die Aktie ein, Spesen der Option nicht | „Long Call ausgeübt …“: Prämie 100 €, Lieferung 100 Stück zu 50 € → Anschaffungskosten 5.100 € |

**Fragen:** Stimmen a) bis e)? Wie wird ein negativer Saldo in KZ 857 eingetragen?

**Antwort:**

### 1.3 · Tarif-Schätzung für KZ 857 · Priorität B

**Derzeit:** Mehrsteuer = ESt(sonstiges Einkommen + KZ 857) − ESt(sonstiges Einkommen), mit dem Tarif des Jahres laut BMF (2024 bis 2026 hinterlegt). Absetzbeträge bleiben unberücksichtigt, die Mehrsteuer fällt dadurch eher zu hoch aus. Das sonstige Einkommen gibt der Nutzer als Schätzung ein. Ohne Angabe rechnet die App die Mehrsteuer nicht und meldet das.

**Beispiel aus den Tests** (`test/tariff.test.ts`, „über eine Stufengrenze: 2025, 33.000 € + 5.000 € …“): 30 % × 2.836 € + 40 % × 2.164 € = **1.716,40 €**.

**Fragen:**
- Ist „ohne Absetzbeträge“ für eine Rücklage vertretbar?
- Wie schätzt ein Nutzer sein sonstiges Einkommen unterjährig am besten (Lohnzettel des Vorjahres, Hochrechnung)? Welche Formulierung im Eingabefeld ist richtig („zu versteuerndes Jahreseinkommen ohne Kapitalerträge“)?

**Antwort:**

### 1.4 · Zinsen auf dem IBKR-Konto: KZ 863 (27,5 %) oder KZ 861 (25 %)? · Priorität B

**Derzeit:** Einstellung, Standard KZ 863 (Entscheidung Joshua, 20.11.2026). KZ 861 ist laut Gesetz für Geldeinlagen bei Kreditinstituten gedacht; ob IBKR-Guthaben darunter fallen, ist offen.

**Beispiel aus den Tests** (`test/yearReport.test.ts`):
- „Zinsen von IBKR: Standard KZ 863 (27,5 %), wahlweise KZ 861 (25 %)“: 4 USD zum EZB-Kurs 1,10 = 3,64 € in KZ 863 oder KZ 861.
- „Zinsen von IBKR in KZ 863 werden mit Verlusten ausgeglichen“: 10 € Zinsen, 4 € Kursverlust → 6 € Bemessungsgrundlage, **1,65 €** Steuer.

**Handrechnung mit KZ 861:** 25 % × 10 € = 2,50 € Steuer, der Verlust von 4 € bleibt ohne Ausgleich (der 25 %-Topf ist getrennt).

**Antwort:**

### 1.5 · Verlustausgleich mit Dividenden und Kürzung der Quellensteuer · Priorität A

**Derzeit:** Verluste im 27,5 %-Topf gleichen auch Dividenden aus. Die anrechenbare Quellensteuer wird auf die österreichische Steuer gedeckelt, die auf die nach dem Ausgleich verbleibenden Dividenden entfällt. Mehrere Ratgeber widersprechen sich.

**Beispiel aus den Tests** (`test/basket275.test.ts` und `test/yearReport.test.ts`, „Testfall 3: Kursverlust im selben Jahr senkt die anrechenbare Quellensteuer“): Dividende 100 €, Quellensteuer 15 €, Kursverlust 60 € → Bemessungsgrundlage 40 €, österreichische Steuer 11 €, anrechenbar **11 €** (KZ 998), Steuer **0 €**.

**Handrechnung zur anderen Auslegung (anteilige Kürzung):** 15 € × 40/100 = 6 € anrechenbar, Steuer 11 € − 6 € = **5 €**.

**Außerdem** („Verlustüberhang: keine Steuer, kein Vortrag“): Kursverlust 500 €, Dividende 100 € mit 15 € Quellensteuer → anrechenbar 0 €, 400 € Verlust verfallen.

**Frage:** In welcher Reihenfolge wird verrechnet, und wie stark sinkt die anrechenbare Quellensteuer? Was gehört dann in KZ 998?

**Antwort:**

### 1.6 · Vorzeichen von KZ 892, 896 und 176 in FinanzOnline · Priorität B

**Derzeit:** Die App führt Verluste als positiven Betrag. Wie sie in FinanzOnline einzutragen sind, soll erst der E1kv-Bericht entscheiden.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „Kennzahlen je Topf“): Aktie von 200 € auf 180 € → KZ 892 = 20 (angezeigt „20,00 €“).

**Frage:** Werden Verluste in FinanzOnline mit oder ohne Minuszeichen eingetragen?

**Antwort:**

### 1.7 · Vorauszahlungen nach der ersten Erklärung · Priorität A

**Derzeit:** Die App kennt keine Einkommensteuer-Vorauszahlungen. Das Soll deckt nur die Steuer der Jahre, die noch nicht als bezahlt markiert sind.

**Handrechnung:** Aus Testfall 6 (`test/ledger.test.ts`) ergibt sich für 2026 eine Steuer von 550 € (Soll 605 € mit 10 % Puffer). Setzt das Finanzamt mit dem Bescheid 2026 Vorauszahlungen für 2027 in ähnlicher Höhe fest, muss der Nutzer im Jahr 2027 beides zahlen. Die Rücklage würde dann zu niedrig angezeigt.

**Frage:** Schreibt das Finanzamt bei Kapitaleinkünften zum Sondersteuersatz Vorauszahlungen vor? Wenn ja, wie hoch, und ab wann?

**Antwort:**

### 1.8 · Kauf und Verkauf mit identischem Zeitstempel · Priorität C

**Derzeit:** Der Kauf wird zuerst verbucht, unabhängig von der Reihenfolge in der Datei.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „Kauf und Verkauf mit identischem Zeitstempel …“): Kauf 1 Stück zu 100 €, Verkauf zu 110 € in derselben Sekunde, ohne Bestand davor → +10 €.

**Handrechnung mit Bestand davor** (1 Stück zu 80 €): Kauf zuerst → Ø 90 €, Gewinn 20 €. Verkauf zuerst → Ø 80 €, Gewinn 30 €, die neue Position kostet dann 100 €.

**Frage:** Welche Reihenfolge gilt für den gleitenden Durchschnittspreis?

**Antwort:**

### 1.9 · Trade Republic: Umstellung auf steuereinfach · Priorität A

Trade Republic ist in Österreich seit 24.04.2025 steuereinfach, Bestandskunden erst nach Zustimmung in der App. Der Nutzer gibt den Tag der Umstellung an („steuereinfach seit“).

**Derzeit:**
- Ab diesem Tag gelten Verkäufe, Dividenden und Zinsen als endbesteuert. Sie zählen weder für die E1kv noch für die Rücklage und werden mit der einbehaltenen Steuer getrennt ausgewiesen.
- Davor wird ein Betrag in der Spalte `tax` nicht angerechnet, die App weist nur darauf hin.

**Beispiele aus den Tests** (`test/yearReport.test.ts`):
- „Verkauf vor der Umstellung zählt für die E1kv, Verkauf danach gilt als endbesteuert“: +20 € vor der Umstellung → KZ 994 = 20 €, Steuer 5,50 €. +30 € danach mit 8,25 € einbehaltener KESt → nur getrennt ausgewiesen.
- „Steuer in Spalte tax bei einem nicht steuereinfachen Konto wird nicht still übergangen“: 0,55 € einbehalten → nicht angerechnet, Hinweis.

**Fragen:**
1. Ist diese Trennung richtig?
2. **Verlustausgleich über Broker hinweg:** Endbesteuerte Gewinne bei Trade Republic und Verluste bei IBKR lassen sich über die Verlustausgleichsoption in der Veranlagung ausgleichen.
   - **Handrechnung:** 30 € Gewinn bei Trade Republic (8,25 € KESt), 30 € Verlust bei IBKR. Mit der Option wären die 8,25 € anrechenbar. Die App zeigt heute 30 € Verlust, „verfällt am Jahresende“.
   - Wie darf die App das darstellen, ohne zu beraten?
3. **Bestandskunden:** Kennt Trade Republic nach der Umstellung die Anschaffungskosten älterer Positionen? Laut broker-test.at nicht immer. Zu viel einbehaltene KESt wäre über die Veranlagung zurückzuholen. Die App zeigt beim endbesteuerten Verkauf ihren eigenen Gewinn neben der einbehaltenen Steuer, prüft aber nicht, ob beides zusammenpasst.

**Antwort:**

### 1.10 · Storno einer Dividende über den Jahreswechsel · Priorität C

**Derzeit:** Storno und ursprüngliche Buchung heben sich auf. Eine Neubuchung zählt im Jahr ihres Buchungsdatums, mit Hinweis.

**Beispiel aus den Tests** (`test/tradeRepublic.test.ts`, „Storno einer Ausschüttung aus dem Vorjahr wird verrechnet, aber gemeldet“): Dividende 29,58 € am 17.07.2025, Storno am 27.03.2026 → beide entfallen. Eine Neubuchung im März 2026 würde 2026 zählen.

**Frage:** Zählt die Neubuchung im Jahr des ursprünglichen Zuflusses (2025) oder der Neubuchung (2026)?

**Antwort:**

### 1.11 · „Capital Distribution“ bei Trade Republic · Priorität B

**Derzeit:** Buchungstyp `DIVIDEND_EQUIVALENT_PAYMENT` wird nicht berechnet. Danach rechnet die App auch Verkäufe dieser Position nicht mehr, weil die Anschaffungskosten unsicher sind.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „Kapitalausschüttung wird nicht berechnet …“): Kauf 10 Stück für 100 €, Capital Distribution 41,56 € (11,63 € einbehalten), Verkauf für 120 € → nichts berechnet, zwei Hinweise.

**Handrechnung, beide Auslegungen:**
- **Als Dividende:** KZ 863 = 41,56 €, Verkaufsgewinn 20 €. Steuer 27,5 % × 61,56 € = 16,93 € minus 15 % DBA-Norwegen auf 41,56 € (6,23 €) = 10,70 €.
- **Als Einlagenrückzahlung:** Anschaffungskosten sinken auf 58,44 €, Verkaufsgewinn 61,56 €, Steuer 16,93 €. Ob und wie die 11,63 € dann anrechenbar sind, ist offen.

**Antwort:**

### 1.12 · Quellensteuer aus Irland, Japan und dem Vereinigten Königreich · Priorität C

**Derzeit:** Für diese Länder ist kein DBA-Satz hinterlegt, die Quellensteuer wird nicht angerechnet (Hinweis an den Nutzer). Irland: DBA Art. 8, 15 % nur mit irischer Steuergutschrift. Japan: DBA BGBl. III Nr. 167/2018. Die durch das MLI geänderten Abkommensfassungen sind nicht geprüft.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „Land ohne hinterlegten DBA-Satz …“): Irische Dividende 100 €, 25 € einbehalten → KZ 998 = 0, Steuer **27,50 €** (eher zu hoch).

**Frage:** Welche Sätze sind für IE, JP und GB anrechenbar?

**Antwort:**

### 1.13 · Quellenstaat bei Hinterlegungsscheinen (ADR) · Priorität C

**Derzeit:** Als Quellenstaat gilt das Land der ISIN (`test/treaty.test.ts`, „die ersten zwei Buchstaben einer gültigen ISIN sind das Land“). Bei einem ADR mit US-ISIN auf eine Gesellschaft mit Sitz in einem anderen Land wird mit dem DBA-Satz der USA (15 %) gedeckelt.

**Frage:** Welches DBA gilt für ADRs und für Gesellschaften mit Sitz außerhalb des ISIN-Landes?

**Antwort:**

### 1.14 · Fremdwährung an einem Tag ohne EZB-Kurs · Priorität C

**Derzeit:** EStR 2000 Rz 6201c nennt den EZB-Referenzkurs im Zuflusszeitpunkt. Am Wochenende und an Feiertagen gibt es keinen. Die App rechnet die Buchung dann nicht und nimmt keinen Kurs vom Vortag.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „an einem Tag ohne EZB-Kurs …“): 100 USD Dividende am 16.04.2026, Kurse nur am 15.04. (1,25) und 17.04. (1,20) → nicht berechnet.

**Handrechnung:** mit dem Vortageskurs 80,00 €, mit dem Folgetageskurs 83,33 €.

**Frage:** Welcher Kurs gilt (Vortag, Folgetag, letzter verfügbarer)?

**Antwort:**

### 1.15 · Quellensteuer bei Dividenden in Fremdwährung (Trade Republic) · Priorität C

**Derzeit:** Trade Republic weist die einbehaltene Steuer nur in EUR aus. Die App rechnet sie mit dem Kurs von Trade Republic in die Originalwährung zurück und dann zum EZB-Kurs um. Annahme: derselbe Kurs wie für den Bruttobetrag.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „US-Dividende: Brutto und Quellensteuer zum EZB-Kurs, DBA-Deckel 15 %“):
- Brutto: 100 USD / 1,25 = 80 €.
- Quellensteuer: 13,50 € / 0,9 = 15 USD, das sind 15 USD / 1,25 = 12 €.
- Anrechenbar 12 € (15 % von 80 €), KESt 22 € − 12 € = **10 €**.

**Frage:** Ist dieser Weg zulässig?

**Antwort:**

### 1.16 · IBKR: Fremdwährung, Devisentausch und Ersatzzahlungen · Priorität B

**Derzeit:** Kauf und Verkauf in Fremdwährung rechnet die App zum EZB-Kurs am Handelstag um (kein tatsächlicher Umtausch, Rz 6201c erster Punkt). Ein Konto mit automatischem Umtausch erkennt sie nicht.

**Beispiel aus den Tests** (`test/yearReport.test.ts`, „Kauf und Verkauf in USD zum EZB-Kurs am Handelstag, Kommission nicht abziehbar“):
- Kauf 10 Stück für 1.000 USD / 1,25 = 800 € (Ø 80 €).
- Verkauf 4 Stück für 520 USD / 1,30 = 400 €, Anschaffungskosten 320 € → Gewinn **80 €**.

**Fragen:**
- a) Ist ein IBKR-Konto mit automatischem Umtausch in EUR eine „tatsächliche Konvertierung“ (Rz 6201c zweiter Punkt)?
- b) Devisentausch (`test/ibkrFlex.test.ts`, „Devisentausch wird als nicht berechnet gemeldet“): Wann ist er steuerpflichtig (Rz 6201 f., verzinstes Guthaben), und wie wird er gerechnet?
- c) Ersatzzahlungen für Dividenden aus der Wertpapierleihe („Payment In Lieu Of Dividends“, derzeit gemeldet, nicht berechnet): Wie werden sie behandelt, und gibt es Quellensteuer?

**Antwort:**

### 1.17 · Weitere Annahmen, bitte kurz bestätigen · Priorität B

Alle Beispiele stammen aus `test/yearReport.test.ts`, Beispieldatei `test/fixtures/tr-beispiel.csv`:

| Annahme | Beispiel |
| --- | --- |
| Optionsscheine, Turbos und Zertifikate bei Trade Republic sind verbriefte Derivate: 27,5 %, KZ 995/896 | Optionsschein 10 € → 15 € = KZ 995 5 €, Turbo 8 € → 5 € = KZ 896 3 € |
| Zinsen auf dem Verrechnungskonto von Trade Republic sind Zinsen aus Geldeinlagen bei Kreditinstituten: KZ 861, 25 % | 2 € Zinsen → 0,50 € Steuer, kein Ausgleich mit Verlusten |
| Krypto, die ins eigene Wallet übertragen wird, ist ein Übertrag ohne Gewinn | „Übertrag ins externe Wallet leert die Position ohne Gewinn“ |
| Ordergebühren mindern im 27,5 %-Topf nichts | 9 Trades zu je 1 € → 9 € ausgewiesen, nicht abgezogen |
| Fehlt ein Kauf vor dem Exportzeitraum, rechnet die App den Verkauf nicht und schätzt nichts | „Verkauf ohne bekannten Kauf … wird als nicht berechnet gemeldet“ |

**Antwort:**

### 1.18 · Frist der Steuererklärung (Erinnerung in der App) · Priorität C

**Derzeit:** Laut [BMF](https://www.bmf.gv.at/themen/steuern/fuer-unternehmen/einkommensteuer/einkommensteuererklaerungspflicht.html) gilt auf Papier der 30. April und über FinanzOnline der 30. Juni des Folgejahres (§ 134 Abs 1 BAO). Die App nennt das gesetzliche Datum, auch wenn es auf ein Wochenende fällt (dann endet die Frist laut § 108 Abs 3 BAO erst am nächsten Werktag). Ob eine Pflicht zur Erklärung besteht, prüft die App nicht.

**Beispiel aus den Tests** (`test/reminders.test.ts`, „in den letzten 30 Tagen vor dem 30. Juni als Warnung …“): am 31.05.2027 Warnung für die Erklärung 2026, am 01.07.2027 kein Hinweis mehr.

**Frage:** Reicht der Hinweis so? Soll die App auf die Erklärungspflicht bei ausländischen Kapitaleinkünften ohne KESt-Abzug hinweisen (laut BMF „grundsätzlich“)?

**Antwort:**

### 1.19 · DEGIRO: AutoFX und Guthabenzinsen (nachgetragen mit Schritt 3.2) · Priorität B

**Derzeit:**
- **Fremdwährung:** Mit AutoFX tauscht DEGIRO beim Handel tatsächlich in EUR. Dann zählt der EUR-Betrag aus dem Export (Rz 6201c, zweiter Punkt). Ohne AutoFX rechnet die App zum EZB-Kurs am Handelstag.
- **Zinsen:** Guthabenzinsen der flatexDEGIRO Bank zählen wie Zinsen aus Geldeinlagen bei Kreditinstituten, also KZ 861 mit 25 %.

**Beispiel aus den Tests** (`test/degiro.test.ts`, „Fremdwährung mit AutoFX …“):
- Kauf 10 Stück für 1.000 USD = 800 € laut Export, Verkauf 4 Stück für 520 USD = 400 € laut Export → Gewinn **80 €**.
- Im Test ohne AutoFX ergibt sich zum EZB-Kurs (1,25 bzw. 1,30) dasselbe. In der Praxis weichen DEGIRO-Kurs und EZB-Kurs leicht voneinander ab.

**Fragen:** Ist AutoFX eine tatsächliche Konvertierung? Gehören flatex-Guthabenzinsen in KZ 861?

**Antwort:**

---

## Teil 2 · Fragen an den Anwalt

### 2.1 · Grenze zwischen Berechnungstool und Steuerberatung · Priorität A

**Derzeit:** Die App rechnet, sie empfiehlt nichts. Strittige Steuerfragen sind Einstellungen mit Standardwert oder dokumentierte Annahmen. Hinweis in der App: „Berechnungstool, keine Steuer- oder Anlageberatung. Prüfe die Werte vor der Steuererklärung.“

**Texte mit Rechtsbezug, die geprüft werden sollten:**
- Einstellung „Optionen/Futures: Tarif · KZ 857 oder 27,5 % · KZ 995/896“ mit dem Tooltip „Offene Frage an den Steuerberater …“
- Erinnerung im November und Dezember (`src/reminders.ts`): „Verluste gleichen Gewinne nur im selben Kalenderjahr aus; ein Vortrag ins nächste Jahr ist nicht möglich. Stand 2026 bis heute (27,5 %): Überschüsse …, Verluste …. Nicht ausgeglichen: …, dieser Verlust verfällt am 31.12.2026.“ Ein Test stellt sicher, dass kein Text einen Verkauf oder eine Gestaltung empfiehlt.
- Fristhinweis: „Frist für die Steuererklärung 2026 mit Beilage E1kv: über FinanzOnline bis 30.06.2027, auf Papier bis 30.04.2027. Mit steuerlicher Vertretung gelten in der Regel längere Fristen; eine Verlängerung kann beantragt werden.“

**Fragen:** Wo genau liegt die Grenze? Welche Formulierungen braucht die App (Startseite, Bericht, Einstellungen)? Ist eine Einstellung mit Standardwert („Tarif“) bereits eine Empfehlung? Welche Haftung entsteht bei falschen Zahlen, und wie wird sie begrenzt?

**Antwort:**

### 2.2 · Kriterien-Check der Rücklage: Anlageberatung? · Priorität A

**Derzeit:** Der Nutzer wählt die Anlage selbst und gibt Anlageart, Meldefonds-Status und Risikoklasse (SRI laut Basisinformationsblatt) ein. Die App prüft nur diese Kriterien, warnt ab SRI 3 (Entscheidung Joshua), blockiert nichts und nennt nie ein Produkt.

**Beispiele aus den Tests** (`test/ledger.test.ts`, „Kriterien-Check der gewählten Anlage (warnt nur, empfiehlt nichts)“):
- „Geldmarktfonds als Meldefonds mit SRI 1: erfüllt“ → „Geldmarktfonds als Meldefonds mit niedriger Risikoklasse: geringes Kursrisiko, Erträge mit 27,5 % steuerpflichtig.“
- „Risikoklasse ab 3: Warnung“: kurzlaufende Staatsanleihen mit SRI 2 → erfüllt, mit SRI 3 → „Risikoklasse 3 laut Basisinformationsblatt: ab 3 kann der Wert zum Zahltag spürbar unter dem Soll liegen.“
- „Nicht-Meldefonds: Warnung wegen Pauschalbesteuerung“ → „Kein Meldefonds: Steuerpflichtig sind pauschal 90 % der Wertsteigerung, mindestens 10 % des Werts am 31.12. Das kann ein Vielfaches des tatsächlichen Ertrags sein.“
- Ein Test prüft, dass kein Text „empfehl“, „solltest“, „wähle“, „kaufe“ oder „nimm“ enthält.

**Frage:** Ist das noch keine „Abgabe persönlicher Empfehlungen“ im Sinne des WAG 2018? Sind die Texte „Erfüllt“ bei Tagesgeld und Geldmarktfonds zulässig, oder wirken sie wie eine Empfehlung dieser Anlagearten?

**Antwort:**

### 2.3 · Datenschutz der lokalen Speicherung · Priorität B

**Derzeit:** Alles liegt nur im Browser (IndexedDB), es gibt keinen Server. Gespeichert werden die vollständigen Exportdateien, bei Trade Republic auch Kartenzahlungen, Überweisungen, Namen und IBANs von Gegenparteien. Das Backup ist eine unverschlüsselte JSON-Datei, mit Hinweis in der App. Nach außen geht nur der Abruf der EZB-Kurse (Währung und Zeitraum).

**Fragen:**
- Sollen nur steuerrelevante Zeilen gespeichert werden (Datensparsamkeit)?
- Muss das Backup verschlüsselt werden?
- Welche Pflichten (Datenschutzerklärung, Impressum) hat eine Web-App, die nichts an einen Server sendet?

**Antwort:**

### 2.4 · Gewerbe · Priorität B

**Frage:** Deckt die bestehende Gewerbeberechtigung den Verkauf dieser App ab?

**Antwort:**

---

## Teil 3 · Für Joshua selbst (keine externe Frage)

- Preismodell: einmalig pro Steuerjahr wie DepotTax oder Abo, weil die App das ganze Jahr arbeitet?
- SnapTrade (Phase 4): Kosten pro Nutzer, und liefert es bei IBKR alle steuerrelevanten Details?
- Zielgruppe: Trade Republic ist seit 24.04.2025 steuereinfach. Die laufende Rücklage brauchen dort nur noch Nutzer ohne Umstellung oder die Zeit davor. PRODUKTPLAN und Zielgruppe nennen Trade Republic noch als „nicht steuereinfach“.

---

## Bekannte Lücken (keine Frage, zur Einordnung)

Diese Fälle rechnet die App bewusst noch nicht und meldet sie als „nicht berechnet“:
- ausschüttungsgleiche Erträge und Ausschüttungen von Fonds und ETFs (§ 186 InvFG 2011)
- Pauschalbesteuerung von Nicht-Meldefonds
- inländische Dividenden
- Anleihezinsen
- CFDs
- Altbestand (Krypto vor dem 1.3.2021, Wertpapiere vor dem 1.1.2011)

Für die Priorisierung in Phase 3 wäre die Einschätzung hilfreich, wie häufig diese Fälle bei der Zielgruppe sind.
