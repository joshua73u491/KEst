import { dec, type Dec, type DecInput } from "./decimal.js";

/**
 * Rechnet einen Betrag in Euro um.
 * `ecbRate` = EZB-Referenzkurs am Buchungstag in Einheiten der Fremdwährung pro 1 EUR
 * (z. B. USD 1.25 heißt 1 EUR = 1,25 USD).
 */
export function toEur(amount: DecInput, currency: string, ecbRate?: DecInput): Dec {
  if (currency.toUpperCase() === "EUR") return dec(amount);
  if (ecbRate === undefined) {
    throw new Error(`Wechselkurs fehlt für ${currency}: Betrag kann nicht in EUR umgerechnet werden`);
  }
  const rate = dec(ecbRate);
  if (rate.lte(0)) throw new Error(`Wechselkurs ${rate.toString()} für ${currency} ist ungültig`);
  return dec(amount).div(rate);
}
