import { readFileSync, existsSync } from "node:fs";

const envFile = process.argv[2] || "";

function loadEnvFile(file) {
  if (!file) return;
  if (!existsSync(file)) {
    console.error(`Arquivo nao encontrado: ${file}`);
    process.exit(1);
  }
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] === undefined) {
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnvFile(envFile);

const groups = [
  {
    name: "Nucleo",
    required: ["NODE_ENV", "APP_URL", "JWT_SECRET", "CRON_SECRET"],
  },
  {
    name: "Banco",
    required: ["DATABASE_URL"],
  },
  {
    name: "WhatsApp/Baileys",
    required: ["BAILEYS_ENABLED", "BAILEYS_API_URL", "BAILEYS_API_KEY", "BAILEYS_WEBHOOK_SECRET", "BAILEYS_DEFAULT_INSTANCE"],
  },
  {
    name: "OpenAI",
    required: ["OPENAI_ENABLED", "OPENAI_API_KEY", "OPENAI_MODEL"],
  },
  {
    name: "SumUp",
    required: ["SUMUP_ENABLED", "SUMUP_API_KEY", "SUMUP_MERCHANT_CODE", "SUMUP_ENVIRONMENT", "SUMUP_RETURN_URL", "SUMUP_WEBHOOK_SECRET"],
    optional: ["SUMUP_RECURRING_ENABLED", "SUMUP_RECURRING_MODE", "RECURRING_BATCH_LIMIT"],
  },
  {
    name: "Email",
    required: ["RESEND_API_KEY", "NOTIFICATION_EMAIL_FROM", "ADMIN_NOTIFICATION_EMAIL"],
  },
  {
    name: "Uploads",
    required: ["CLOUDINARY_PROVIDERS_JSON", "CLOUDINARY_DEFAULT_FOLDER"],
  },
];

function hasValue(key) {
  const value = process.env[key];
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim();
  return normalized !== "" && normalized !== "[]" && !normalized.includes("troque-por");
}

let missing = 0;
for (const group of groups) {
  console.log(`\n${group.name}`);
  for (const key of group.required) {
    const ok = hasValue(key);
    if (!ok) missing += 1;
    console.log(`${ok ? "OK" : "FALTANDO"} ${key}`);
  }
  for (const key of group.optional || []) {
    console.log(`${hasValue(key) ? "OK" : "OPCIONAL"} ${key}`);
  }
}

if (missing > 0) {
  console.error(`\nAmbiente incompleto: ${missing} variavel(is) obrigatoria(s) faltando.`);
  process.exit(1);
}

console.log("\nAmbiente pronto para deploy.");
