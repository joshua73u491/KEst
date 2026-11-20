/**
 * Regelversion (PRODUKTPLAN: „Jede Berechnung speichert, mit welcher Regelversion sie entstanden ist“). Wird erhöht,
 * sobald sich eine Steuerregel, eine Kennzahl, ein Tarif oder ein DBA-Satz in der App ändert, und steht in jedem Bericht.
 * Format: JJJJ.MM-laufende Nummer.
 */
export const RULES_VERSION = "2026.11-1";

/** Kurzbeschreibung des Regelstands für den Bericht. */
export const RULES_NOTE =
  "Kennzahlen laut Formular E1kv 2024 (BMF); Einkommensteuertarif 2024 bis 2026 laut BMF; DBA-Höchstsätze für 14 Länder laut RIS; " +
  "Fremdwährung laut EStR 2000 Rz 6201c; Stand 20.11.2026.";
