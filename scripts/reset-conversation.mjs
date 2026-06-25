import pg from "pg";
const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
const phoneNumber = String(process.argv[2] || process.env.WHATSAPP_PHONE || "").replace(/\D/g, "");

if (!connectionString) {
  console.error("DATABASE_URL não informada.");
  process.exit(1);
}

if (!/^55\d{10,11}$/.test(phoneNumber)) {
  console.error("Informe o telefone com 55, DDD e número como argumento ou em WHATSAPP_PHONE.");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    console.log("=== RESETTING CONVERSATION ===");
    const res = await client.query(
      `update public.whatsapp_conversations
          set status='ai', ai_enabled=true, updated_at=now()
        where phone_number=$1
        returning *`,
      [phoneNumber]
    );
    console.log("Updated conversations count:", res.rowCount);
    if (res.rowCount > 0) {
      console.log(res.rows[0]);
    }

    console.log("\n=== RESETTING HUMAN TICKETS FOR THIS CONVERSATION ===");
    const resTickets = await client.query(
      `update public.human_handoff_tickets
          set status='resolved', resolved_at=now()
        where conversation_id = (select id from public.whatsapp_conversations where phone_number=$1)
          and status='pending'
        returning *`,
      [phoneNumber]
    );
    console.log("Updated tickets count:", resTickets.rowCount);

  } catch (error) {
    console.error(error);
  } finally {
    await client.end();
  }
}

main();
