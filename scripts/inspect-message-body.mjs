import pg from "pg";
const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
const conversationId = process.argv[2] || process.env.CONVERSATION_ID;

if (!connectionString) {
  console.error("DATABASE_URL não informada.");
  process.exit(1);
}

if (!conversationId) {
  console.error("Informe o ID da conversa como argumento ou em CONVERSATION_ID.");
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const { rows } = await client.query(
      `select id, direction, sender_type, body, created_at 
       from public.whatsapp_messages 
       where conversation_id = $1
       order by created_at desc 
       limit 4`,
      [conversationId]
    );
    console.log("=== LATEST CONVERSATION MESSAGES ===");
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await client.end();
  }
}

main();
