import { useEffect, useState, useCallback } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { usd } from "../lib/currency";
import { useAuthUser } from "../components/useAuthUser";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit_price: number;
  unit_cost: number;
  stock: number;
  low_stock_threshold: number;
  currency: string;
  active: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface DamageRecord {
  id: string;
  damage_id: string;
  product: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  reason: string;
  created: string;
}

export function ProductsPage() {
  const user = useAuthUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [damages, setDamages] = useState<DamageRecord[]>([]);
  const [tab, setTab] = useState<"products" | "damage">("products");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showStockIn, setShowStockIn] = useState<Product | null>(null);
  const [showDamage, setShowDamage] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: "", sku: "", category: "", unit_price: "", unit_cost: "", stock: "", low_stock_threshold: "" });

  const emptyForm = () => setForm({ name: "", sku: "", category: "", unit_price: "", unit_cost: "", stock: "", low_stock_threshold: "" });

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku || "",
      category: p.category || "",
      unit_price: String(p.unit_price),
      unit_cost: String(p.unit_cost),
      stock: String(p.stock),
      low_stock_threshold: String(p.low_stock_threshold || 0),
    });
    setShowForm(true);
  };

  const load = useCallback(async () => {
    const pb = getPb();
    const [p, c, d] = await Promise.all([
      pb.collection("products").getFullList<Product>({ sort: "name" }),
      pb.collection("product_categories").getFullList<Category>({ sort: "name" }),
      pb.collection("damage_records").getFullList<DamageRecord>({ sort: "-created" }),
    ]);
    setProducts(p);
    setCategories(c);
    setDamages(d);
  }, []);

  useEffect(() => {
    load().catch((e) => setError("Failed to load products: " + e.message));
  }, [load]);

  const canManage = user?.role === "manager" || user?.role === "owner";
  const canDelete = user?.role === "owner";

  const doDeleteProduct = async () => {
    if (!confirmDelete) return;
    setDeleting(true); setError(""); setSuccess("");
    const r = await api(`/api/dahav/records/products/${confirmDelete.id}`, { method: "DELETE" });
    setDeleting(false);
    if (r.status !== 200) {
      setError((r.data as { error?: string }).error || "Delete failed");
      setConfirmDelete(null);
      return;
    }
    setSuccess(`Product ${confirmDelete.name} deleted`);
    setConfirmDelete(null);
    await load();
  };

  const submitProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const pb = getPb();
    const payload = {
      name: form.name,
      sku: form.sku,
      category: form.category || undefined,
      unit_price: Number(form.unit_price),
      unit_cost: Number(form.unit_cost),
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
    };
    try {
      if (editing) {
        await pb.collection("products").update(editing.id, payload);
        setSuccess(`Product updated: ${form.name}`);
      } else {
        await pb.collection("products").create({
          ...payload,
          stock: Number(form.stock) || 0,
          currency: "USD",
          active: true,
        });
        setSuccess(`Product created: ${form.name}`);
      }
      await load();
      setShowForm(false);
      setEditing(null);
      emptyForm();
    } catch (err) {
      setError("Save failed: " + (err as Error).message);
    }
  };

  const toggleActive = async (p: Product) => {
    setError(""); setSuccess("");
    const pb = getPb();
    try {
      await pb.collection("products").update(p.id, { active: !p.active });
      await load();
      setSuccess(`${p.name} ${p.active ? "deactivated" : "activated"}`);
    } catch (err) {
      setError("Update failed: " + (err as Error).message);
    }
  };

  const doStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showStockIn) return;
    setError(""); setSuccess("");
    const fd = new FormData(e.target as HTMLFormElement);
    const r = await api("/api/dahav/inventory/stock-in", {
      method: "POST",
      body: { product_id: showStockIn.id, quantity: Number(fd.get("quantity")), unit_cost: Number(fd.get("unit_cost")) },
    });
    if (r.status !== 200) { setError((r.data as { error?: string }).error || "Stock-in failed"); return; }
    await load();
    setShowStockIn(null);
    setSuccess("Stock added (moving-average cost updated)");
  };

  const doDamage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showDamage) return;
    setError(""); setSuccess("");
    const fd = new FormData(e.target as HTMLFormElement);
    const r = await api("/api/dahav/inventory/damage", {
      method: "POST",
      body: { product_id: showDamage.id, quantity: Number(fd.get("quantity")), reason: String(fd.get("reason") || "") },
    });
    if (r.status !== 200) { setError((r.data as { error?: string }).error || "Damage registration failed"); return; }
    const res = r.data as { calculation?: { quantity: number; unit_cost: number; total_cost: number } };
    await load();
    setShowDamage(null);
    if (res.calculation) {
      setSuccess(`Damage recorded: ${res.calculation.quantity} × ${usd(res.calculation.unit_cost)} = ${usd(res.calculation.total_cost)} loss (cost basis)`);
    } else {
      setSuccess("Damage recorded");
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Products &amp; Inventory</h1>
        <div className="tab-row">
          <button className={`btn small ${tab === "products" ? "primary" : "ghost"}`} onClick={() => setTab("products")}>Products</button>
          <button className={`btn small ${tab === "damage" ? "primary" : "ghost"}`} onClick={() => setTab("damage")}>Damaged ({damages.length})</button>
          {canManage && tab === "products" && (
            <button className="btn primary small" onClick={() => { setEditing(null); emptyForm(); setShowForm(true); }}>+ New Product</button>
          )}
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {success && <div className="alert success">{success}</div>}

      {tab === "products" && (
        <div className="card table-wrap">
          <table className="products-table">
            <thead>
              <tr>
                <th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Cost</th>
                <th>Stock</th><th>Value</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted">{p.sku || "—"}</td>
                  <td>{categories.find((c) => c.id === p.category)?.name || "—"}</td>
                  <td className="money-usd">{usd(p.unit_price)}</td>
                  <td className="money-usd">{usd(p.unit_cost)}</td>
                  <td>
                    <span className={p.low_stock_threshold && p.stock <= p.low_stock_threshold ? "badge red" : ""}>
                      {p.stock}
                    </span>
                  </td>
                  <td className="money-usd">{usd(p.unit_cost * p.stock)}</td>
                  <td>{p.active ? <span className="badge green">Active</span> : <span className="badge gray">Inactive</span>}</td>
                  <td className="no-print">
                    {canManage && (
                      <>
                        <button className="btn small" onClick={() => openEdit(p)} aria-label={`Edit ${p.name}`}>
                          <Pencil size={14} style={{ verticalAlign: "-2px" }} />
                        </button>{" "}
                        <button className="btn small" onClick={() => setShowStockIn(p)}>Stock in</button>{" "}
                        <button className="btn small danger" onClick={() => setShowDamage(p)}>Damage</button>{" "}
                        <button className="btn small ghost" onClick={() => toggleActive(p)}>{p.active ? "Deactivate" : "Activate"}</button>{" "}
                        {canDelete && (
                          <button className="btn small danger" onClick={() => setConfirmDelete(p)} aria-label={`Delete ${p.name}`}><Trash2 size={14} style={{ verticalAlign: "-2px" }} /></button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "damage" && (
        <div className="card table-wrap">
          <table className="products-damage-table">
            <thead>
              <tr><th>ID</th><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total Loss</th><th>Reason</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {damages.map((d) => (
                <tr key={d.id}>
                  <td className="muted">{d.damage_id}</td>
                  <td>{products.find((p) => p.id === d.product)?.name || "—"}</td>
                  <td>{d.quantity}</td>
                  <td className="money-usd">{usd(d.unit_cost)}</td>
                  <td className="money-usd">{usd(d.total_cost)}</td>
                  <td>{d.reason || "—"}</td>
                  <td className="muted">{new Date(d.created).toLocaleString()}</td>
                  <td className="no-print">
                    {canDelete && (
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete damage ${d.damage_id}? Stock will be restored and its transaction removed.`)) return;
                          const r = await api(`/api/dahav/records/damage/${d.id}`, { method: "DELETE" });
                          if (r.status !== 200) { setError((r.data as { error?: string }).error || "Delete failed"); return; }
                          setSuccess(`Damage ${d.damage_id} deleted; ${(r.data as { restored_qty?: number }).restored_qty ?? d.quantity} unit(s) restored to stock.`);
                          await load();
                        }}
                      >
                        <Trash2 size={14} style={{ verticalAlign: "-2px" }} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditing(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? `Edit Product — ${editing.name}` : "New Product"}</h2>
            <form onSubmit={submitProduct}>
              <label>Name <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>SKU <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></label>
              <label>Category
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">— none —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <div className="grid cols-2">
                <label>Unit Price (USD) <input type="number" step="0.01" min="0" required value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} /></label>
                <label>Unit Cost (USD) <input type="number" step="0.01" min="0" required value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></label>
                {!editing && (
                  <label>Opening Stock <input type="number" min="0" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
                )}
                <label>Low Stock Alert <input type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} /></label>
              </div>
              {editing && (
                <p className="muted small">Stock is managed via <strong>Stock in</strong> / POS / Damage — it is not edited here so inventory layers stay consistent.</p>
              )}
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</button>
                <button type="submit" className="btn primary">{editing ? "Save Changes" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStockIn && (
        <div className="modal-overlay" onClick={() => setShowStockIn(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Stock In — {showStockIn.name}</h2>
            <p className="muted small">Current stock: {showStockIn.stock} · Current avg cost: {usd(showStockIn.unit_cost)}</p>
            <form onSubmit={doStockIn}>
              <label>Quantity <input name="quantity" type="number" min="1" required /></label>
              <label>Unit Cost (USD) <input name="unit_cost" type="number" step="0.01" min="0.01" required /></label>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowStockIn(null)}>Cancel</button>
                <button type="submit" className="btn primary">Add Stock</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDamage && (
        <div className="modal-overlay" onClick={() => setShowDamage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Register Damage — {showDamage.name}</h2>
            <p className="muted small">
              Damage is valued at inventory cost (avg {usd(showDamage.unit_cost)}/unit), NOT selling price ({usd(showDamage.unit_price)}/unit).
              It reduces stock and records a loss at cost.
            </p>
            <form onSubmit={doDamage}>
              <label>Quantity Damaged <input name="quantity" type="number" min="1" max={showDamage.stock} required /></label>
              <label>Reason <input name="reason" type="text" placeholder="e.g. expired, broken, spilled" /></label>
              <div className="damage-preview">
                Estimated loss: <strong>{usd(showDamage.unit_cost * (Number((document.querySelector('input[name="quantity"]') as HTMLInputElement)?.value) || 0))}</strong>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn" onClick={() => setShowDamage(null)}>Cancel</button>
                <button type="submit" className="btn primary danger">Record Damage</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Product"
        message={`Delete "${confirmDelete?.name}"? Its inventory layers and movements will be removed. Products with sales history cannot be deleted (delete those sales first). This cannot be undone.`}
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={doDeleteProduct}
      />
    </div>
  );
}
