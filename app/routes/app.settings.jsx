import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

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

  return { settings, shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
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

  const settings = await prisma.goldSettings.update({
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

  return Response.json({
    success: true,
    message: "Pricing settings saved successfully!",
    settings,
  });
};

export default function SettingsPage() {
  const { settings: initialSettings, shop } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [settings, setSettings] = useState(initialSettings);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data) {
      if (fetcher.data.success) {
        shopify.toast.show(fetcher.data.message || "Settings saved!");
        if (fetcher.data.settings) {
          setSettings(fetcher.data.settings);
        }
      } else if (fetcher.data.error) {
        shopify.toast.show(fetcher.data.error, { isError: true });
      }
    }
  }, [fetcher.data, shopify]);

  if (!mounted) return null;

  const handleSaveSettings = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    fetcher.submit(data, { method: "POST" });
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
        .btn:disabled {
          background: #e1e3e5;
          border-color: #e1e3e5;
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
        .text-muted {
          color: #6d7175;
          font-size: 12px;
        }
      `}</style>

      <div className="header">
        <h1>Global Configurations Settings</h1>
      </div>

      <form onSubmit={handleSaveSettings}>
        <div className="grid">
          {/* LEFT PANEL */}
          <div>
            <div className="card">
              <h2>Gold Price Margins & Charges</h2>
              
              <div className="form-group">
                <label>Making Charge</label>
                <div className="input-row">
                  <select
                    name="makingChargeType"
                    className="form-control"
                    style={{ width: "60%" }}
                    defaultValue={settings.makingChargeType}
                  >
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
                  <select
                    name="profitMarginType"
                    className="form-control"
                    style={{ width: "60%" }}
                    defaultValue={settings.profitMarginType}
                  >
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
            </div>

            <div className="card">
              <h2>Minimum Safe Floor Rates (Stop-Loss)</h2>
              <p className="text-muted" style={{ marginBottom: "15px" }}>
                Ensure calculations never fall below these minimum thresholds even if the global metal market drops.
              </p>

              <div className="form-group">
                <label className="text-muted">24K Minimum (per gram)</label>
                <input
                  type="number"
                  step="0.01"
                  name="minRate24K"
                  className="form-control"
                  defaultValue={settings.minRate24K}
                />
              </div>
              <div className="form-group">
                <label className="text-muted">22K Minimum (per gram)</label>
                <input
                  type="number"
                  step="0.01"
                  name="minRate22K"
                  className="form-control"
                  defaultValue={settings.minRate22K}
                />
              </div>
              <div className="form-group">
                <label className="text-muted">18K Minimum (per gram)</label>
                <input
                  type="number"
                  step="0.01"
                  name="minRate18K"
                  className="form-control"
                  defaultValue={settings.minRate18K}
                />
              </div>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div>
            <div className="card">
              <h2>Automation Scheduler & Safety</h2>
              
              <div className="form-group">
                <label>Sync Scheduler Settings</label>
                <select name="updateFrequency" className="form-control" defaultValue={settings.updateFrequency}>
                  <option value="daily">Daily Updates (8:00 AM)</option>
                  <option value="hourly">Hourly Updates</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: "20px" }}>
                <label>Safety Controls</label>
                
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    name="blockPriceDecreases"
                    value="true"
                    defaultChecked={settings.blockPriceDecreases}
                  />
                  <span>Block Price Decreases (Safety Lock)</span>
                </label>

                <label className="checkbox-label" style={{ marginTop: "12px" }}>
                  <input
                    type="checkbox"
                    name="autoPushOnIncrease"
                    value="true"
                    defaultChecked={settings.autoPushOnIncrease}
                  />
                  <span>Auto Push On Gold Increase</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: "20px" }}>
              <button type="submit" className="btn" style={{ width: "100%" }} disabled={isSubmitting}>
                {isSubmitting ? "Saving Config..." : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
