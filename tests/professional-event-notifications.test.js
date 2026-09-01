import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("professional events use the connected WhatsApp sender and active recipients", async () => {
  const integrations = await readFile("server/lib/integrations.js", "utf8");
  assert.match(integrations, /export async function notifyActiveProfessionals/);
  assert.match(integrations, /where pr\.active and p\.account_status='active'/);
  assert.match(integrations, /sendWhatsApp\(\{ to: recipient\.phone, text \}\)/);
  assert.match(integrations, /coalesce\(np\.whatsapp,true\)/);
});

test("business events support sales, donations and course requests", async () => {
  const dataApi = await readFile("api/data.js", "utf8");
  assert.match(dataApi, /"donation_created", "course_requested", "product_sold"/);
  assert.match(dataApi, /resource === "business-event"/);
  assert.match(dataApi, /business_event_requests/);
});
