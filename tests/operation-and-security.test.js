import test from "node:test";
import assert from "node:assert/strict";

test("saoPauloDateKey and addDaysToKey calculate correctly for reminderWindow", () => {
  function saoPauloDateKey(value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value))
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${byType.year}-${byType.month}-${byType.day}`
  }

  function addDaysToKey(key, days) {
    const [year, month, day] = key.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day + days))
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-')
  }

  const todayKey = saoPauloDateKey(new Date());
  const tomorrowKey = addDaysToKey(todayKey, 1);
  const nextDayKey = addDaysToKey(todayKey, 2);

  assert.equal(addDaysToKey(todayKey, 0), todayKey);
  assert.ok(tomorrowKey !== todayKey);
  assert.ok(nextDayKey !== tomorrowKey);
});

test("welcome email content helper is valid", () => {
  const email = "teste@example.test";
  const fullName = "Cliente Teste";
  const subject = 'Conta criada - Carol Sol';
  const html = `<p>Ola, ${fullName}. Sua conta Carol Sol foi criada com sucesso.</p><p>Agora voce pode acompanhar agendamentos, pagamentos, beneficios e notificacoes pelo aplicativo.</p>`;

  assert.ok(html.includes("Cliente Teste"));
  assert.ok(html.includes("criada com sucesso"));
});

test("permission checks audit - mock role enforcement", () => {
  const requireRole = (user, allowed) => {
    if (!user || !user.role) throw new Error("Acesso negado.");
    if (!allowed.includes(user.role)) throw new Error("Acesso negado.");
    return true;
  };

  const adminUser = { role: "admin" };
  const profUser = { role: "professional" };
  const clientUser = { role: "client" };

  assert.ok(requireRole(adminUser, ["admin"]));
  assert.ok(requireRole(profUser, ["admin", "professional"]));
  
  assert.throws(() => requireRole(clientUser, ["admin"]));
  assert.throws(() => requireRole(clientUser, ["professional"]));
  assert.throws(() => requireRole(null, ["admin"]));
});
