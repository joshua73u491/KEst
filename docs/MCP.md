# MCP-Add-on (Schritt 5.1)

Der Rechenkern der App läuft zusätzlich als lokaler **MCP-Server**. Damit kann Claude dieselben Funktionen nutzen wie die App, z. B. „Wie viel muss ich für 2026 zurücklegen?“ oder „Was kostet mich der Verkauf von 6 Stück zu 90 €?“. Gebaut mit dem offiziellen TypeScript-SDK (`@modelcontextprotocol/sdk`), Transport stdio.

- **Alles bleibt lokal.** Die Historie liegt in einer Datei auf dem Rechner, im Backup-Format der Web-App. Ein Backup der Web-App kann direkt als Historie dienen und umgekehrt.
- **Was das Gerät verlässt:**
  - der Abruf der EZB-Kurse (nur Währung und Zeitraum)
  - auf Anforderung `sync_ibkr` an IBKR und `sync_snaptrade` an SnapTrade
- **Kein Werkzeug bewegt Geld oder empfiehlt etwas.** Die Ergebnisse tragen den Hinweis „Berechnungstool, keine Steuerberatung“.

## Werkzeuge

| Werkzeug | Was es tut |
| --- | --- |
| `import_file` | Exportdatei (Trade Republic, IBKR, DEGIRO, SnapTrade-JSON) in die Historie übernehmen |
| `compute_tax_ytd` | Kennzahlen der E1kv, Steuer und Soll-Rücklage eines Jahres |
| `get_reserve_status` | Soll gegen Ist, Fehlbetrag, Freigabe erst nach dem 31.12. |
| `book_reserve` | Stand der Rücklage eintragen (Marktwert, Datum, Ort, Notiz) |
| `simulate_sale` | Gedachten Verkauf durchrechnen |
| `check_order_against_reserve` | Reicht das Guthaben für eine Order, ohne die Rücklage anzugreifen? |
| `review_findings` | Prüfassistent: Auffälligkeiten in den Buchungen |
| `get_cost_basis` | Offene Positionen mit Durchschnittspreis |
| `list_transactions` | Buchungen eines Jahres |
| `generate_e1kv_report` | E1kv-Bericht als PDF und/oder CSV speichern |
| `set_config` | Puffer, „steuereinfach seit“, Optionen/Futures, Broker-Zinsen, sonstiges Einkommen |
| `sync_ibkr` | Automatischer Abruf bei IBKR (Token aus `IBKR_FLEX_TOKEN`) |
| `sync_snaptrade` | Automatischer Abruf über SnapTrade Personal (Schlüssel aus `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`) |

Zugangsdaten stehen **nur in der Umgebung des Servers**, nie als Werkzeug-Argument. Sonst stünden sie im Chat.

## Einrichten

**Claude Code** (im Repository):

```bash
claude mcp add kest-ruecklage -e KEST_HISTORY="$PWD/data/private/kest-historie.json" -- npx tsx src/mcp/server.ts
```

**Claude Desktop** (`claude_desktop_config.json`, Pfade anpassen):

```json
{
  "mcpServers": {
    "kest-ruecklage": {
      "command": "npx",
      "args": ["tsx", "C:/Users/<Name>/Documents/KEst/src/mcp/server.ts"],
      "env": { "KEST_HISTORY": "C:/Users/<Name>/Documents/KEst/data/private/kest-historie.json" }
    }
  }
}
```

**Umgebungsvariablen:**

| Variable | Bedeutung |
| --- | --- |
| `KEST_HISTORY` | Pfad zur Historie. Standard: `data/private/kest-historie.json` im Repository, nie committet |
| `KEST_EZB_KURSE` | optional: `eurofxref-hist.csv` statt Abruf bei der EZB |
| `IBKR_FLEX_TOKEN` | optional: für `sync_ibkr` |
| `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` | optional: für `sync_snaptrade` |

## Geprüft

- Werkzeuge als reine Funktionen getestet (`test/mcpTools.test.ts`).
- Mit dem offiziellen MCP-Client über stdio gegen den echten Server, am 21.11.2026:
  - Import der Beispieldatei, Kennzahlen 2026 wie in der App.
  - Rücklage eingetragen, Fehlbetrag stimmt.
  - PDF-Bericht geschrieben.
  - Fehler (ungültiger Puffer, fehlendes Token) kommen als deutsche Meldung mit `isError`.
