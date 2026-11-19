# KESt-Rücklage-App – Produktplan

Stand: 19.11.2026 · Export aus dem Produktplan-Doc (https://claude.ai/artifact/Pz2JTUN4Bq72zbGKMx254i). Bei Abweichungen gilt das Doc; diese Datei wird bei Änderungen neu exportiert.

## Produktidee

Eine App zum Herunterladen für alle in Österreich, die bei einem nicht steuereinfachen Broker wie IBKR, Trade Republic oder DEGIRO handeln. Sie rechnet nach jedem realisierten Gewinn die Steuer aus und zeigt, wie viel man zurücklegen muss. So ist das Geld da, wenn der Steuerbescheid kommt. Man braucht dazu weder Claude noch Fachwissen: Datei reinziehen, drei Fragen beantworten, fertig. Für Claude-Nutzer gibt es den Rechenkern zusätzlich als MCP-Server.

**Wichtigste Erkenntnis aus der Recherche:** Für Optionen und Futures bei IBKR sind 27,5 % nicht sicher. Das offizielle Formular E1kv führt nicht verbriefte Derivate ohne freiwilligen Steuerabzug in Kennzahl 857, und diese wird zum normalen Einkommensteuertarif besteuert, also bis 55 % ([BMF, E1kv 2024](https://formulare.bmf.gv.at/service/formulare/inter-Steuern/pdfs/2024/E1kv.pdf?open=download)). Der Steuersatz für die Rücklage muss deshalb einstellbar und eher vorsichtig angesetzt sein.

**Wettbewerb:** Für die jährliche E1kv gibt es bereits Tools. Keines davon bildet laufend eine Rücklage.

| Tool | Was es macht | Preis |
| --- | --- | --- |
| [DepotTax](https://blog.depottax.at/posts/e1kv-ausfuellen-ibkr/) | Liest die IBKR Flex Query, erstellt E1kv-Kennzahlen, PDF und Excel | ab 99 € pro Steuerjahr (Anbieterangabe) |
| [Tax-Wizard](https://tax-wizard.eu/en/p/austria-tax) | Excel-Berichte für die E1/E1kv, viele Broker inkl. IBKR | 25 € (Premium) |
| [KestKlar](https://kestklar.at/ratgeber/scalable-capital-steuer-oesterreich) | PDF-Upload, E1kv-Werte über mehrere Broker | Warteliste, kein Preis genannt |

**Alleinstellungsmerkmal:** Die anderen sagen dir einmal im Jahr, was du schuldest. Diese App sorgt **das ganze Jahr** dafür, dass das Geld dann auch da ist. Dazu kommt ein Verkaufs-Simulator („Was kostet mich dieser Verkauf steuerlich?“). Die App gibt keinerlei Steuer- oder Anlageberatung: Sie rechnet, der Nutzer entscheidet.

## Steuerliche Grundlagen Österreich

Der Rechner ordnet jede Transaktion einem Steuertopf und einer E1kv-Kennzahl zu. Wie viel Steuer fällig wird, hängt vom Topf ab, nicht vom Broker. Die Tabelle zeigt die Kennzahlen für **ausländische** Kapitaleinkünfte laut [Formular E1kv 2024](https://formulare.bmf.gv.at/service/formulare/inter-Steuern/pdfs/2024/E1kv.pdf?open=download).

| Einkunftsart | Steuersatz | KZ Überschuss | KZ Verlust |
| --- | --- | --- | --- |
| Dividenden, Zinsen aus Wertpapieren | 27,5 % | 863 | – |
| Kursgewinne Aktien, ETFs, Anleihen | 27,5 % | 994 | 892 |
| Verbriefte Derivate (Optionsscheine, Zertifikate) | 27,5 % | 995 | 896 |
| Nicht verbriefte Derivate (Optionen, Futures, CFDs) ohne freiwilligen KESt-Abzug | Tarif, 0–55 % | 857 | in 857 saldiert |
| Fonds: Ausschüttungen / ausschüttungsgleiche Erträge (AgE) | 27,5 % | 898 / 937 | – |
| Krypto: laufend / Kursgewinne | 27,5 % | 172 / 174 | 176 |
| Zinsen aus Bankeinlagen | 25 % | 861 | – |
| Anrechenbare Quellensteuer (27,5 %-Einkünfte) | – | 998 | – |

**Regeln, die die Engine abbilden muss:**

- **Anschaffungskosten:** gleitender Durchschnittspreis in Euro, je ISIN und Depot, neu berechnet bei jedem Kauf. FIFO ist nicht erlaubt ([Tax-Wizard](https://tax-wizard.eu/en/p/austria-tax)).
- **Spesen:** Im 27,5 %-Topf gehören Spesen nicht zu den Anschaffungskosten. Bei tarifbesteuerten Derivaten sind Spesen laut Tax-Wizard abziehbar.
- **Fremdwährung:** Umrechnung zum Kurs am Buchungstag, nicht zum Jahresendkurs ([DepotTax](https://blog.depottax.at/posts/e1kv-ausfuellen-ibkr/), mit Verweis auf EStR Rz 6121). Tax-Wizard nennt den EZB-Referenzkurs am Transaktionstag.
- **Verlustausgleich:** nur im selben Kalenderjahr, kein Verlustvortrag ([teamzlab](https://tool.teamzlab.com/at/wertpapier-kest-verlustverrechnung/)). Verluste im 27,5 %-Topf dürfen auch Dividenden ausgleichen. Dann sinkt die anrechenbare Quellensteuer, das sieht die [Verordnung im RIS](https://ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2024_II_213/Anlagen_0001_1D1713EE_8B63_43C3_8189_BEC5402B7F4D.html) ausdrücklich vor. Bankzinsen (25 %) sind ein eigener Topf. Verluste aus KZ 857 gleichen nur andere Tarif-Kapitaleinkünfte aus.
- **Quellensteuer:** anrechenbar höchstens bis zum DBA-Satz, bei US-Dividenden mit W-8BEN 15 %. Was darüber liegt, muss man im Quellenstaat zurückholen.
- **Stillhaltergeschäfte:** Verfällt die Option, ist die Prämie der Ertrag. Beim Glattstellen gilt die Prämie als Veräußerungserlös ([§ 27a EStG](https://www.jusline.at/gesetz/estg/paragraf/27a.pdf)). Der Zeitpunkt der Besteuerung ist der Verfall bzw. die Glattstellung, nicht der Zufluss der Prämie (Tax-Wizard).
- **AgE bei thesaurierenden Fonds:** Die Werte kommen von der OeKB. Sie erhöhen die Anschaffungskosten, sonst zahlt man beim Verkauf doppelt ([KestKlar](https://kestklar.at/ratgeber/scalable-capital-steuer-oesterreich)).

**Tarif 2026 für KZ 857:** 0 % bis 13.539 €, 20 % bis 21.992 €, 30 % bis 36.458 €, 40 % bis 70.365 €, 48 % bis 104.859 €, 50 % bis 1 Mio. €, darüber 55 % ([BMF](https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html), [WKO](https://www.wko.at/oe/steuern/einkommen-koerperschaftsteuer-2026)). Der Grenzsteuersatz hängt vom **gesamten** Einkommen ab, also auch von betrieblichen Einkünften. Die App fragt deshalb nach einer Schätzung des sonstigen Jahreseinkommens, aber nur, wenn jemand Optionen oder Futures handelt.

## Datenanbindung in drei Stufen

Version 1 kommt ohne jede Schnittstelle aus: Der Nutzer zieht eine Exportdatei seines Brokers in die App. Der Knopf „Mit Broker verbinden“ folgt in zwei späteren Stufen.

| Stufe | Wie die Daten kommen | Broker | Was zu klären ist |
| --- | --- | --- | --- |
| 1 · Datei-Import | Export herunterladen und in die App ziehen. Ein Assistent zeigt, wo der Export zu finden ist | IBKR (Flex Query als XML), Trade Republic, DEGIRO, Flatex u. a. (CSV/PDF) | Formate je Broker, Prüfung auf fehlende Abschnitte |
| 2 · Broker-Verbindung über SnapTrade | Einmal anmelden, danach automatischer Abgleich, nur lesend | laut [SnapTrade](https://docs.snaptrade.com/docs/broker-access-guide): Interactive Brokers, DEGIRO, eToro, Trading212. Trade Republic fehlt | Kosten, Datenschutz (US-Dienstleister), ob alle Steuerdetails ankommen. Bei IBKR nutzt SnapTrade selbst die [Flex Query](https://snaptrade.com/brokerage-integrations/ibkr-api) |
| 3 · Eigene IBKR-Freigabe | OAuth direkt bei IBKR | IBKR | [Compliance-Freigabe](https://www.interactivebrokers.com/docs/web-api/authentication/oauth-1a/third-party-oauth/registration-process) nötig, nur mit fertiger Plattform oder vollständigem Machbarkeitsnachweis, Prüfung etwa 3–6 Wochen |

**Trade Republic** wird nur per Datei unterstützt. Die inoffizielle Schnittstelle pytr baut die private API nach und ist in einem öffentlichen Produkt wegen der AGB zu riskant ([glama.ai](https://glama.ai/mcp/servers/mwxga7ndfr)).

**Referenzdaten:** EZB-Tageskurse für die Euro-Umrechnung, OeKB-Meldungen für ausschüttungsgleiche Erträge. Beides holt die App selbst.

## Einrichtung in zwei Minuten

Vom Öffnen der App bis zum ersten Ergebnis sollen rund zwei Minuten vergehen, ohne Konto und ohne Registrierung.

1. **Broker wählen:** ein Logo antippen.
2. **Export holen:** Ein Assistent zeigt in fünf Schritten mit Screenshots den Weg im Broker-Portal. Bei IBKR legt man einmalig eine Flex Query an. Die App liefert dafür eine Checkliste der nötigen Abschnitte.
3. **Datei reinziehen:** Die App prüft sofort und sagt konkret, was fehlt, etwa „Abschnitt CashTransactions fehlt“.
4. **Drei Fragen beantworten:**
    - Handelst du Optionen oder Futures? Nur bei Ja folgt die Frage nach dem geschätzten sonstigen Einkommen.
    - Wo liegt deine Rücklage? Freie Eingabe, keine Empfehlung.
    - Wie groß soll der Sicherheitspuffer sein? Ein Standardwert ist vorbelegt.
5. **Ergebnis sehen:** Steuer seit Jahresbeginn, Soll-Rücklage, offene Klärungsfälle.

Danach erinnert die App einmal im Monat an einen neuen Export. Ab Stufe 2 läuft der Abgleich automatisch.

**Regeln für die Oberfläche:**

- Jede Zahl lässt sich antippen und zeigt, woraus sie entstanden ist: Buchungen, Kurs, Regel.
- Unsicheres wird markiert und nie still entschieden.
- Fachbegriffe stehen nie ohne Erklärung in einem Satz Klartext.

## Architektur

Der Rechenkern ist eine Kette aus fünf Stufen und läuft vollständig im Browser des Nutzers. In Version 1 verlassen keine Steuerdaten das Gerät.

```
Quellen:  Datei-Import (IBKR, Trade Republic u. a.)
          Broker-Verbindung (ab Stufe 2, über SnapTrade)
          Referenzdaten (EZB-Kurse, OeKB-AgE-Daten)
             │
             ▼
┌─ Rechenkern (TypeScript, läuft lokal im Browser) ─────────────────────────┐
│  1. Normalisierer ............ einheitliches Format, EUR zum Buchungstag  │
│  2. Durchschnittspreis-Engine  gleitender Ø-Preis je ISIN und Depot       │
│  3. Klassifizierer ........... Topf + Kennzahl je Buchung, Unklares → Nutzer│
│  4. Steuer-Engine ............ Saldo je Topf, Verlustausgleich, QSt, Tarif │
│  5. Rücklagen-Ledger ......... Soll vs. Ist, Freigabe erst nach dem 31.12.│
│                                                                            │
│  App-Oberfläche (Übersicht, Rücklage, Bericht) greift auf alle Stufen zu   │
└────────────────────────────────────────────────────────────────────────────┘
             │                         │                         │
             ▼                         ▼                         ▼
   MCP-Add-on (optional,      Erinnerungen (monatlich,     Nutzer (sieht,
   für Claude-Nutzer)         Push ab Stufe 2)             wählt, überweist)
```

Derselbe Rechenkern steckt in der App und im optionalen MCP-Add-on. Eine Steuerregel wird also nur einmal programmiert und getestet.

**Technik:** Rechenkern in TypeScript, App als installierbare Web-App (PWA), Daten lokal im Browser-Speicher mit Export-Funktion als Backup. Version 1 braucht keinen eigenen Server, nur statisches Hosting. Ab Stufe 2 kommt ein kleiner Server für SnapTrade und Push-Nachrichten dazu. Das MCP-Add-on nutzt das offizielle TypeScript-SDK.

**Datenmodell, sechs Tabellen:**

- `transactions`: Broker, Datum, ISIN, Art, Stück, Preis, Währung, EUR-Kurs, EUR-Betrag, Gebühren, Quelldatei
- `positions`: ISIN, Depot, Stück, Anschaffungskosten in EUR (gleitend)
- `classifications`: Transaktion, Topf, Kennzahl, Regelversion, bestätigt ja/nein
- `tax_runs`: Jahr, Regelversion, Ergebnis je Kennzahl, Zeitstempel
- `reserve_ledger`: Datum, Soll, Ist, Ort des Geldes, Notiz
- `config`: sonstiges Einkommen, Behandlung der Derivate, Puffer

## Funktionen

Jede Funktion der App gibt es auch als Tool im MCP-Add-on. Alle Funktionen rechnen oder lesen nur, keine bewegt Geld oder gibt eine Empfehlung.

| Funktion | Was der Nutzer sieht | Tool im MCP-Add-on |
| --- | --- | --- |
| Import | Datei reinziehen, sofortige Prüfung mit Hinweis, was fehlt | `import_file` |
| Broker-Verbindung (ab Stufe 2) | automatischer Abgleich | `import_ibkr_flex` |
| Übersicht | Gewinne, Verluste und Steuer je Topf seit Jahresbeginn | `compute_tax_ytd` |
| Rücklage | Soll, Ist zum Marktwert, Fehlbetrag | `get_reserve_status` |
| Rücklage eintragen | zurückgelegten Betrag und Ort erfassen | `book_reserve` |
| Verkaufs-Simulator | Was kostet dieser Verkauf steuerlich? | `simulate_sale` |
| Kauf-Check | Reicht das freie Geld nach Abzug der Rücklage? | `check_order_against_reserve` |
| Klärungsfälle | unklare Buchungen zur Bestätigung, z. B. Option: KZ 857 oder 995? | `review_classification` |
| Positionen | Durchschnittspreis je Wertpapier mit Historie | `get_cost_basis` |
| Buchungen | alle Transaktionen in EUR inkl. Kurs | `list_transactions` |
| E1kv-Bericht | Kennzahlen und Belegliste als PDF/CSV | `generate_e1kv_report` |
| Einstellungen | Derivate-Behandlung, sonstiges Einkommen, Puffer | `set_config` |

Jede Berechnung speichert, mit welcher Regelversion sie entstanden ist. Die Steuerregeln je Jahr (Tarifgrenzen, Kennzahlen) liegen als versionierte Datei vor und werden mit App-Updates ausgeliefert.

## Rücklage beiseitelegen

Die App rechnet die Rücklage aus und erinnert daran. Das Geld bewegt immer der Nutzer selbst, und welche Anlage er wählt, entscheidet er allein. Die App gibt keine Anlageempfehlung.

**So rechnet die App die Soll-Rücklage:**

```latex
R_{soll} = \left( \sum_{Topf} \max(0,\ Saldo_{Topf}) \cdot Satz_{Topf} - QSt_{anrechenbar} \right) + \Big( ESt(E_{sonst} + E_{857}) - ESt(E_{sonst}) \Big) + Puffer
```

Der erste Teil deckt die Töpfe mit festem Satz ab (27,5 % und 25 %). Der zweite Teil ist der Mehrbetrag an Einkommensteuer durch tarifbesteuerte Derivate. Der Puffer ist ein Sicherheitsaufschlag, den der Nutzer einstellt. Die Rücklage wird erst nach dem 31.12. freigegeben, weil spätere Verluste im Jahr die Steuer noch senken können.

| Variante | So funktioniert es | Automatisch? | Bewertung |
| --- | --- | --- | --- |
| 1. Virtuelle Rücklage | Die App führt ein Konto „Soll vs. Ist“ und zeigt Fehlbeträge an | ja, nur Rechnung | die Basis für alles andere |
| 2. Kauf-Check | Vor einem Kauf zeigt die App, ob das freie Geld nach Abzug der Rücklage reicht | ja, als Hinweis | verhindert das versehentliche Verbrauchen |
| 3. Angelegte Rücklage | Der Nutzer legt die Rücklage selbst an, wo und wie er will. Die App prüft nur Kriterien (Regeln unten) | nein | gewählt: Das Geld verliert nicht an Wert. Die Erträge sind selbst steuerpflichtig |
| 4. Eigenes Steuerkonto | Monatliche Erinnerung mit dem Betrag, der Nutzer überweist | nein, Erinnerung | geht in Variante 3 auf |

**Gewählt:** Variante 1 und 2 von Anfang an, dazu Variante 3: Der Nutzer legt das Geld selbst an, die App erinnert monatlich und rechnet mit. Variante 4 geht darin auf.

### Angelegte Rücklage: Regeln

Die App erklärt diese Kriterien allgemein und prüft die Wahl des Nutzers dagegen. Sie nennt kein Produkt. Der Grund für die Kriterien: Das Geld muss zum Zahltag sicher wieder da sein, und ein Aktien-ETF kann genau dann deutlich im Minus stehen.

| Anlageart | Risiko | Steuer auf den Ertrag | Kriterien-Check der App |
| --- | --- | --- | --- |
| Tagesgeld bei einer österreichischen Bank | praktisch keins, Einlagensicherung | 25 %, die Bank zieht sie automatisch ab ([finanzinfo.at](https://finanzinfo.at/steuern/kapitalertragsteuer/)) | erfüllt |
| Geldmarkt-ETF, österreichischer Meldefonds | sehr gering, folgt dem EZB-Zins | 27,5 % | erfüllt |
| Kurzlaufende Staatsanleihen | gering | 27,5 % | erfüllt |
| Aktien-ETF oder Anleihen-ETF mit langer Laufzeit | hoch | 27,5 % | Warnung |
| Jeder Nicht-Meldefonds | – | pauschal: 90 % der Wertsteigerung, mindestens 10 % des Werts am 31.12. ([broker-test.at](https://www.broker-test.at/steuern/etf-steuern/)) | Warnung |

Der Meldefonds-Status ist bei einem Geldmarkt-ETF entscheidend. Als Nicht-Meldefonds würde mindestens 10 % seines Werts besteuert, ein Vielfaches des echten Zinsertrags. Ob ein ETF Meldefonds ist, steht in der OeKB-Datenbank unter my.oekb.at.

**Ort der Rücklage:** wählt der Nutzer. Die App erklärt nur allgemein: Bei einem steuereinfachen österreichischen Institut wird die Steuer auf die Rücklagen-Erträge automatisch abgezogen, bei einem ausländischen Broker gehört sie wieder in die E1kv.

**Was die App dafür braucht:**

- **Kriterien-Check statt Whitelist:** Zur gewählten Anlage zeigt die App, ob sie Meldefonds ist und welche Risikoklasse das Basisinformationsblatt nennt. Sie warnt, blockiert aber nichts und empfiehlt nichts.
- **Marktwert statt Einzahlung:** `get_reserve_status` vergleicht den aktuellen Wert der Rücklage mit dem Soll und meldet einen Fehlbetrag.
- **Verkaufs-Erinnerung:** Sobald der Nutzer den Steuerbescheid einträgt, erinnert die App an den Verkauf. Steuerpflichtig ist dann nur der kleine Zinsgewinn.
- **Puffer:** Der Sicherheitsaufschlag deckt auch die Steuer auf die Rücklagen-Erträge.

## Recht, Datenschutz & Grenzen

Die App ist ein Berechnungstool: Sie rechnet, der Nutzer entscheidet. Das muss in Texten, Oberfläche und AGB durchgehend so bleiben. Vor dem Start sollte ein Anwalt die Positionierung prüfen.

- **Keine Steuerberatung:** Positionierung als Rechenhilfe, wie bei [KestKlar](https://kestklar.at/ratgeber/scalable-capital-steuer-oesterreich) („Nur ein Berechnungstool“). Strittige Punkte wie Optionen (KZ 857 oder 995) und Broker-Zinsen (KZ 861 oder 863) sind Einstellungen mit Erklärung und werden nie still entschieden.
- **Keine Anlageberatung:** Anlageberatung braucht eine [FMA-Konzession nach WAG 2018](https://gesetzefinden.at/bundesrecht/bundesgesetze/wag-2018). Gemeint ist laut [WKO](https://news.wko.at/oe/information-consulting/finanzdienstleister/artikel-wertpapiervermittler.pdf) „die Abgabe persönlicher Empfehlungen“. Deshalb nennt die App kein Produkt und prüft nur Kriterien der Nutzerwahl.
- **Datenschutz:** Version 1 rechnet lokal, Steuerdaten liegen auf keinem Server. Ab Stufe 2 (SnapTrade, Push) braucht es Auftragsverarbeitungsverträge und eine Datenschutzerklärung nach DSGVO.
- **Haftung:** Haftungsausschluss, ein sichtbarer Hinweis vor jedem E1kv-Bericht und die Regelversion im Bericht.
- **Unternehmen:** Für den Verkauf braucht es Impressum, AGB und eine passende Gewerbeberechtigung. Zu prüfen ist, ob die bestehende Berechtigung für das KI- und Web-Business das abdeckt.
- **Nicht in Version 1:** Wegzug aus Österreich, Depotüberträge zwischen Brokern, Kapitalmaßnahmen wie Splits und Spin-offs, AgE ohne OeKB-Daten. Solche Fälle zeigt die App als „nicht berechnet“ an, statt zu schätzen.

## Roadmap

Fünf Phasen, jede endet mit einem Gate. Nutzer bekommen die App erst, wenn die Zahlen nachweislich stimmen und die rechtliche Positionierung geprüft ist.

| Phase | Inhalt | Gate danach |
| --- | --- | --- |
| 1 · Rechenkern | TypeScript-Engine, IBKR-Flex-Import, EZB-Kurse, gleitender Durchschnittspreis; Aktien, ETFs, Dividenden, Quellensteuer (KZ 994, 892, 863, 998); Test: Steuerjahr 2025 mit eigenen Daten nachrechnen | Jahr 2025 deckt sich mit DepotTax/Tax-Wizard |
| 2 · Derivate und Rücklage | Optionen, Futures, Stillhaltergeschäfte, Tarif-Schätzung für KZ 857; Rücklagen-Ledger mit Soll-Formel, Puffer und Kriterien-Check; Test: die Fälle unten | **Steuerberater und Anwalt geben grünes Licht** |
| 3 · Web-App Version 1 | Einrichtungsassistent, Datei-Import für IBKR, Trade Republic und DEGIRO; Übersicht, Rücklage, Verkaufs-Simulator, E1kv-Bericht; monatliche Erinnerung | Testgruppe schafft die Einrichtung ohne Hilfe |
| 4 · Broker-Verbindung (Stufe 2) | SnapTrade für IBKR, DEGIRO, Trading212, automatischer Abgleich; Push-Nachrichten, kleiner Server in der EU; Datenschutz-Unterlagen | SnapTrade-Kosten passen zum Preis der App |
| 5 · Eigene IBKR-Freigabe und MCP-Add-on | OAuth-Antrag bei IBKR mit der laufenden App als Nachweis; MCP-Add-on auf demselben Rechenkern; weitere Broker je nach Nachfrage | – |

Das wichtigste Gate liegt vor der App: Ob Optionen mit 27,5 % oder bis 55 % besteuert werden, verändert die Rücklage am stärksten. Und ohne geprüfte Positionierung als Berechnungstool sollte nichts an fremde Nutzer gehen.

**Testfälle, von Hand gerechnet, als feste Prüfdateien:**

1. Drei Käufe zu verschiedenen Kursen, dann ein Teilverkauf: Stimmt der gleitende Durchschnittspreis?
2. US-Aktie in USD gekauft und verkauft, mit unterschiedlichen EUR-Kursen an beiden Tagen.
3. US-Dividende mit 15 % Quellensteuer und im selben Jahr ein Kursverlust: Sinkt die anrechenbare Quellensteuer richtig?
4. Stillhaltergeschäfte: Short Put verfällt wertlos, Short Call wird glattgestellt, Put wird ausgeübt.
5. Option, die über den Jahreswechsel offen bleibt.
6. Großer Verlust im Dezember: Die Rücklage wird erst nach dem 31.12. freigegeben.

## Offene Fragen an Steuerberater

Vor Phase 2 sollten diese Punkte mit einem Steuerberater geklärt sein. Jede Antwort wird zu einer festen Regel oder einer erklärten Einstellung in der App.

- [ ] Optionen und Futures bei IBKR: KZ 857 zum Tarif oder KZ 995 mit 27,5 %? DepotTax ordnet sie 995 zu, laut BMF-Formular und Tax-Wizard gehören sie ohne freiwilligen Abzug in 857.
- [ ] Broker-Zinsen bei IBKR: KZ 861 (25 %) oder 863 (27,5 %)?
- [ ] Verlustausgleich mit Dividenden: Mehrere Ratgeber widersprechen sich. In welcher Reihenfolge wird verrechnet, und wie stark sinkt die anrechenbare Quellensteuer?
- [ ] Vorauszahlungen: Schreibt das Finanzamt nach der ersten Erklärung Einkommensteuer-Vorauszahlungen vor? Dann muss die Rücklage auch die abdecken.
- [ ] Wie schätzt man das sonstige Einkommen unterjährig am besten, damit der Grenzsteuersatz für KZ 857 stimmt?

**Für das Produkt, an Anwalt und Joshua selbst:**

- [ ] Wo genau liegt die Grenze zwischen Berechnungstool und Steuerberatung, und welche Formulierungen braucht die App?
- [ ] Reicht der Kriterien-Check für die Rücklage, ohne als Anlageberatung zu gelten?
- [ ] Welches Preismodell: einmalig pro Steuerjahr wie DepotTax, oder ein Abo, weil die App das ganze Jahr arbeitet?
- [ ] Was kostet SnapTrade pro Nutzer, und liefert es bei IBKR alle steuerrelevanten Details?
- [ ] Deckt die bestehende Gewerbeberechtigung den Verkauf einer App ab?

## Quellen

- [BMF: Formular E1kv 2024](https://formulare.bmf.gv.at/service/formulare/inter-Steuern/pdfs/2024/E1kv.pdf?open=download)
- [BMF: Steuertarif 2026](https://www.bmf.gv.at/themen/steuern/arbeitnehmerveranlagung/steuertarif-steuerabsetzbetraege/steuertarif-steuerabsetzbetraege.html)
- [WKO: Einkommensteuer 2026](https://www.wko.at/oe/steuern/einkommen-koerperschaftsteuer-2026)
- [RIS: Anlage zur Verordnung BGBl. II 213/2024](https://ris.bka.gv.at/Dokumente/BgblAuth/BGBLA_2024_II_213/Anlagen_0001_1D1713EE_8B63_43C3_8189_BEC5402B7F4D.html)
- [jusline: § 27a EStG](https://www.jusline.at/gesetz/estg/paragraf/27a.pdf)
- [KPMG: Sondersteuersatz für im Ausland abgewickelte nicht verbriefte Derivate](https://kpmg.com/at/de/media/newsletter/tax-news/2022/06/tn-anwendung-des-besonderen-steuersatzes-auch-fuer-im-ausland-abgewickelte-einkuenfte-aus-nicht-verbrieften-derivaten.html)
- [DepotTax: E1kv ausfüllen für IBKR-User](https://blog.depottax.at/posts/e1kv-ausfuellen-ibkr/)
- [Tax-Wizard: Austria Tax Guide 2026](https://tax-wizard.eu/en/p/austria-tax)
- [KestKlar: Scalable Capital Steuer Österreich](https://kestklar.at/ratgeber/scalable-capital-steuer-oesterreich)
- [IBKR: Flex Web Service](https://www.interactivebrokers.com/campus/ibkr-api-page/flex-web-service)
- [IBKR: SendRequest-Referenz](https://www.interactivebrokers.com/docs/web-api/api-reference/send-request.md)
- [pytr auf GitHub](https://github.com/ptrstn/pytr)
- [SnapTrade: Broker Access Guide](https://docs.snaptrade.com/docs/broker-access-guide)
- [SnapTrade: Interactive-Brokers-Integration](https://snaptrade.com/brokerage-integrations/ibkr-api)
- [IBKR: Registrierung für Drittanbieter (OAuth)](https://www.interactivebrokers.com/docs/web-api/authentication/oauth-1a/third-party-oauth/registration-process)
- [gesetzefinden.at: WAG 2018](https://gesetzefinden.at/bundesrecht/bundesgesetze/wag-2018)
- [WKO: Wertpapiervermittler und Anlageberatung](https://news.wko.at/oe/information-consulting/finanzdienstleister/artikel-wertpapiervermittler.pdf)
- [broker-test.at: ETF-Steuern und Nicht-Meldefonds](https://www.broker-test.at/steuern/etf-steuern/)
- [finanzinfo.at: KESt Österreich 2026](https://finanzinfo.at/steuern/kapitalertragsteuer/)
- [glama.ai: traderepublic-mcp](https://glama.ai/mcp/servers/mwxga7ndfr)
