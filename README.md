# DAHAV Business Management System

A production-quality business management system (POS, inventory, sales, payments, expenses, payroll, reporting) built on **React + PocketBase (SQLite)** with a **centralized calculation engine** as the single source of truth for all financial math.

## Architecture

```
React PWA (Vite, TypeScript)   ←  served from PocketBase pb_public (same origin)
        │
        ▼
PocketBase (SQLite)  —  auth, file storage, custom /api/dahav/* endpoints
        │
        ▼
Shared Calculation Engine  (pb_hooks/engine/index.cjs)
   • executes server-side in pb_hooks (authoritative, persisted values)
   • imported by the frontend for live UX preview (identical functions)
   • exercised by Vitest (unit + integration)
```

Every financial write goes through a custom server endpoint that runs the engine and persists results in one transaction. The UI only displays persisted results or previews via the same engine — no component independently recomputes money.

## Currency model

- Internal/reporting currency: **USD**.
- Canonical rate: **1 USD = X SSP** (user-friendly, never forced into 1 SSP = ... USD).
- Every transaction stores: `original_amount`, `original_currency`, `exchange_rate`, `amount_usd`, plus its `transaction_id`.
- Display rule: `$2.50` for USD, `20,000 SSP` for SSP — never merged or relabeled.
- Transactions may use the default rate or a per-transaction custom rate; the rate actually used is stored and never retroactively changed.

## Setup (first run)

1. **Install dependencies:** `npm install`
2. **Create superuser + run migrations:**
   ```
   pocketbase superuser upsert admin@yourdomain.com yourpassword --dir pb_data
   ```
   (Migrations in `pb_migrations/` run automatically at first boot and create every collection, field, index, and rule.)
3. **Start the server:**
   ```
   pocketbase serve --http=0.0.0.0:8090
   ```
4. **Create the first owner user** via Settings → Add User (or via the superuser in the PocketBase dashboard).

## LAN deployment (laptop + phones on same Wi-Fi)

1. Start PocketBase bound to `0.0.0.0` (above).
2. Build the frontend into `pb_public`:
   ```
   npm run build && (copy dist/* to pb_public/)
   ```
3. Find the laptop IP: `ipconfig` → *Wireless LAN adapter Wi-Fi → IPv4 Address* (e.g. `192.168.0.102`).
4. Open `http://192.168.0.102:8090` on any device. The app uses `window.location.origin` (same-origin) — no hardcoded IPs.
5. If a device can't auto-connect, use **Connect Manually** and enter `http://<laptop-ip>:8090` (never `127.0.0.1`/`localhost` from another device).

## Testing

```bash
npm test                      # unit tests (engine, POS)
npm run test:integration      # integration tests against a running server
node scripts/qc.mjs           # live cross-screen consistency checks
```

Integration tests require a server running on port 8092 with superuser `admin@dahav.local` / `admin12345`:
```
pocketbase serve --http=127.0.0.1:8092 --dir pb_data
```

## Client deployment & self-update

DAHAV ships as a **local web app**: a double-click `DAHAV.bat` starts the local
PocketBase + the built React app and opens the browser. Clients never need
VS Code, Node, or npm. Business data stays in the client's local `pb_data/`
and is **never** uploaded or overwritten by updates.

### Architecture

```
CLIENT LAPTOP (e.g. C:\DAHAV)
  DAHAV.bat  →  scripts/updater.ps1  (supervisor)
      ├─ starts pocketbase.exe  (serves the app on :8090)
      ├─ local API on 127.0.0.1:8091  (GET /status, POST /apply)
      └─ checks https for updates → downloads → SHA-256 verifies → stages

  Browser  →  http://127.0.0.1:8090  (React PWA)
                  └─ update banner polls 127.0.0.1:8091
  pb_data/ → NEVER replaced by an update
```

- **Internet is used only to check + download application updates.**
- **Offline:** the update check fails silently and DAHAV keeps running.
- **Update:** the app shows *“DAHAV update available — Update Now / Later”*.
  *Update Now* stops PocketBase, takes a local DB backup, swaps application
  files (pb_public, pb_hooks, pb_migrations, pocketbase.exe, scripts), restarts,
  clears the service-worker cache, and reloads. On failure it rolls back to the
  previous version. *Later* applies the staged update at the next launch.

### Release workflow (developer)

1. Bump the version in `package.json` (single source of truth).
2. `npm run release` — builds, deploys `dist` → `pb_public`, and writes
   `release/DAHAV-<v>.zip` + `release/latest.json` (sha256 included).
3. Upload the zip + `latest.json` to your update host. With GitHub:
   - create a release tagged `v<version>` with `DAHAV-<v>.zip` as an asset, and
   - commit `latest.json` to the `updates` branch (stable raw URL).
4. Clients detect the new version automatically.

### Update manifest (`latest.json`)

```json
{
  "version": "1.0.1",
  "date": "2026-09-01",
  "notes": "What changed",
  "url": "https://github.com/<owner>/<repo>/releases/download/v1.0.1/DAHAV-1.0.1.zip",
  "sha256": "<hex>",
  "min_version": "1.0.0"
}
```

The manifest URL lives in `update-config.json` (defaults to the GitHub raw URL).
The launcher compares versions, downloads, verifies the SHA-256, and only then
stages the update. A checksum mismatch is rejected and the current version kept.

### Update tests

```bash
npm run test:update   # end-to-end: fresh install → data → 1.0.1 → 1.0.2 → corrupt → rollback
```

Runs entirely in `tests/update-env/` with its own `pb_data` and ports — the real
database is never touched.

## Collections (all created by migrations)

`users` (auth, role-based) · `settings` · `counters` · `exchange_rates` · `audit_logs` · `transactions` (ledger) · `product_categories` · `products` · `inventory_movements` · `customers` · `sales` · `sale_items` · `invoices` · `payments` · `receipts` (full snapshot for reprinting) · `expense_categories` · `suppliers` · `expenses` · `employees` · `payroll` · `damage_records`

## Key rules enforced

- **Financial records cannot be hard-deleted** — void/reverse with audit instead.
- **Every money record carries its own currency + rate + USD equivalent.**
- **Damages are valued at cost basis** (`qty × unit_cost`), never selling price.
- **Reports/dashboard read stored authoritative values** — no independent arithmetic.
- **Roles** (owner/manager/cashier/employee) gate every endpoint and UI section.

## IDs

`TR-YYYYMMDD-NNNN` (transaction) · `SALE-…` · `PAY-…` · `REC-…` · `INV-…` · `EXP-…` · `PRL-…` · `DMG-…` — all unique, persistent, and cross-linked.
