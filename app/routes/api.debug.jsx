import prisma from "../db.server";

export const loader = async () => {
  try {
    const envVars = {
      SHOPIFY_API_KEY: !!process.env.SHOPIFY_API_KEY,
      SHOPIFY_API_SECRET: !!process.env.SHOPIFY_API_SECRET,
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || null,
      DATABASE_URL: !!process.env.DATABASE_URL,
      DATABASE_URL_HAS_PGBOUNCER: process.env.DATABASE_URL?.includes("pgbouncer=true") || false,
      NODE_ENV: process.env.NODE_ENV,
    };

    let dbStatus = "unknown";
    let dbError = null;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";
    } catch (e) {
      dbStatus = "failed";
      dbError = e.message;
    }

    return Response.json({
      status: "ok",
      envVars,
      dbStatus,
      dbError,
    });
  } catch (err) {
    return Response.json({
      status: "error",
      error: err.message,
    });
  }
};
