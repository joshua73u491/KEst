import { describe, expect, test } from "vitest";
import { syncViaRelay } from "../src/sync/webSync.js";

/** Abruf aus der Web-App über das Relay: je Fenster ein POST, Pausen wegen der Grenzen von IBKR, klare Fehler. */

const ok = (xml: string) => ({ ok: true, status: 200, text: async () => xml });
const err = (status: number, body: object) => ({ ok: false, status, text: async () => JSON.stringify(body) });

function fakeFetch(responses: Array<ReturnType<typeof ok> | Error>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const waits: number[] = [];
  const fetchFn = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    const r = responses.shift();
    if (!r) throw new Error("keine Antwort");
    if (r instanceof Error) throw r;
    return r;
  };
  return { fetchFn, sleep: async (ms: number) => void waits.push(ms), calls, waits };
}

describe("Abruf über das Relay", () => {
  test("je Zeitfenster ein Abruf mit Token, Query-ID und Zeitraum; Pause zwischen den Fenstern", async () => {
    const f = fakeFetch([ok("<FlexQueryResponse>1</FlexQueryResponse>"), ok("<FlexQueryResponse>2</FlexQueryResponse>")]);
    const parts = await syncViaRelay({ relay: "http://localhost:8787/", token: "123456789012", queryId: "42", from: "2025-01-01", to: "2026-11-21" }, f);
    expect(parts.map((p) => [p.from, p.to])).toEqual([
      ["2025-01-01", "2025-12-31"],
      ["2026-01-01", "2026-11-21"],
    ]);
    expect(f.calls.map((c) => c.url)).toEqual(["http://localhost:8787/ibkr-flex", "http://localhost:8787/ibkr-flex"]);
    expect(f.calls[0]?.body).toEqual({ token: "123456789012", queryId: "42", from: "2025-01-01", to: "2025-12-31" });
    expect(f.waits).toEqual([13_000]);
  });

  test("Fehler von IBKR kommen mit der Meldung des Relays", async () => {
    const f = fakeFetch([err(502, { code: "1012", message: "IBKR-Fehler 1012: Das Token ist abgelaufen." })]);
    await expect(syncViaRelay({ relay: "http://localhost:8787", token: "123456789012", queryId: "42", from: "2026-01-01", to: "2026-11-21" }, f)).rejects.toThrow(
      "IBKR-Fehler 1012: Das Token ist abgelaufen.",
    );
  });

  test("Relay nicht erreichbar: verständlicher Hinweis", async () => {
    const f = fakeFetch([new TypeError("Failed to fetch")]);
    await expect(syncViaRelay({ relay: "http://localhost:8787", token: "123456789012", queryId: "42", from: "2026-01-01", to: "2026-11-21" }, f)).rejects.toThrow(
      /Relay .* nicht erreichbar/,
    );
  });

  test("ohne Relay-Adresse oder mit ungültiger Adresse wird nichts abgerufen", async () => {
    const f = fakeFetch([]);
    await expect(syncViaRelay({ relay: "", token: "1", queryId: "42", from: "2026-01-01", to: "2026-11-21" }, f)).rejects.toThrow(/Relay/);
    await expect(syncViaRelay({ relay: "ftp://x", token: "1", queryId: "42", from: "2026-01-01", to: "2026-11-21" }, f)).rejects.toThrow(/Relay/);
    expect(f.calls).toEqual([]);
  });
});
