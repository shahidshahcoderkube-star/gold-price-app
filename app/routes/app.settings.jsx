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
        syncShopifyDomain: "",
        syncAccessToken: "",
      },
    });
  }

  return { settings, shop };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const syncShopifyDomain = formData.get("syncShopifyDomain")?.trim() || "";
  const syncAccessToken = formData.get("syncAccessToken")?.trim() || "";

  // Validation
  if (syncShopifyDomain && !syncShopifyDomain.includes("myshopify.com")) {
    return Response.json({ error: "Store Domain must be a valid .myshopify.com URL." }, { status: 400 });
  }

  const settings = await prisma.goldSettings.update({
    where: { shop },
    data: {
      syncShopifyDomain,
      syncAccessToken,
    },
  });

  return Response.json({
    success: true,
    message: "Shopify connection settings saved successfully!",
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
        .form-control {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #babfc3;
          border-radius: 5px;
          font-size: 14px;
          box-sizing: border-box;
          outline: none;
          color: #303030;
          font-family: inherit;
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
          font-family: inherit;
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
        .badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        .badge-success {
          background: #e6f4ea;
          color: #137333;
        }
        .text-muted {
          color: #6d7175;
          font-size: 12px;
          line-height: 1.6;
        }
        ol {
          padding-left: 20px;
          margin: 10px 0;
        }
        li {
          margin-bottom: 8px;
          font-size: 13px;
          color: #303030;
        }
      `}</style>

      <div className="header">
        <h1>Shopify Sync Settings</h1>
      </div>

      <div className="grid">
        {/* LEFT PANEL */}
        <div>
          <div className="card">
            <h2>
              Connect Your Shopify Store
              {settings.syncShopifyDomain && settings.syncAccessToken && (
                <span className="badge badge-success">Connected</span>
              )}
            </h2>
            
            <p className="text-muted" style={{ marginBottom: "20px" }}>
              Enter your Shopify store domain and a private app access token with read/write access to Products to automate dynamic gold pricing calculations.
            </p>

            <fetcher.Form method="post">
              <div className="form-group">
                <label htmlFor="syncShopifyDomain">Store Domain</label>
                <input
                  type="text"
                  id="syncShopifyDomain"
                  name="syncShopifyDomain"
                  placeholder="yourstore.myshopify.com"
                  className="form-control"
                  defaultValue={settings.syncShopifyDomain}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="syncAccessToken">Access Token</label>
                <input
                  type="password"
                  id="syncAccessToken"
                  name="syncAccessToken"
                  placeholder="shpat_xxxxxxxxxxxxxxxx"
                  className="form-control"
                  defaultValue={settings.syncAccessToken}
                  required
                />
              </div>

              <div style={{ marginTop: "20px" }}>
                <button type="submit" className="btn" disabled={isSubmitting}>
                  {isSubmitting ? "Connecting..." : "Connect & Save Settings"}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </div>

        {/* RIGHT PANEL (GUIDE) */}
        <div>
          <div className="card">
            <h2>Integration Help Guide</h2>
            <div className="text-muted">
              <p>To obtain your Store Domain and Access Token, follow these steps in your Shopify Admin:</p>
              <ol>
                <li>Go to <strong>Settings</strong> &gt; <strong>App and sales channels</strong>.</li>
                <li>Click <strong>Develop apps</strong> at the top.</li>
                <li>Click <strong>Create an app</strong> and name it (e.g., "Gold Price Sync").</li>
                <li>Under <strong>Configuration</strong>, configure Admin API scopes:
                  <ul>
                    <li>Select <strong>write_products</strong> and <strong>read_products</strong>.</li>
                  </ul>
                </li>
                <li>Under <strong>API credentials</strong>, click <strong>Install app</strong>.</li>
                <li>Reveal and copy the <strong>Admin API access token</strong> (starts with <code>shpat_</code>).</li>
                <li>Paste your copied token and store URL here.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
