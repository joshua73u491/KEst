import { emptyHistory, fromBackup, toBackup, type History } from "../history.js";

/**
 * Speichert die Steuerhistorie dauerhaft im Browser (IndexedDB). Die Daten verlassen das Gerät nicht.
 * Gespeichert wird dasselbe Format wie im Backup; beim Laden wird jede Datei erneut geprüft.
 */
const DB_NAME = "kest-ruecklage";
const STORE = "daten";
const KEY = "historie";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Dieser Browser kann keine Daten speichern."));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("Der Speicher des Browsers ist nicht verfügbar (z. B. privates Fenster)."));
    req.onblocked = () => reject(new Error("Der Speicher ist durch einen anderen Tab blockiert. Bitte andere Tabs der App schließen."));
  });
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(new Error(tx.error?.name === "QuotaExceededError" ? "Der Speicher des Browsers ist voll." : "Speichern im Browser ist fehlgeschlagen."));
        };
      }),
  );
}

/** Lädt die gespeicherte Historie; ohne gespeicherte Daten eine leere. */
export async function loadHistory(): Promise<History> {
  const stored = await run<unknown>("readonly", (s) => s.get(KEY));
  if (typeof stored !== "string") return emptyHistory();
  return fromBackup(stored);
}

export async function saveHistory(history: History): Promise<void> {
  await run("readwrite", (s) => s.put(toBackup(history, new Date().toISOString()), KEY));
}

export async function clearHistory(): Promise<void> {
  await run("readwrite", (s) => s.delete(KEY));
  await run("readwrite", (s) => s.delete(FLEX_KEY));
}

/**
 * Zugangsdaten für den automatischen IBKR-Abruf. Getrennt von der Historie gespeichert und bewusst **nicht** im
 * Backup: Das Token erlaubt das Lesen aller Berichte des Kontos.
 */
export interface FlexSettings {
  token: string;
  queryId: string;
  /** JJJJ-MM-TT, ab dem beim ersten Abruf geladen wird */
  since: string;
  relay: string;
  /** beim Öffnen höchstens einmal am Tag abrufen */
  auto: boolean;
  /** JJJJ-MM-TT des letzten erfolgreichen Abrufs */
  lastSync: string;
}

const FLEX_KEY = "ibkr-flex";

export async function loadFlexSettings(): Promise<FlexSettings | null> {
  const v = await run<unknown>("readonly", (s) => s.get(FLEX_KEY));
  if (typeof v !== "object" || v === null) return null;
  const x = v as Partial<FlexSettings>;
  return {
    token: typeof x.token === "string" ? x.token : "",
    queryId: typeof x.queryId === "string" ? x.queryId : "",
    since: typeof x.since === "string" ? x.since : "",
    relay: typeof x.relay === "string" ? x.relay : "",
    auto: x.auto === true,
    lastSync: typeof x.lastSync === "string" ? x.lastSync : "",
  };
}

export async function saveFlexSettings(s: FlexSettings): Promise<void> {
  await run("readwrite", (st) => st.put({ ...s }, FLEX_KEY));
}
