/**
 * Inhalt einer Datei für `Filesystem.writeFile` in der Store-App: Text als UTF-8, Bytes (PDF) als Base64.
 * Reine Funktion ohne Capacitor, damit sie testbar ist und im Browser nichts Zusätzliches lädt.
 */
export function fileData(content: string | Uint8Array): { data: string; utf8: boolean } {
  if (typeof content === "string") return { data: content, utf8: true };
  let binary = "";
  for (let i = 0; i < content.length; i += 0x8000) binary += String.fromCharCode(...content.subarray(i, i + 0x8000));
  return { data: btoa(binary), utf8: false };
}
