# Regeln für dieses Repository

Zuerst `docs/HANDOFF.md` lesen: Produkt, Steuerregeln, offene Fragen und Stand.

- **Sprache:** Oberfläche, Fehlermeldungen, Doku und Testnamen auf Deutsch. Code-Bezeichner auf Englisch.
- **Geld nur mit `decimal.js`** über `src/decimal.ts` (`dec`, `D`). Nie `number` für Beträge, Kurse oder Stückzahlen. Gerundet wird erst im Bericht.
- **Testgetrieben:** Erst der Test (Rot), dann der Code (Grün). Jede Steuerregel hat einen von Hand nachgerechneten Testfall mit Quellenangabe im Kommentar, wo es eine gibt.
- **Nie still schätzen:** Fehlt ein Wechselkurs, ein Bestand oder eine Regel, wird ein Fehler geworfen oder der Fall als „nicht berechnet“ markiert.
- **Strittige Steuerfragen** sind Einstellungen oder dokumentierte Annahmen (README, Abschnitt „Annahmen“), keine versteckten Entscheidungen.
- **Keine Beratung:** Kein Text darf eine konkrete Anlage oder Steuergestaltung empfehlen. Die App rechnet, der Nutzer entscheidet.
- **Echte Broker-Daten** liegen nur in `data/private/` und werden nie committet.
- Vor jedem Commit: `npm test` und `npm run typecheck` müssen grün sein.
