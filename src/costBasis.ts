import { dec, ZERO, type Dec, type DecInput } from "./decimal.js";

/** Ein Kauf oder Verkauf, Beträge bereits in EUR, ohne Spesen (Spesen zählen im 27,5 %-Topf nicht). */
export interface Trade {
  isin: string;
  depot: string;
  date: string;
  /** transfer_out = Übertrag aus dem Depot (z. B. Krypto ins eigene Wallet): kein Verkauf, kein Gewinn */
  side: "buy" | "sell" | "transfer_out";
  quantity: DecInput;
  amountEur: DecInput;
}

export interface Position {
  quantity: Dec;
  costEur: Dec;
  avgPriceEur: Dec;
}

export interface RealizedGain {
  isin: string;
  depot: string;
  date: string;
  quantity: Dec;
  proceedsEur: Dec;
  costEur: Dec;
  gainEur: Dec;
}

/**
 * Führt Bestände nach dem gleitenden Durchschnittspreis (§ 27a Abs 4 Z 3 EStG),
 * getrennt je ISIN und Depot. FIFO ist in Österreich nicht zulässig.
 */
export class Positions {
  private readonly book = new Map<string, { quantity: Dec; costEur: Dec }>();

  apply(trade: Trade): RealizedGain | null {
    const key = `${trade.depot}|${trade.isin}`;
    const pos = this.book.get(key) ?? { quantity: ZERO, costEur: ZERO };
    const quantity = dec(trade.quantity);
    const amount = dec(trade.amountEur);
    if (quantity.lte(0)) throw new Error(`Stückzahl muss positiv sein (${trade.isin}, ${trade.date})`);

    if (trade.side === "buy") {
      this.book.set(key, { quantity: pos.quantity.plus(quantity), costEur: pos.costEur.plus(amount) });
      return null;
    }

    if (quantity.gt(pos.quantity)) {
      throw new Error(
        `${trade.side === "sell" ? "Verkauf" : "Übertrag"} von ${quantity.toString()} Stück ${trade.isin} am ${trade.date} übersteigt den Bestand von ${pos.quantity.toString()}`,
      );
    }
    const costSold = quantity.eq(pos.quantity) ? pos.costEur : pos.costEur.div(pos.quantity).times(quantity);
    const rest = pos.quantity.minus(quantity);
    this.book.set(key, { quantity: rest, costEur: rest.isZero() ? ZERO : pos.costEur.minus(costSold) });

    if (trade.side === "transfer_out") return null;
    return {
      isin: trade.isin,
      depot: trade.depot,
      date: trade.date,
      quantity,
      proceedsEur: amount,
      costEur: costSold,
      gainEur: amount.minus(costSold),
    };
  }

  /** Alle Positionen mit Bestand, z. B. für die Übersicht offener Positionen. */
  open(): Array<Position & { isin: string; depot: string }> {
    return [...this.book.entries()]
      .filter(([, pos]) => !pos.quantity.isZero())
      .map(([key, pos]) => {
        const [depot = "", isin = ""] = key.split("|");
        return { isin, depot, quantity: pos.quantity, costEur: pos.costEur, avgPriceEur: pos.costEur.div(pos.quantity) };
      });
  }

  get(isin: string, depot: string): Position {
    const pos = this.book.get(`${depot}|${isin}`) ?? { quantity: ZERO, costEur: ZERO };
    return {
      quantity: pos.quantity,
      costEur: pos.costEur,
      avgPriceEur: pos.quantity.isZero() ? ZERO : pos.costEur.div(pos.quantity),
    };
  }
}
