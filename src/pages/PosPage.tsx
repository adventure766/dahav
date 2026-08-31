import { useEffect, useState, useMemo } from "react";
import { Minus, Plus, X, ArrowRight, CheckCircle2 } from "lucide-react";
import { getPb } from "../lib/pb";
import { api } from "../lib/api";
import { usd, ssp, rateLabel, fmt } from "../lib/currency";
import { cartTotals, paymentTotals } from "../lib/engine";
import { useAuthUser } from "../components/useAuthUser";
import type { Currency } from "../lib/engine";

interface Product {
  id: string;
  name: string;
  category: string;
  unit_price: number;
  unit_cost: number;
  stock: number;
  currency: string;
}

interface Category { id: string; name: string; }
interface Customer { id: string; name: string; }

interface CartLine {
  product: Product;
  quantity: number;
  /** Optional per-sale unit price override. When set, this line is sold at
   *  this price for this transaction only; the product's default price is
   *  never modified. */
  unit_price?: number;
}

interface CheckoutResult {
  transaction: { transaction_id: string };
  sale: { sale_id: string; total: number; amount_paid: number; amount_outstanding: number; status: string };
  payment: { payment_id: string; amount: number; currency: string; exchange_rate: number; amount_usd: number; tendered: number; change: number };
  receipt: { receipt_id: string };
  invoice: { invoice_id: string };
}

export function PosPage() {
  const user = useAuthUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [defaultRate, setDefaultRate] = useState(8000);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentCurrency, setPaymentCurrency] = useState<Currency>("SSP");
  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customRate, setCustomRate] = useState("");
  const [tendered, setTendered] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);

  useEffect(() => {
    const pb = getPb();
    Promise.all([
      pb.collection("products").getFullList<Product>({ filter: "active = true", sort: "name" }),
      pb.collection("product_categories").getFullList<Category>({ sort: "name" }),
      pb.collection("customers").getFullList<Customer>({ sort: "name" }),
      fetch(`${pb.baseUrl}/api/dahav/rates/default`).then((r) => r.json()),
    ]).then(([p, c, cu, rates]) => {
      setProducts(p);
      setCategories(c);
      setCustomers(cu);
      setDefaultRate(Number(rates.default_rate) || 8000);
    }).catch((e) => setError("Failed to load: " + e.message));
  }, []);

  const rate = useMemo(() => {
    if (useCustomRate) {
      const r = Number(customRate);
      return r > 0 ? r : 0;
    }
    return defaultRate;
  }, [useCustomRate, customRate, defaultRate]);

  const totals = useMemo(() => {
    return cartTotals(cart.map((l) => ({ unit_price: l.unit_price ?? l.product.unit_price, quantity: l.quantity })));
  }, [cart]);

  const paymentPreview = useMemo(() => {
    if (rate <= 0) return null;
    return paymentTotals({ total_usd: totals.total, payment_currency: paymentCurrency, rate, tendered: Number(tendered) || 0 });
  }, [totals.total, paymentCurrency, rate, tendered]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (catFilter && p.category !== catFilter) return false;
      const q = search.toLowerCase();
      return !q || p.name.toLowerCase().includes(q) || (p as unknown as { sku?: string }).sku?.toLowerCase().includes(q);
    });
  }, [products, search, catFilter]);

  const addToCart = (p: Product) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === p.id);
      if (existing) {
        if (existing.quantity >= p.stock) return prev;
        return prev.map((l) => (l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (p.stock <= 0) return prev;
      return [...prev, { product: p, quantity: 1 }];
    });
  };

  const setQty = (id: string, qty: number) => {
    setCart((prev) => {
      const line = prev.find((l) => l.product.id === id);
      if (!line) return prev;
      if (qty <= 0) return prev.filter((l) => l.product.id !== id);
      if (qty > line.product.stock) qty = line.product.stock;
      return prev.map((l) => (l.product.id === id ? { ...l, quantity: qty } : l));
    });
  };

  /** Set a per-sale unit price override for a cart line. Empty/invalid values
   *  revert to the product's default price. The product master price is never
   *  touched — the override lives only on this cart line for this transaction. */
  const setUnitPrice = (id: string, value: string) => {
    setCart((prev) => prev.map((l) => {
      if (l.product.id !== id) return l;
      const n = Number(value);
      if (value === "" || !(n > 0)) return { ...l, unit_price: undefined };
      return { ...l, unit_price: n };
    }));
  };

  const removeLine = (id: string) => setCart((prev) => prev.filter((l) => l.product.id !== id));

  const checkout = async () => {
    if (!paymentPreview) return;
    setBusy(true); setError("");
    const r = await api<CheckoutResult>("/api/dahav/pos/checkout", {
      method: "POST",
      body: {
        items: cart.map((l) => ({
          product_id: l.product.id,
          quantity: l.quantity,
          ...(l.unit_price !== undefined ? { unit_price: l.unit_price } : {}),
        })),
        customer_id: customerId || undefined,
        payment_method: "cash",
        payment_currency: paymentCurrency,
        exchange_rate: rate,
        tendered: paymentCurrency === "SSP" ? paymentPreview.tendered : paymentPreview.tendered,
        paid_amount: undefined, // full payment
      },
    });
    setBusy(false);
    if (r.status !== 200) {
      setError((r.data as { error?: string }).error || "Checkout failed");
      return;
    }
    setResult(r.data);
    setCart([]);
    setShowPayment(false);
    setTendered("");
    setCustomRate("");
    setUseCustomRate(false);
    // Refresh stock levels
    getPb().collection("products").getFullList<Product>({ filter: "active = true", sort: "name" })
      .then(setProducts).catch(() => {});
  };

  return (
    <div className="pos-layout">
      <div className="pos-products">
        <div className="page-head">
          <h1>Point of Sale</h1>
        </div>
        <input
          className="pos-search"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="category-chips">
          <button className={`chip ${catFilter === "" ? "active" : ""}`} onClick={() => setCatFilter("")}>All</button>
          {categories.map((c) => (
            <button key={c.id} className={`chip ${catFilter === c.id ? "active" : ""}`} onClick={() => setCatFilter(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="product-grid">
          {filtered.map((p) => (
            <div key={p.id} className={`product-card ${p.stock <= 0 ? "out" : ""}`} onClick={() => addToCart(p)}>
              <div className="name">{p.name}</div>
              <div className="price">{fmt(p.unit_price, p.currency as Currency)}</div>
              <div className="stock">{p.stock <= 0 ? "Out of stock" : `${p.stock} in stock`}</div>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty">No products match</div>}
        </div>
      </div>

      <div className="cart-panel">
        <div className="cart-items">
          <h3 style={{ margin: "0 0 8px" }}>Cart</h3>
          {cart.map((l) => (
            <div className="cart-line" key={l.product.id}>
              <div className="cart-line-main">
                <div className="name">
                  {l.product.name}
                  {l.unit_price !== undefined && <span className="badge blue price-badge">custom</span>}
                </div>
                <div className="price-edit">
                  <span className="muted small">Unit price</span>
                  <input
                    className={l.unit_price !== undefined ? "custom-price-input" : ""}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={String(l.product.unit_price)}
                    defaultValue=""
                    key={l.product.id + "-" + (l.unit_price ?? "")}
                    onChange={(e) => setUnitPrice(l.product.id, e.target.value)}
                    aria-label={`Unit price for ${l.product.name}`}
                  />
                  {l.unit_price !== undefined && (
                    <button
                      className="btn small ghost"
                      onClick={() => setUnitPrice(l.product.id, "")}
                      aria-label="Reset price to default"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="qty">
                <button className="qty-btn" onClick={() => setQty(l.product.id, l.quantity - 1)} aria-label="Decrease quantity"><Minus size={15} /></button>
                <span>{l.quantity}</span>
                <button className="qty-btn" onClick={() => setQty(l.product.id, l.quantity + 1)} aria-label="Increase quantity"><Plus size={15} /></button>
              </div>
              <div className="money-usd">{usd((l.unit_price ?? l.product.unit_price) * l.quantity)}</div>
              <button className="btn small ghost" onClick={() => removeLine(l.product.id)} aria-label="Remove item"><X size={15} /></button>
            </div>
          ))}
          {cart.length === 0 && <div className="empty">Cart is empty — tap a product to add it.</div>}
        </div>

        <div className="cart-totals">
          <div className="totals-row"><span>Subtotal</span><span className="money-usd">{usd(totals.subtotal)}</span></div>
          <div className="totals-row grand"><span>Total</span><span className="money-usd">{usd(totals.total)}</span></div>
        </div>

        <div className="cart-actions">
          <button className="btn ghost small" onClick={() => setCart([])} disabled={cart.length === 0}>Clear</button>
          <button className="btn primary block" disabled={cart.length === 0} onClick={() => { setError(""); setShowPayment(true); }}>
            Checkout <ArrowRight size={16} style={{ verticalAlign: "-2px", marginLeft: 5 }} />
          </button>
        </div>
      </div>

      {showPayment && (
        <div className="modal-overlay" onClick={() => setShowPayment(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Payment</h2>
            <div className="totals-row grand"><span>Total</span><span className="money-usd">{usd(totals.total)}</span></div>

            <label>Customer
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in customer</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <label>Payment Currency
              <select value={paymentCurrency} onChange={(e) => setPaymentCurrency(e.target.value as Currency)}>
                <option value="USD">USD ($)</option>
                <option value="SSP">SSP</option>
              </select>
            </label>

            <div className="card" style={{ marginBottom: 12 }}>
              <label className="rate-toggle">
                <input type="checkbox" checked={useCustomRate} onChange={(e) => setUseCustomRate(e.target.checked)} />
                Use custom exchange rate for this transaction
              </label>
              {useCustomRate ? (
                <label>Exchange Rate (1 USD = X SSP)
                  <input type="number" min="0.0001" step="any" value={customRate} onChange={(e) => setCustomRate(e.target.value)} placeholder={String(defaultRate)} />
                </label>
              ) : (
                <p className="muted small">Using default rate: {rateLabel(defaultRate)}</p>
              )}
            </div>

            {paymentPreview && rate > 0 ? (
              <>
                <div className="totals-row">
                  <span>Amount due ({paymentCurrency})</span>
                  <span className={paymentCurrency === "SSP" ? "money-ssp" : "money-usd"}>
                    {paymentCurrency === "SSP" ? ssp(paymentPreview.amount_due) : usd(paymentPreview.amount_due)}
                  </span>
                </div>
                <div className="totals-row muted small">
                  <span>USD equivalent</span><span className="money-usd">{usd(paymentPreview.amount_usd)}</span>
                </div>
                <label>Amount Tendered ({paymentCurrency})
                  <input type="number" step="any" min="0" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(paymentPreview.amount_due)} />
                </label>
                {Number(tendered) > 0 && (
                  <div className="totals-row">
                    <span>Change ({paymentCurrency})</span>
                    <span className={paymentCurrency === "SSP" ? "money-ssp" : "money-usd"}>
                      {paymentCurrency === "SSP" ? ssp(paymentPreview.change) : usd(paymentPreview.change)}
                    </span>
                  </div>
                )}
                {Number(tendered) > 0 && paymentPreview.change === 0 && Number(tendered) < paymentPreview.amount_due && (
                  <p className="muted small" style={{ color: "var(--danger)" }}>
                    Tendered is less than the amount due — the customer will owe {paymentCurrency === "SSP" ? ssp(paymentPreview.amount_due - Number(tendered)) : usd(paymentPreview.amount_due - Number(tendered))}.
                  </p>
                )}
              </>
            ) : (
              <p className="alert error">Set a valid exchange rate.</p>
            )}

            {error && <div className="alert error">{error}</div>}

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowPayment(false)}>Back</button>
              <button className="btn primary" disabled={busy || !paymentPreview || rate <= 0} onClick={checkout}>
                {busy ? "Processing…" : "Complete Sale"}
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="modal-overlay">
          <div className="modal pop-in">
            <h2><CheckCircle2 size={22} style={{ verticalAlign: "-4px", marginRight: 8, color: "var(--success)" }} />Sale Complete</h2>
            <div className="receipt">
              <div className="company">DAHAV General Trading Co. Ltd</div>
              <div className="divider" />
              <div className="row"><span>Receipt</span><span>{result.receipt.receipt_id}</span></div>
              <div className="row"><span>Transaction</span><span>{result.transaction.transaction_id}</span></div>
              <div className="row"><span>Invoice</span><span>{result.invoice.invoice_id}</span></div>
              <div className="row"><span>Sale</span><span>{result.sale.sale_id}</span></div>
              <div className="row"><span>Cashier</span><span>{user?.name || ""}</span></div>
              <div className="divider" />
              <div className="row grand"><span>Total</span><span className="money-usd">{usd(result.sale.total)}</span></div>
              {result.payment && (
                <>
                  <div className="row"><span>Paid in</span><span>{result.payment.currency}</span></div>
                  <div className="row"><span>Exchange rate</span><span>{rateLabel(result.payment.exchange_rate)}</span></div>
                  <div className="row">
                    <span>Amount paid</span>
                    <span className={result.payment.currency === "SSP" ? "money-ssp" : "money-usd"}>
                      {result.payment.currency === "SSP" ? ssp(result.payment.amount) : usd(result.payment.amount)}
                    </span>
                  </div>
                  <div className="row"><span>USD equivalent</span><span className="money-usd">{usd(result.payment.amount_usd)}</span></div>
                  <div className="row"><span>Change</span>
                    <span className={result.payment.currency === "SSP" ? "money-ssp" : "money-usd"}>
                      {result.payment.currency === "SSP" ? ssp(result.payment.change) : usd(result.payment.change)}
                    </span>
                  </div>
                </>
              )}
              <div className="row"><span>Total Paid</span><span className="money-usd">{usd(result.sale.amount_paid)}</span></div>
              <div className="row"><span>Outstanding</span><span className="money-usd">{usd(result.sale.amount_outstanding)}</span></div>
              <div className="row"><span>Status</span><span className={`badge ${result.sale.amount_outstanding > 0 ? "yellow" : "green"}`}>{result.sale.amount_outstanding > 0 ? "Partially Paid" : "Paid"}</span></div>
            </div>
            <div className="modal-actions">
              <button className="btn primary block" onClick={() => setResult(null)}>New Sale</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
