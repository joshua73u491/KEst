import { dec, D, ZERO, type Dec, type DecInput } from "./decimal.js";

export interface ReserveInput {
  basket275TaxEur: DecInput;
  /** Steuer auf Zinsen aus Geldeinlagen (25 %) */
  bankInterestTaxEur?: DecInput;
  tariffExtraTaxEur: DecInput;
  /** Sicherheitspuffer als Anteil, z. B. 0.1 für 10 % */
  bufferRate: DecInput;
}

/** Soll-Rücklage = (Steuer 27,5 %-Topf + Steuer auf Bankzinsen + Mehrsteuer aus KZ 857) × (1 + Puffer). */
export function reserveTarget(input: ReserveInput): Dec {
  const buffer = dec(input.bufferRate);
  if (buffer.lt(0)) throw new Error("Puffer darf nicht negativ sein");
  const tax = D.sum(
    D.max(ZERO, dec(input.basket275TaxEur)),
    D.max(ZERO, dec(input.bankInterestTaxEur ?? 0)),
    D.max(ZERO, dec(input.tariffExtraTaxEur)),
  );
  return tax.times(buffer.plus(1));
}
