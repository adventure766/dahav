/**
 * Verifies the ESM engine copy (pb_hooks/engine/index.mjs) is in sync with the
 * canonical CJS engine (pb_hooks/engine/index.cjs) that PocketBase executes.
 * If this fails, run: node scripts/sync-engine.mjs
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, "../pb_hooks/engine");

const EXPORT_NAMES = [
  "MINOR", "fromMinor", "toMinor", "roundMoney", "roundHalfUp",
  "sspToUsd", "usdToSsp", "toUsd", "fromUsd",
  "formatMoney", "formatMoneyGrouped", "formatWhole", "formatCurrency",
  "lineTotal", "cartTotals", "paymentTotals", "actualPaidAmount",
  "percentDiscount", "absoluteDiscount",
  "grossProfit", "netProfit", "damageCost", "netSalary",
  "generateId", "todayKey", "movingAverage", "customerBalance", "salePaymentState",
  "buildTransactionSnapshot",
];

function canonicalEsM() {
  const cjs = fs.readFileSync(path.join(engineDir, "index.cjs"), "utf8");
  const body = cjs.replace(/module\.exports\s*=\s*\{[\s\S]*?\n\};?\s*$/, "").trimEnd();
  const named = `export { ${EXPORT_NAMES.join(", ")} };`;
  const defaultExport = `export default { ${EXPORT_NAMES.join(", ")} };`;
  return `${body}\n\n${named}\n${defaultExport}\n`;
}

describe("engine ESM/CJS sync (single source of truth)", () => {
  it("index.mjs is generated from index.cjs", () => {
    const onDisk = fs.readFileSync(path.join(engineDir, "index.mjs"), "utf8");
    expect(onDisk).toBe(canonicalEsM());
  });
});
