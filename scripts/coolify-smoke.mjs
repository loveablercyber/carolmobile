const baseUrl = String(process.argv[2] || process.env.COOLIFY_URL || process.env.APP_URL || "").replace(/\/+$/, "");
const cronSecret = process.env.CRON_SECRET || "";

if (!baseUrl) {
  console.error("Informe a URL: npm run coolify:smoke -- https://seu-dominio");
  process.exit(1);
}

async function request(path, expectedStatus, label) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, { redirect: "manual" });
  const ok = Array.isArray(expectedStatus)
    ? expectedStatus.includes(response.status)
    : response.status === expectedStatus;
  const statusText = `${response.status} ${response.statusText}`.trim();
  if (!ok) {
    let body = "";
    try {
      body = (await response.text()).slice(0, 500);
    } catch {
      body = "";
    }
    throw new Error(`${label} falhou em ${url}. Recebido ${statusText}. ${body}`);
  }
  console.log(`OK ${label}: ${statusText}`);
  return response;
}

try {
  await request("/", 200, "home");
  await request("/api/health", 200, "health");
  await request("/api/whatsapp-keepalive?force=1", 401, "keepalive protegido");

  if (cronSecret) {
    await request(
      `/api/whatsapp-keepalive?force=1&secret=${encodeURIComponent(cronSecret)}`,
      [200, 502, 503],
      "keepalive autenticado",
    );
  }

  console.log("Smoke test concluido.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
