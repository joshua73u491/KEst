import Decimal from "decimal.js";

/**
 * Rechnet mit 40 signifikanten Stellen; gerundet wird erst im Bericht.
 * `toString()` ohne Exponentenschreibweise (sonst erscheint ein Rest von 0,0000000001 Stück als „1e-10“).
 */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -40, toExpPos: 40 });
export type Dec = InstanceType<typeof D>;
export type DecInput = string | number | Dec;

export const dec = (v: DecInput): Dec => new D(v);
export const ZERO = dec(0);
