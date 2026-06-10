import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { fetchGoldRates, getEffectiveRates } from "../gold.server";
import { fetchGoldProducts, syncProductPrices, ensureMetafieldDefinitions, getAdminClient } from "../shopify.products.server";

export const loader = async ({ request }) => {
  const { admin: sessionAdmin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Get Settings or create default
  let settings = await prisma.goldSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.goldSettings.create({
      data: {
        shop,
        apiKey: "",
        apiProvider: "goldapi",
        makingChargeType: "percentage",
        makingChargeValue: 0.0,
        profitMarginType: "percentage",
        profitMarginValue: 0.0,
        minRate24K: 0.0,
        minRate22K: 0.0,
        minRate18K: 0.0,
        blockPriceDecreases: false,
        autoPushOnIncrease: true,
        updateFrequency: "daily",
      },
    });
  }

  // Wrap admin client with getAdminClient
  const admin = getAdminClient(sessionAdmin, settings);

  // Automatically ensure that metafield definitions exist for the store (using either session or custom credentials)
  try {
    await ensureMetafieldDefinitions(admin);
  } catch (err) {
    console.error("Error ensuring gold metafield definitions:", err);
  }

  // 2. Get Cached Rates
  const rateCache = await prisma.goldRateCache.findUnique({ where: { shop } });

  // 3. Get Logs
  const logs = await prisma.goldActivityLog.findMany({
    where: { shop },
    orderBy: { timestamp: "desc" },
    take: 15,
  });

  // 4. Get Products
  let products = [];
  try {
    products = await fetchGoldProducts(admin);
  } catch (err) {
    console.error("Error fetching Shopify products:", err);
  }

  return {
    settings,
    rateCache,
    logs,
    products,
    shop,
  };
};

export const action = async ({ request }) => {
  const { admin: sessionAdmin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  let settings = await prisma.goldSettings.findUnique({ where: { shop } });
  if (!settings) {
    return Response.json({ error: "Settings not found." }, { status: 400 });
  }

  const admin = getAdminClient(sessionAdmin, settings);


  if (intent === "save_settings") {
    const makingChargeType = formData.get("makingChargeType") || "percentage";
    const makingChargeValue = parseFloat(formData.get("makingChargeValue")) || 0;
    const profitMarginType = formData.get("profitMarginType") || "percentage";
    const profitMarginValue = parseFloat(formData.get("profitMarginValue")) || 0;
    const minRate24K = parseFloat(formData.get("minRate24K")) || 0;
    const minRate22K = parseFloat(formData.get("minRate22K")) || 0;
    const minRate18K = parseFloat(formData.get("minRate18K")) || 0;
    const blockPriceDecreases = formData.get("blockPriceDecreases") === "true";
    const autoPushOnIncrease = formData.get("autoPushOnIncrease") === "true";
    const updateFrequency = formData.get("updateFrequency") || "daily";

    settings = await prisma.goldSettings.update({
      where: { shop },
      data: {
        makingChargeType,
        makingChargeValue,
        profitMarginType,
        profitMarginValue,
        minRate24K,
        minRate22K,
        minRate18K,
        blockPriceDecreases,
        autoPushOnIncrease,
        updateFrequency,
      },
    });

    return Response.json({ success: true, message: "Settings saved successfully!", settings });
  }

  if (intent === "fetch_rates") {
    try {
      const liveRates = await fetchGoldRates(settings);

      const updatedCache = await prisma.goldRateCache.upsert({
        where: { shop },
        create: {
          shop,
          rate24K: liveRates.rate24K,
          rate22K: liveRates.rate22K,
          rate18K: liveRates.rate18K,
        },
        update: {
          rate24K: liveRates.rate24K,
          rate22K: liveRates.rate22K,
          rate18K: liveRates.rate18K,
        },
      });

      return Response.json({ success: true, message: "Rates fetched successfully!", rateCache: updatedCache });
    } catch (err) {
      return Response.json({ error: err.message || "Failed to fetch live rates." }, { status: 500 });
    }
  }

  if (intent === "sync_selected" || intent === "sync_all") {
    let targetProductIds = null;
    if (intent === "sync_selected") {
      const selectedIdsStr = formData.get("selectedProductIds");
      if (!selectedIdsStr) {
        return Response.json({ error: "No products selected." }, { status: 400 });
      }
      targetProductIds = JSON.parse(selectedIdsStr);
    }

    try {
      const liveRates = await fetchGoldRates(settings);
      const effectiveRates = getEffectiveRates(liveRates, settings);

      const updatedCount = await syncProductPrices(admin, settings, effectiveRates, targetProductIds);

      await prisma.goldRateCache.upsert({
        where: { shop },
        create: {
          shop,
          rate24K: liveRates.rate24K,
          rate22K: liveRates.rate22K,
          rate18K: liveRates.rate18K,
        },
        update: {
          rate24K: liveRates.rate24K,
          rate22K: liveRates.rate22K,
          rate18K: liveRates.rate18K,
        },
      });

      await prisma.goldActivityLog.create({
        data: {
          shop,
          status: "SUCCESS",
          rate24K: liveRates.rate24K,
          rate22K: liveRates.rate22K,
          rate18K: liveRates.rate18K,
          productsUpdatedCount: updatedCount,
        },
      });

      return Response.json({
        success: true,
        message: `Successfully synchronized prices! ${updatedCount} variant(s) updated.`,
      });
    } catch (err) {
      await prisma.goldActivityLog.create({
        data: {
          shop,
          status: "FAILED",
          rate24K: 0.0,
          rate22K: 0.0,
          rate18K: 0.0,
          productsUpdatedCount: 0,
          errorMessage: err.message || "Unknown error occurred.",
        },
      });

      return Response.json({ error: err.message || "Failed to synchronize product prices." }, { status: 500 });
    }
  }

  return Response.json({ error: "Invalid intent." }, { status: 400 });
};

export default function Index() {
  const { settings: initialSettings, rateCache: initialRateCache, logs, products, shop } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [settings, setSettings] = useState(initialSettings);
  const [rateCache, setRateCache] = useState(initialRateCache);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [karatFilter, setKaratFilter] = useState("ALL");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isSubmitting = fetcher.state !== "idle";

  // Display Toast alerts based on action output
  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        shopify.toast.show(fetcher.data.message || "Operation successful!");
        if (fetcher.data.settings) {
          setSettings(fetcher.data.settings);
        }
        if (fetcher.data.rateCache) {
          setRateCache(fetcher.data.rateCache);
        }
      } else if (fetcher.data.error) {
        shopify.toast.show(fetcher.data.error, { isError: true });
      }
    }
  }, [fetcher.data, shopify]);

  const handleSaveSettings = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    data.append("intent", "save_settings");
    fetcher.submit(data, { method: "POST" });
  };

  const handleFetchRates = () => {
    const data = new FormData();
    data.append("intent", "fetch_rates");
    fetcher.submit(data, { method: "POST" });
  };

  const handleSyncAll = () => {
    const data = new FormData();
    data.append("intent", "sync_all");
    fetcher.submit(data, { method: "POST" });
  };

  const handleSyncSelected = () => {
    if (selectedProductIds.length === 0) {
      shopify.toast.show("Please select at least one product.", { isError: true });
      return;
    }
    const data = new FormData();
    data.append("intent", "sync_selected");
    data.append("selectedProductIds", JSON.stringify(selectedProductIds));
    fetcher.submit(data, { method: "POST" });
  };

  // Filter products client-side
  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesKarat = karatFilter === "ALL" || product.karat === karatFilter;
    return matchesSearch && matchesKarat;
  });

  const toggleSelectProduct = (productId) => {
    if (selectedProductIds.includes(productId)) {
      setSelectedProductIds(selectedProductIds.filter((id) => id !== productId));
    } else {
      setSelectedProductIds([...selectedProductIds, productId]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedProductIds.length === filteredProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredProducts.map((p) => p.id));
    }
  };

  // Calculate pricing simulation for display
  const simulatePrice = (weight, karat) => {
    if (!rateCache) return "—";

    // Get live rate or stop loss
    let marketRate = 0;
    let floorRate = 0;
    if (karat === "24K") {
      marketRate = rateCache.rate24K;
      floorRate = settings.minRate24K;
    } else if (karat === "22K") {
      marketRate = rateCache.rate22K;
      floorRate = settings.minRate22K;
    } else if (karat === "18K") {
      marketRate = rateCache.rate18K;
      floorRate = settings.minRate18K;
    }

    const rate = Math.max(marketRate, floorRate);
    if (!rate) return "—";

    const goldCost = rate * weight;
    let makingCharges = settings.makingChargeType === "percentage"
      ? goldCost * (settings.makingChargeValue / 100)
      : settings.makingChargeValue;

    const costBasis = goldCost + makingCharges;
    let profitMargin = settings.profitMarginType === "percentage"
      ? costBasis * (settings.profitMarginValue / 100)
      : settings.profitMarginValue;

    return Math.round((costBasis + profitMargin) * 100) / 100;
  };

  return (
    <div className="gold-app-container">
      <style>{`
        .gold-app-container {
          font-family: var(--p-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol");
          padding: 20px;
          background: #f6f6f7;
          min-height: 100vh;
          color: #202223;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .header h1 {
          font-size: 24px;
          font-weight: 600;
          color: #202223;
        }
        .grid {
          display: grid;
          grid-template-columns: 2fr 1fr;
          gap: 20px;
        }
        @media (max-width: 900px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
        .card {
          background: #ffffff;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
          padding: 20px;
          margin-bottom: 20px;
        }
        .card h2 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
          color: #202223;
          border-bottom: 1px solid #e1e3e5;
          padding-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .rate-boxes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin-bottom: 15px;
        }
        .rate-box {
          background: #fafbfb;
          border: 1px solid #e1e3e5;
          border-radius: 6px;
          padding: 15px;
          text-align: center;
        }
        .rate-box .label {
          font-size: 12px;
          color: #6d7175;
          margin-bottom: 5px;
          font-weight: 500;
        }
        .rate-box .value {
          font-size: 20px;
          font-weight: 700;
          color: #D4AF37;
        }
        .form-group {
          margin-bottom: 15px;
        }
        .form-group label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 6px;
          color: #303030;
        }
        .input-row {
          display: flex;
          gap: 10px;
        }
        .form-control, .btn, select, input, button {
          font-family: inherit;
        }
        .form-control {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #babfc3;
          border-radius: 5px;
          font-size: 14px;
          box-sizing: border-box;
          outline: none;
          color: #303030;
        }
        .form-control:focus {
          border-color: #303030;
        }
        .btn {
          background: #303030;
          color: white;
          border: 1px solid #303030;
          padding: 8px 16px;
          border-radius: 5px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .btn:hover {
          background: #1a1a1a;
          border-color: #1a1a1a;
        }
        .btn-secondary {
          background: #ffffff;
          color: #202223;
          border: 1px solid #babfc3;
        }
        .btn-secondary:hover {
          background: #f6f6f7;
        }
        .btn:disabled {
          background: #e1e3e5;
          border-color: #e1e3e5;
          color: #8c9196;
          cursor: not-allowed;
        }
        .btn-secondary:disabled {
          background: #fafbfb;
          color: #8c9196;
          cursor: not-allowed;
        }
        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 13px;
          margin-top: 10px;
        }
        .checkbox-label input {
          width: 16px;
          height: 16px;
        }
        .products-toolbar {
          display: flex;
          gap: 15px;
          margin-bottom: 15px;
          align-items: center;
        }
        .table-responsive {
          overflow-x: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        th, td {
          padding: 12px;
          border-bottom: 1px solid #e1e3e5;
          font-size: 13px;
        }
        th {
          background: #fafbfb;
          font-weight: 600;
          color: #6d7175;
        }
        .badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge-success { background: #e6f4ea; color: #137333; }
        .badge-warning { background: #fef7e0; color: #b06000; }
        .badge-danger { background: #fce8e6; color: #c5221f; }
        .flex-center {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .text-muted {
          color: #6d7175;
          font-size: 12px;
        }
      `}</style>

      <div className="header">
        <h1>Gold Price Automation Dashboard</h1>
        <div className="flex-center">
          <button
            className="btn btn-secondary"
            onClick={handleSyncAll}
            disabled={isSubmitting || !rateCache}
          >
            {isSubmitting ? "Syncing..." : "Sync All Store Prices"}
          </button>
        </div>
      </div>

      <div className="grid">
        {/* LEFT PANEL */}
        <div>
          {/* LIVE GOLD RATES CARD */}
          <div className="card">
            <h2>
              Live Gold Rates (per gram)
              <button
                className="btn btn-secondary"
                style={{ padding: "4px 10px", fontSize: "12px" }}
                onClick={handleFetchRates}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Updating..." : "Fetch Live Rates"}
              </button>
            </h2>
            {rateCache ? (
              <div>
                <div className="rate-boxes">
                  <div className="rate-box">
                    <div className="label">24K Gold</div>
                    <div className="value">${rateCache.rate24K.toFixed(2)}</div>
                    {rateCache.rate24K < settings.minRate24K && (
                      <span className="badge badge-warning" style={{ marginTop: "5px" }}>Using Floor: ${settings.minRate24K}</span>
                    )}
                  </div>
                  <div className="rate-box">
                    <div className="label">22K Gold</div>
                    <div className="value">${rateCache.rate22K.toFixed(2)}</div>
                    {rateCache.rate22K < settings.minRate22K && (
                      <span className="badge badge-warning" style={{ marginTop: "5px" }}>Using Floor: ${settings.minRate22K}</span>
                    )}
                  </div>
                  <div className="rate-box">
                    <div className="label">18K Gold</div>
                    <div className="value">${rateCache.rate18K.toFixed(2)}</div>
                    {rateCache.rate18K < settings.minRate18K && (
                      <span className="badge badge-warning" style={{ marginTop: "5px" }}>Using Floor: ${settings.minRate18K}</span>
                    )}
                  </div>
                </div>
                <div className="text-muted" style={{ textAlign: "right" }}>
                  Last Checked: {mounted ? new Date(rateCache.updatedAt).toLocaleString() : "Loading..."}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "20px", color: "#6d7175" }}>
                No rates cached yet. Click "Fetch Live Rates" to fetch gold rates.
              </div>
            )}
          </div>

          {/* PRODUCTS SELECTIVE SYNC TABLE */}
          <div className="card">
            <h2>Selective Product Sync & Testing</h2>
            <div className="products-toolbar">
              <input
                type="text"
                placeholder="Search products..."
                className="form-control"
                style={{ width: "250px" }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <select
                className="form-control"
                style={{ width: "150px" }}
                value={karatFilter}
                onChange={(e) => setKaratFilter(e.target.value)}
              >
                <option value="ALL">All Karats</option>
                <option value="24K">24K</option>
                <option value="22K">22K</option>
                <option value="18K">18K</option>
              </select>
              <button
                className="btn"
                disabled={isSubmitting || selectedProductIds.length === 0}
                onClick={handleSyncSelected}
              >
                Sync Selected ({selectedProductIds.length})
              </button>
            </div>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: "40px" }}>
                      <input
                        type="checkbox"
                        checked={filteredProducts.length > 0 && selectedProductIds.length === filteredProducts.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Product</th>
                    <th>Karat</th>
                    <th>Weight</th>
                    <th>Store Price</th>
                    <th>New Calculated Price</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.length > 0 ? (
                    filteredProducts.map((product) => {
                      const calculatedPrice = simulatePrice(product.weight, product.karat);

                      return (
                        <tr key={product.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedProductIds.includes(product.id)}
                              onChange={() => toggleSelectProduct(product.id)}
                            />
                          </td>
                          <td>
                            <div className="flex-center">
                              {product.imageUrl && (
                                <img
                                  src={product.imageUrl}
                                  alt=""
                                  style={{ width: "32px", height: "32px", borderRadius: "4px", objectFit: "cover" }}
                                />
                              )}
                              <div>
                                <div style={{ fontWeight: "500" }}>{product.title}</div>
                                <div className="text-muted">Variants: {product.variants.length}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="badge" style={{ background: "#f1f2f4", color: "#454f5b" }}>{product.karat}</span>
                          </td>
                          <td>{product.weight.toFixed(2)}g</td>
                          <td>
                            {product.variants.length === 1
                              ? `$${product.variants[0].currentPrice.toFixed(2)}`
                              : `$${Math.min(...product.variants.map(v => v.currentPrice)).toFixed(2)} - $${Math.max(...product.variants.map(v => v.currentPrice)).toFixed(2)}`
                            }
                          </td>
                          <td style={{ fontWeight: "600", color: "#008060" }}>
                            {calculatedPrice !== "—" ? `$${calculatedPrice.toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="6" style={{ textAlign: "center", padding: "30px", color: "#6d7175" }}>
                        No gold products found. Make sure products have metafields `custom.gold_weight` and `custom.gold_karat` filled out.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL (SETTINGS & LOGS) */}
        <div>
          {/* SETTINGS CARD */}
          <div className="card">
            <h2>Configuration Panel</h2>
            <form onSubmit={handleSaveSettings}>
              <div className="form-group">
                <label>Making Charge</label>
                <div className="input-row">
                  <select name="makingChargeType" className="form-control" style={{ width: "60%" }} defaultValue={settings.makingChargeType}>
                    <option value="percentage">Percentage (%)</option>
                    <option value="flat">Flat Price ($)</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    name="makingChargeValue"
                    className="form-control"
                    placeholder="Value"
                    defaultValue={settings.makingChargeValue}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Profit Margin</label>
                <div className="input-row">
                  <select name="profitMarginType" className="form-control" style={{ width: "60%" }} defaultValue={settings.profitMarginType}>
                    <option value="percentage">Percentage (%)</option>
                    <option value="flat">Flat Price ($)</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    name="profitMarginValue"
                    className="form-control"
                    placeholder="Value"
                    defaultValue={settings.profitMarginValue}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: "15px" }}>
                <label style={{ fontWeight: "600" }}>Minimum Safe Floor Rates (Stop-Loss)</label>
                <div className="form-group">
                  <label className="text-muted">24K Minimum (per gram)</label>
                  <input type="number" step="0.01" name="minRate24K" className="form-control" defaultValue={settings.minRate24K} />
                </div>
                <div className="form-group">
                  <label className="text-muted">22K Minimum (per gram)</label>
                  <input type="number" step="0.01" name="minRate22K" className="form-control" defaultValue={settings.minRate22K} />
                </div>
                <div className="form-group">
                  <label className="text-muted">18K Minimum (per gram)</label>
                  <input type="number" step="0.01" name="minRate18K" className="form-control" defaultValue={settings.minRate18K} />
                </div>
              </div>

              <div className="form-group">
                <label>Sync Scheduler Settings</label>
                <select name="updateFrequency" className="form-control" defaultValue={settings.updateFrequency}>
                  <option value="daily">Daily Updates (8:00 AM)</option>
                  <option value="hourly">Hourly Updates</option>
                </select>
              </div>

              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="blockPriceDecreases"
                    value="true"
                    defaultChecked={settings.blockPriceDecreases}
                  />
                  <span>Block Price Decreases (Safety Lock)</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="autoPushOnIncrease"
                    value="true"
                    defaultChecked={settings.autoPushOnIncrease}
                  />
                  <span>Auto Push On Gold Increase</span>
                </label>
              </div>

              <button type="submit" className="btn" style={{ width: "100%", marginTop: "10px" }} disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Save Settings"}
              </button>
            </form>
          </div>

          {/* ACTIVITY LOGS */}
          <div className="card">
            <h2>Recent Activity Logs</h2>
            <div className="table-responsive">
              <table style={{ fontSize: "12px" }}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length > 0 ? (
                    logs.map((log) => (
                      <tr key={log.id}>
                        <td>
                          {mounted ? (
                            <>
                              <div>{new Date(log.timestamp).toLocaleDateString()}</div>
                              <div className="text-muted">{new Date(log.timestamp).toLocaleTimeString()}</div>
                            </>
                          ) : (
                            <div>Loading...</div>
                          )}
                        </td>
                        <td>
                          <span className={`badge badge-${log.status === "SUCCESS" ? "success" : "danger"}`}>
                            {log.status}
                          </span>
                        </td>
                        <td>
                          {log.status === "SUCCESS" ? (
                            <span>{log.productsUpdatedCount} variant(s)</span>
                          ) : (
                            <span className="text-muted" title={log.errorMessage}>Error details</span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3" style={{ textAlign: "center", padding: "20px", color: "#6d7175" }}>
                        No logs recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// React Router boundary hooks
export function ErrorBoundary() {
  return boundary.error();
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
