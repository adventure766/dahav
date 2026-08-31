import { chromium } from "playwright-core";
const BASE = "http://localhost:8090";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("input[type=email]", { timeout: 15000 });
  await page.fill("input[type=email]", "owner@dahav.local");
  await page.fill("input[type=password]", "owner12345");
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector(".dashboard", { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Period selector present
  const chips = await page.locator(".period-bar .chip").count();
  console.log("period chips:", chips);

  // Primary KPIs
  const primary = await page.locator(".kpi-primary").count();
  console.log("primary KPI cards:", primary);

  // Chart SVG rendered
  const svg = await page.locator(".trend-chart svg").count();
  console.log("trend chart svg:", svg);

  // Profit analysis flow
  const pnl = await page.locator(".pnl-flow").count();
  console.log("profit panel:", pnl);

  // Quick actions
  const qa = await page.locator(".qa-btn").count();
  console.log("quick actions:", qa);

  // Activity feed
  const act = await page.locator(".activity-feed li").count();
  console.log("activity items:", act);

  // Switch period to Today
  await page.locator('.period-bar .chip:has-text("Today")').click();
  await page.waitForTimeout(1500);
  const todayLabel = await page.locator(".dashboard-head .muted").first().innerText();
  console.log("period label after Today:", todayLabel);

  // Mobile viewport test
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const mobileCols = await page.evaluate(() => {
    const cols = document.querySelectorAll(".dash-cols");
    return cols.length > 0 ? getComputedStyle(cols[0]).gridTemplateColumns.split(" ").length : 0;
  });
  console.log("mobile dash-cols columns:", mobileCols);

  console.log("console errors:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
