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
          font-family: var(--p-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
          padding: 20px;
          background: #f6f6f7;
          min-height: 100vh;
          color: #202223;
        }
        .header {
          margin-bottom: 24px;
        }
        .header h1 {
          font-size: 24px;
          font-weight: 600;
          color: #202223;
          margin: 0;
        }
        .header p {
          font-size: 14px;
          color: #6d7175;
          margin: 4px 0 0 0;
        }
        .card {
          background: #ffffff;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
          padding: 24px;
          max-width: 900px;
          margin: 20px auto;
        }
        .card h2 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 8px;
          color: #202223;
          border-bottom: 1px solid #e1e3e5;
          padding-bottom: 12px;
          margin-top: 0;
        }
        .card-description {
          font-size: 13px;
          color: #6d7175;
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 24px;
        }
        @media (max-width: 600px) {
          .form-row {
            grid-template-columns: 1fr;
          }
        }
        .form-group {
          display: flex;
          flex-direction: column;
        }
        .form-group label {
          font-size: 13px;
          font-weight: 600;
          color: #303030;
          margin-bottom: 6px;
        }
        .form-group input {
          font-family: inherit;
          padding: 10px 12px;
          border: 1px solid #babfc3;
          border-radius: 6px;
          font-size: 14px;
          color: #303030;
          background-color: #fff;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }
        .form-group input:focus {
          border-color: #b48a04;
          box-shadow: 0 0 0 2px rgba(180, 138, 4, 0.15);
        }
        .btn-gold {
          background-color: #b48a04;
          color: white;
          border: 1px solid #b48a04;
          border-radius: 6px;
          padding: 10px 20px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s, border-color 0.2s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .btn-gold:hover {
          background-color: #967102;
          border-color: #967102;
        }
        .btn-gold:disabled {
          background-color: #e1e3e5;
          border-color: #e1e3e5;
          color: #8c9196;
          cursor: not-allowed;
        }
        .alert-connected {
          background-color: #faf8f0;
          border: 1px solid #eedea6;
          color: #705500;
          border-radius: 6px;
          padding: 12px 16px;
          font-size: 13px;
          margin-bottom: 20px;
          font-weight: 500;
        }
      `}</style>

      <div className="header" style={{ maxWidth: "900px", margin: "0 auto 20px auto" }}>
        <h1>Shopify Sync</h1>
        <p>Centralized gold rate management for your entire store</p>
      </div>

      <div className="card">
        <h2>CONNECT YOUR SHOPIFY STORE</h2>
        <p className="card-description">
          Enter your Shopify store domain and a private app access token with read/write access to Products.
        </p>

        {settings.syncShopifyDomain && settings.syncAccessToken ? (
          <div className="alert-connected">
            ✓ Currently connected to store: <strong>{settings.syncShopifyDomain}</strong>
          </div>
        ) : null}

        <fetcher.Form method="post">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="syncShopifyDomain">Store Domain</label>
              <input
                type="text"
                id="syncShopifyDomain"
                name="syncShopifyDomain"
                placeholder="yourstore.myshopify.com"
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
                defaultValue={settings.syncAccessToken}
                required
              />
            </div>
          </div>

          <div style={{ textAlign: "left" }}>
            <button type="submit" className="btn-gold" disabled={isSubmitting}>
              {isSubmitting ? "Saving & Connecting..." : "Connect & Save Settings"}
            </button>
          </div>
        </fetcher.Form>
      </div>
    </div>
  );
}
