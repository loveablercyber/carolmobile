import pg from "pg";
const { Client } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("DATABASE_URL não informada.");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    console.log("=== AI SETTINGS ===");
    const { rows: settings } = await client.query("select * from public.ai_settings limit 1");
    console.log(settings[0]);

    console.log("\n=== WHATSAPP SESSIONS ===");
    const { rows: sessions } = await client.query("select * from public.whatsapp_sessions");
    console.log(sessions);

    console.log("\n=== RECENT AI REQUEST LOGS (LAST 10) ===");
    const { rows: reqLogs } = await client.query(
      "select * from public.ai_request_logs order by created_at desc limit 10"
    );
    console.log(reqLogs);

    console.log("\n=== RECENT MESSAGE LOGS (LAST 10) ===");
    const { rows: logs } = await client.query(
      "select * from public.whatsapp_message_logs order by created_at desc limit 10"
    );
    console.log(logs);

    console.log("\n=== RECENT INCOMING QUEUE (LAST 5) ===");
    const { rows: queue } = await client.query(
      "select * from public.whatsapp_incoming_queue order by created_at desc limit 5"
    );
    console.log(queue);

  } catch (error) {
    console.error(error);
  } finally {
    await client.end();
  }
}

main();
