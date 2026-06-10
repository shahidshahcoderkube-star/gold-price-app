import { unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { fetchGoldRates, getEffectiveRates } from "../gold.server";
import { syncProductPrices } from "../shopify.products.server";

export const loader = async ({ request }) => {
  // 1. Authorize the request (Vercel Cron security check in production)
  const authHeader = request.headers.get("authorization");
  if (process.env.NODE_ENV === "production") {
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // 2. Retrieve all active shop configurations
  const settingsList = await prisma.goldSettings.findMany();
  const results = [];

  for (const settings of settingsList) {
    const { shop } = settings;

    try {
      // 3. Fetch gold prices and apply floor thresholds (Stop-Loss)
      const liveRates = await fetchGoldRates(settings);
      const effectiveRates = getEffectiveRates(liveRates, settings);

      // 4. Retrieve offline Shopify Admin API client for the store
      const { admin } = await unauthenticated.admin(shop);

      // 5. Update prices of qualifying gold products
      const updatedCount = await syncProductPrices(admin, settings, effectiveRates);

      // 6. Update cached gold rates
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

      // 7. Log success
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

      results.push({ shop, status: "SUCCESS", updatedCount });
    } catch (err) {
      console.error(`Cron sync failed for shop ${shop}:`, err);

      // Log failure in database
      await prisma.goldActivityLog.create({
        data: {
          shop,
          status: "FAILED",
          rate24K: 0.0,
          rate22K: 0.0,
          rate18K: 0.0,
          productsUpdatedCount: 0,
          errorMessage: err.message || "Background sync failed.",
        },
      });

      results.push({ shop, status: "FAILED", error: err.message });
    }
  }

  return Response.json({
    status: "COMPLETED",
    timestamp: new Date().toISOString(),
    results,
  });
};
