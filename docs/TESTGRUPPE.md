# Testanleitung für die Testgruppe (Gate 3)

Ziel laut PRODUKTPLAN: **Die Testgruppe schafft die Einrichtung ohne Hilfe**, vom Öffnen der App bis zum ersten Ergebnis in etwa zwei Minuten. Joshua führt den Test durch.

## Vorbereitung (Joshua)

1. App bereitstellen: `npm run build:web` und dann
   - entweder `dist/pwa/` statisch hosten (siehe `docs/HOSTING.md`)
   - oder `dist/kest-app.html` als Datei bzw. Artefakt weitergeben.
2. Testpersonen: 5 bis 8 Personen mit Wohnsitz in Österreich und einem Depot bei Trade Republic, IBKR oder DEGIRO. Idealerweise ist pro Broker mindestens eine Person dabei, und mindestens eine handelt Optionen oder Futures.
3. Jede Person nutzt **ihre eigenen Daten auf ihrem eigenen Gerät**. Die Daten bleiben im Browser, niemand schickt Exporte an Joshua.
4. Hinweis an alle vorab: Die App ist ein Berechnungstool und keine Steuerberatung. Die Zahlen sind ungeprüft und dienen nur dem Test.

## Ablauf je Person (etwa 15 Minuten)

Die Testperson arbeitet allein. Joshua schaut zu (vor Ort oder per Bildschirmfreigabe), hilft nicht und notiert.

| Nr. | Aufgabe | Erfolg, wenn … |
| --- | --- | --- |
| 1 | App öffnen und die Einrichtung durchlaufen | der Assistent ohne Rückfrage bis „Ergebnis zeigen“ kommt |
| 2 | Export beim eigenen Broker holen und hineinziehen | die Sofortprüfung „Gespeichert“ zeigt (oder klar sagt, was fehlt) |
| 3 | Die drei Fragen beantworten | die Soll-Rücklage angezeigt wird |
| 4 | Sagen, wie viel man zurücklegen soll und warum | die Person die Zahl und den Satz darunter erklären kann |
| 5 | Einen Stand der Rücklage eintragen | Ist, Fehlbetrag oder Überschuss erscheinen |
| 6 | Einen Verkauf im Simulator durchrechnen | die Person die Steueränderung findet |
| 7 | Den E1kv-Bericht als PDF speichern | die Datei geöffnet werden kann |
| 8 | Ein Backup speichern | die Datei gespeichert ist |

**Zeit messen:** vom Öffnen der App bis zur angezeigten Soll-Rücklage (Aufgaben 1 bis 3), ohne die Zeit beim Broker für den Export.

## Was Joshua notiert

- Zeit für die Aufgaben 1 bis 3 und ob es ohne Hilfe ging
- Stellen, an denen die Person zögert, nachfragt oder etwas Falsches anklickt
- Begriffe, die unklar waren, z. B. Soll, Ist, KZ, Meldefonds, Puffer
- Meldungen der Sofortprüfung und des Prüfassistenten: verständlich, und war klar, was zu tun ist?
- Ob die Person meint, die App empfehle etwas. Das darf nicht passieren.

## Kurzer Fragebogen am Ende (1 = gar nicht, 5 = voll)

1. Die Einrichtung war einfach.
2. Ich verstehe, wie viel ich zurücklegen soll und warum.
3. Ich vertraue den Zahlen so weit, dass ich sie mit meinem Steuerberater oder meiner Erklärung vergleichen würde.
4. Ich würde die App das ganze Jahr nutzen.
5. Offen: Was hat gefehlt? Was war verwirrend?

## Auswertung und Gate

- **Bestanden**, wenn mindestens 4 von 5 Personen die Aufgaben 1 bis 3 ohne Hilfe schaffen und der Median unter etwa 3 Minuten liegt.
- Auffälligkeiten als Liste in `docs/HANDOFF.md` unter „Offene Fragen“ eintragen. Danach entscheidet Joshua über die nächsten Schritte (Phase 4).

## Bekannte Grenzen, die die Testgruppe kennen sollte

- Bei einigen Exporten erscheinen Hinweise unter „Nicht berechnet“: Fonds und ETFs (ausschüttungsgleiche Erträge), Altbestand vor 2011 bzw. bei Krypto vor dem 1.3.2021, Optionen bei DEGIRO.
- Die Screenshots in der Anleitung zum Export fehlen noch (Platzhalter).
- Die Steuerfragen in `docs/FRAGEN-STEUERBERATER-ANWALT.md` sind noch offen. Die App rechnet bei strittigen Punkten mit einer Einstellung, z. B. Optionen zum Tarif.
