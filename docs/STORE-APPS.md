# Store-Apps für Android und iOS (Schritt 6.1)

Auf Joshuas Wunsch (22.11.2026): die KESt-Rücklage als „echte“ App im Google Play Store und im Apple App Store.
Technik: [Capacitor](https://capacitorjs.com/docs) 8.6 verpackt dieselbe Web-App, die auch als PWA läuft. Rechenkern,
Oberfläche und Tests bleiben gleich; es gibt keinen Server und kein Konto, die Daten bleiben auf dem Gerät.

## Was in der App anders ist als im Browser

| Thema | Browser / PWA | Store-App |
| --- | --- | --- |
| Startseite | `dist/pwa/index.html` | `dist/app/index.html` (`src/app/files.ts`) |
| Offline | Service Worker | nicht nötig, die Dateien liegen in der App |
| Backup, PDF, CSV speichern | Download | Teilen-Menü des Systems (in „Dateien“ sichern, Drive, E-Mail …), `src/app/share.ts` |
| Dateien importieren | Dateiauswahl | dieselbe Dateiauswahl des Systems |
| EZB-Kurse | Abruf bei der EZB | gleich |
| Automatischer IBKR-/SnapTrade-Abruf | über das lokale Relay | **geht in der App noch nicht** (kein Relay auf dem Handy), siehe „Offen“ |
| Symbol und Startbild | `src/pwa/png.ts` | dasselbe Symbol, erzeugt mit `npm run app:icons` |

## Bauen

Voraussetzungen unter Windows (am 22.11.2026 auf Joshuas PC installiert): Node 22+, JDK 21 (Microsoft OpenJDK),
Android Studio, Android SDK mit Plattform 36 und Build-Tools 36 unter `%LOCALAPPDATA%\Android\Sdk`.

```bash
npm run app:sync      # Web-App bauen und nach android/ und ios/ kopieren
npm run app:android   # Android Studio mit dem Projekt öffnen (dort: Run auf Handy oder Emulator)
npm run app:apk       # Debug-APK bauen: android/app/build/outputs/apk/debug/app-debug.apk
npm run app:icons     # Symbol und Startbild neu zeichnen (nach npx cap add)
```

`npm run app:apk` braucht `JAVA_HOME` auf das JDK 21, z. B. `C:\Program Files\Microsoft\jdk-21.0.13.102-hotspot`.
`android/local.properties` (Pfad zum SDK) ist lokal und wird nicht committet.

**iOS:** Eine iOS-App lässt sich nur auf einem Mac mit Xcode bauen. Das Projekt liegt in `ios/` (Swift Package Manager,
kein CocoaPods). Zur Kontrolle baut der GitHub-Workflow `.github/workflows/store-apps.yml` bei jedem Push auf einem Mac
von GitHub die iOS-App für den Simulator (ohne Signatur) und eine Android-Debug-APK (als Artefakt herunterladbar).

**Emulator:** Auf Joshuas PC ist die Virtualisierung im BIOS ausgeschaltet (AMD SVM), der Android-Emulator läuft deshalb
nicht. Testen auf dem eigenen Android-Handy: APK aufs Handy kopieren und installieren („Installation aus unbekannten
Quellen“ einmalig erlauben) oder per USB-Debugging aus Android Studio.

## Was Joshua erledigen muss (nicht automatisierbar)

1. **App-ID festlegen.** Platzhalter ist `at.kestruecklage.app` (`capacitor.config.json`, `android/app/build.gradle`,
   iOS-Projekt). Nach dem ersten Hochladen in den Play Store lässt sie sich **nie mehr ändern**.
2. **Konten anlegen** (selbst, mit eigenen Zahlungsdaten):
   - Google Play Console: einmalige Registrierungsgebühr (beim Anmelden prüfen).
     Neue **private** Konten brauchen vor der Veröffentlichung einen geschlossenen Test mit mindestens **12 Testern über
     14 Tage am Stück** ([Google Play Console-Hilfe](https://support.google.com/googleplay/android-developer/answer/14151465)).
     Für Organisationskonten gilt das laut Drittquellen nicht; dafür braucht es eine D-U-N-S-Nummer.
   - Apple Developer Program: **99 US-$ je Mitgliedsjahr**, automatische Verlängerung; als Einzelperson steht dein
     voller Name als Anbieter im App Store ([Apple](https://developer.apple.com/help/account/membership/program-enrollment/)).
3. **Signaturschlüssel für Android** (Upload-Key) selbst erzeugen und sicher aufbewahren, nie ins Repository. Ohne ihn
   lassen sich keine Updates mehr hochladen (mit „Play App Signing“ kann Google den Upload-Key zurücksetzen).
4. **Datenschutzerklärung als Web-Adresse** und Impressum: Beide Stores verlangen eine erreichbare URL. Inhalt klärt der
   Anwalt (`docs/FRAGEN-STEUERBERATER-ANWALT.md`, 2.1–2.4). Die App sendet nur die Abfrage der EZB-Kurse (Währung und
   Zeitraum) ins Internet.
5. **Store-Angaben:** Beschreibung, Screenshots, Altersfreigabe, bei Google das Formular „Datensicherheit“, bei Apple die
   Datenschutzangaben („App Privacy“). Beide Stores prüfen Finanz- und Steuer-Apps genauer; der Hinweis „Berechnungstool,
   keine Steuer- oder Anlageberatung“ steht in der App.
6. **iOS signieren und hochladen:** braucht das Apple-Konto, dann einen Mac oder einen erweiterten GitHub-Workflow mit
   Zertifikat und Provisioning-Profil als Geheimnisse.

## Vorgaben der Stores (geprüft am 22.11.2026)

- Google Play: neue Apps und Updates müssen **Android 16 (API 36)** als Ziel haben, seit 31.08.2026
  ([Google](https://support.google.com/googleplay/android-developer/answer/11926878)). Das Projekt hat `targetSdkVersion = 36`.
- Mindestversion: Android 7.0 (API 24), Vorgabe von Capacitor 8.

## Offen

- **Automatischer Abruf in der App:** Auf dem Handy gibt es kein Relay. Möglich wäre der direkte Abruf über die native
  HTTP-Schnittstelle von Capacitor (ohne CORS-Grenze); dann ginge das IBKR-Token nicht über einen fremden Server.
  Eigener Schritt, wenn gewünscht.
- **App-ID, Konten, Datenschutzerklärung:** siehe oben, Entscheidung Joshua.
