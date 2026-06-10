import { PrismaClient } from '@prisma/client';

async function testConnection() {
  console.log("Testing connection to Supabase...");
  
  // Test session pooler (port 5432 on the pooler host)
  const sessionPoolerUrl = "postgresql://postgres.eywrendncbbkdyrezqai:jc4eh8NwZnl5Y6qy@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres";
  console.log(`Connecting to Session Pooler (5432): ${sessionPoolerUrl}`);
  
  const prismaSession = new PrismaClient({
    datasources: {
      db: {
        url: sessionPoolerUrl,
      },
    },
  });

  try {
    await prismaSession.$connect();
    console.log("✅ Session Pooler Connection (5432) Success!");
    
    // Run a simple query
    const result = await prismaSession.$queryRaw`SELECT NOW()`;
    console.log("Database response:", result);
  } catch (error) {
    console.error("❌ Session Pooler Connection (5432) Failed:", error.message);
  } finally {
    await prismaSession.$disconnect();
  }

  console.log("\n-----------------------------------\n");

  // Test transaction pooler (port 6543 on the pooler host)
  const transactionPoolerUrl = "postgresql://postgres.eywrendncbbkdyrezqai:jc4eh8NwZnl5Y6qy@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres";
  console.log(`Connecting to Transaction Pooler (6543): ${transactionPoolerUrl}`);
  
  const prismaTransaction = new PrismaClient({
    datasources: {
      db: {
        url: transactionPoolerUrl,
      },
    },
  });

  try {
    await prismaTransaction.$connect();
    console.log("✅ Transaction Pooler Connection (6543) Success!");
    
    // Run a simple query
    const result = await prismaTransaction.$queryRaw`SELECT NOW()`;
    console.log("Database response:", result);
  } catch (error) {
    console.error("❌ Transaction Pooler Connection (6543) Failed:", error.message);
  } finally {
    await prismaTransaction.$disconnect();
  }
}

testConnection();
