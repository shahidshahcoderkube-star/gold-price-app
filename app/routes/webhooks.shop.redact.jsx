import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received GDPR ${topic} webhook for ${shop}`);
  
  // GDPR shop redact request - clean up local settings and cached rates
  try {
    await db.goldSettings.deleteMany({ where: { shop } });
    await db.goldRateCache.deleteMany({ where: { shop } });
  } catch (err) {
    console.error("GDPR shop redact cleanup failed:", err);
  }
  return new Response();
};
