import { chromium } from "playwright-core";
const BASE = "http://localhost:8090";
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("input[type=email]", { timeout: 15000 });
  await page.fill("input[type=email]", "owner@dahav.local");
  await page.fill("input[type=password]", "owner12345");
  await page.press("input[type=password]", "Enter");
  await page.waitForSelector(".shell", { timeout: 15000 });

  // Sales page: search + filter + pagination controls
  await page.click('a[href="/sales"]');
  await page.waitForSelector(".list-toolbar", { timeout: 15000 });
  await page.waitForTimeout(1200);
  console.log("search box:", await page.locator(".search-box").count());
  console.log("status filter:", await page.locator(".list-toolbar select").count());
  const rows = await page.locator("tbody tr").count();
  console.log("sales rows on page 1:", rows);
  const sortable = await page.locator("th.sortable").count();
  console.log("sortable headers:", sortable);

  // Click a sale row -> opens detail panel
  await page.locator("tbody tr").first().click();
  await page.waitForTimeout(800);
  console.log("detail panel:", await page.locator(".detail-panel h2").count());

  // Navigate to a sale detail route (click the sale link)
  await page.locator(".detail-panel a[href^='/sales/']").first().click();
  await page.waitForTimeout(1200);
  const url = page.url();
  console.log("sale detail url:", url);
  console.log("sale detail rendered:", await page.locator("h1", { hasText: "Sale" }).count());

  // Transaction traceability: click txn link if present
  const txnLink = page.locator('a[href^="/transactions/"]');
  if (await txnLink.count()) {
    await txnLink.first().click();
    await page.waitForTimeout(1200);
    console.log("transaction detail rendered:", await page.locator("h1 code").count());
  }

  // Customer detail from a customer link on the dashboard
  await page.goto(BASE + "/customers/" + (await page.evaluate(() => "x")), { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  console.log("back on dashboard:", (await page.locator(".dashboard").count()) > 0);

  console.log("console errors:", errors.length ? JSON.stringify(errors) : "none");
  await browser.close();
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
