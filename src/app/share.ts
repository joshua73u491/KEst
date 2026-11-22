import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { fileData } from "./fileData.js";

/** true in der Store-App (Android/iOS), false im Browser und in der installierbaren Web-App. */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

/**
 * Speichern in der Store-App: Ein Download-Link funktioniert in der App-Ansicht (WebView) nicht. Die Datei wird deshalb
 * im Cache der App abgelegt und über das Teilen-Menü des Systems angeboten (in „Dateien“ sichern, Drive, E-Mail …).
 * Der Cache gehört nur dieser App; das System kann ihn leeren.
 */
export async function shareFile(name: string, content: string | Uint8Array): Promise<void> {
  const { data, utf8 } = fileData(content);
  const written = await Filesystem.writeFile({
    path: name,
    data,
    directory: Directory.Cache,
    ...(utf8 ? { encoding: Encoding.UTF8 } : {}),
  });
  await Share.share({ title: name, files: [written.uri], dialogTitle: `${name} sichern oder teilen` });
}
