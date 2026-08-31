/**
 * Regenerates pb_hooks/engine/index.mjs from the canonical CJS engine
 * (pb_hooks/engine/index.cjs). The ESM copy exists only so Vite/the browser
 * can import the engine; the CJS file remains the authoritative source for
 * PocketBase's goja runtime.
 *
 * Usage: node scripts/sync-engine.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, "../pb_hooks/engine");
const cjsPath = path.join(engineDir, "index.cjs");
const mjsPath = path.join(engineDir, "index.mjs");

const EXPORT_NAMES = [
  "MINOR", "fromMinor", "toMinor", "roundMoney", "roundHalfUp",
  "sspToUsd", "usdToSsp", "toUsd", "fromUsd",
  "formatMoney", "formatMoneyGrouped", "formatWhole", "formatCurrency",
  "lineTotal", "cartTotals", "paymentTotals",
  "percentDiscount", "absoluteDiscount",
  "grossProfit", "netProfit", "damageCost", "netSalary",
  "generateId", "todayKey", "movingAverage", "customerBalance",
  "buildTransactionSnapshot",
];

const cjs = fs.readFileSync(cjsPath, "utf8");
const moduleExportsMatch = cjs.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};?\s*$/);
if (!moduleExportsMatch) {
  throw new Error("Could not find module.exports block in " + cjsPath);
}

const body = cjs.slice(0, moduleExportsMatch.index).trimEnd();
const named = `export { ${EXPORT_NAMES.join(", ")} };`;
const defaultExport = `export default { ${EXPORT_NAMES.join(", ")} };`;

const mjs = `${body}

${named}
${defaultExport}
`;

fs.writeFileSync(mjsPath, mjs);
console.log("Regenerated", mjsPath, "(" + mjs.length + " bytes)");
