import Decimal from "decimal.js";

/** Rechnet mit 40 signifikanten Stellen; gerundet wird erst im Bericht. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;
export type DecInput = string | number | Dec;

export const dec = (v: DecInput): Dec => new D(v);
export const ZERO = dec(0);
