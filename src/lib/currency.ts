/**
 * Currency display helpers — single source for how money is rendered.
 * Uses the shared engine for formatting.
 */
import { formatCurrency as engineFormatCurrency } from "./engine";
import type { Currency } from "./engine";

export type { Currency };

/** Format an amount in its own currency with the correct label. */
export function fmt(amount: number, currency: string): string {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "SSP") return engineFormatCurrency(amount, "SSP");
  return engineFormatCurrency(amount, "USD");
}

/** Format a USD amount. */
export function usd(amount: number): string {
  return engineFormatCurrency(amount, "USD");
}

/** Format an SSP amount. */
export function ssp(amount: number): string {
  return engineFormatCurrency(amount, "SSP");
}

/** Pretty "1 USD = 8,000 SSP" label. */
export function rateLabel(rate: number): string {
  const r = Number(rate) || 0;
  return `1 USD = ${r.toLocaleString("en-US")} SSP`;
}
