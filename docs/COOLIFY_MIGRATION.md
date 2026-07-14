# Migração Carol Mobile Para Coolify

Origem atual: `https://carolmobile.vercel.app`

Repositório: `https://github.com/loveablercyber/carolmobile`

Branch sugerida: `main`

Domínio final: `carolsol.com.br`

## Status do Código

- O projeto está preparado para rodar fora da Vercel com `npm start`.
- O servidor Node (`server.mjs`) serve o build do Vite e também roteia as APIs em `/api/*`.
- As rotas compatíveis da Vercel foram mantidas:
  - `/api/cron-renewals`
  - `/api/cron-reminders`
  - `/api/cron-billing-whatsapp`
  - `/api/whatsapp-keepalive`
  - `/api/webhooks/baileys/carolsol`
- O banco usa `DATABASE_URL` com `pg`.
- Supabase no frontend é legado/opcional; o fluxo operacional usa APIs próprias, JWT em cookie e PostgreSQL.
- `DATABASE_URL` com Neon/Supabase continua usando SSL quando necessário.
- `DATABASE_URL` do PostgreSQL local do Coolify não força SSL.

## Criar Banco No Coolify

1. Coolify -> Project -> New Resource -> Database -> PostgreSQL.
2. Nome sugerido: `carolmobile-postgres`.
3. Salvar a connection string interna.
4. Usar essa string em `DATABASE_URL` no app.

Exemplo:

```env
DATABASE_URL=postgresql://user:password@carolmobile-postgres:5432/carolmobile
```

## Migrar Dados Do Banco Atual

Se o banco atual for Neon/Postgres puro:

```bash
pg_dump "$OLD_DATABASE_URL" --no-owner --no-acl -Fc -f carolmobile.dump
pg_restore --no-owner --no-acl -d "$COOLIFY_DATABASE_URL" carolmobile.dump
psql "$COOLIFY_DATABASE_URL" -c "\dt"
```

Depois rode a inspeção do app:

```bash
DATABASE_URL="$COOLIFY_DATABASE_URL" npm run db:inspect
```

Se faltarem tabelas/migrações:

```bash
DATABASE_URL="$COOLIFY_DATABASE_URL" npm run db:setup
```

## Criar App No Coolify

1. Coolify -> Project -> New Resource -> Application.
2. Source: GitHub.
3. Repository: `loveablercyber/carolmobile`.
4. Branch: `main`.
5. Build pack: Nixpacks.
6. Install command:

```bash
npm ci
```

7. Build command:

```bash
npm run build
```

8. Start command:

```bash
npm start
```

9. Port: use a variável `PORT` gerada pelo Coolify ou configure `PORT=3000`.

## Variáveis Obrigatórias

Use `docs/coolify.env.example` como base para preencher o painel do Coolify.

```env
NODE_ENV=production
PORT=3000
APP_URL=https://dominio-temporario-do-coolify
DATABASE_URL=postgresql://...
JWT_SECRET=...
CRON_SECRET=...
```

Depois de salvar as variáveis e fazer o primeiro deploy, valide no terminal do app:

```bash
npm run coolify:env-check
```

## Integrações

E-mail:

```env
RESEND_API_KEY=...
NOTIFICATION_EMAIL_FROM=CarolSol <...>
ADMIN_NOTIFICATION_EMAIL=...
```

WhatsApp/Baileys/Evolution:

```env
BAILEYS_ENABLED=true
BAILEYS_API_URL=https://evo.nextia.dev.br
BAILEYS_API_KEY=...
BAILEYS_WEBHOOK_SECRET=...
BAILEYS_DEFAULT_INSTANCE=carol-sol
```

OpenAI:

```env
OPENAI_ENABLED=true
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-mini
```

SumUp:

```env
SUMUP_ENABLED=true
SUMUP_API_KEY=...
SUMUP_MERCHANT_CODE=...
SUMUP_ENVIRONMENT=sandbox
SUMUP_RETURN_URL=https://dominio-temporario-do-coolify/cliente/pagamento/retorno
SUMUP_WEBHOOK_SECRET=...
```

Uploads:

```env
CLOUDINARY_PROVIDERS_JSON=[]
CLOUDINARY_DEFAULT_FOLDER=carol-sol
```

## Crons Externos

Configure no Coolify, EasyCron, cron-job.org ou outro monitor:

```txt
GET https://dominio-temporario-do-coolify/api/whatsapp-keepalive?force=1&secret=CRON_SECRET
GET https://dominio-temporario-do-coolify/api/cron-reminders?execute=1&secret=CRON_SECRET
GET https://dominio-temporario-do-coolify/api/cron-billing-whatsapp?execute=1&secret=CRON_SECRET
GET https://dominio-temporario-do-coolify/api/cron-renewals?execute=1&secret=CRON_SECRET
```

Alternativa no Coolify: se a tela de Scheduled Tasks não persistir todas as tarefas,
ative o scheduler interno da aplicação:

```env
INTERNAL_CRON_ENABLED=true
```

Com essa flag, o `server.mjs` chama internamente:

- `/api/cron-reminders?execute=1` a cada 10 minutos.
- `/api/cron-billing-whatsapp?execute=1` a cada 5 minutos.
- `/api/whatsapp-keepalive?force=1` a cada 4 minutos.
- `/api/cron-renewals` uma vez ao dia em modo protegido/dry-run por padrão.

Os endpoints continuam protegidos por `CRON_SECRET`. Use crons externos ou o
scheduler interno, não os dois ao mesmo tempo para a mesma rotina.

## Teste Antes Do DNS

1. Abrir domínio temporário.
2. Validar variáveis no terminal do app:

```bash
npm run coolify:env-check
```

3. Rodar o teste automatico:

```bash
npm run coolify:smoke -- https://dominio-temporario-do-coolify
```

Com `CRON_SECRET` no ambiente local, o teste tambem tenta o keepalive autenticado:

```bash
CRON_SECRET="seu-segredo" npm run coolify:smoke -- https://dominio-temporario-do-coolify
```

4. Validar manualmente:
   - `/api/health`
   - login admin
   - painel admin
   - painel profissional
   - painel cliente
   - cadastro
   - bot WhatsApp
   - QR/conexão WhatsApp
   - lembretes via cron
   - SumUp checkout
   - retorno SumUp
   - webhook SumUp
   - uploads Cloudinary
5. Só depois trocar `APP_URL`, `SUMUP_RETURN_URL` e webhooks para `https://carolsol.com.br`.

## Cutover Final

1. Adicionar `carolsol.com.br` no app do Coolify.
2. Atualizar DNS para o servidor do Coolify.
3. Atualizar envs:

```env
APP_URL=https://carolsol.com.br
SUMUP_RETURN_URL=https://carolsol.com.br/cliente/pagamento/retorno
```

4. Atualizar webhooks externos:
   - SumUp
   - Evolution/Baileys
   - n8n
   - crons externos
5. Redeploy.
6. Validar:

```bash
npm run coolify:smoke -- https://carolsol.com.br
```

7. Só então desligar Vercel.
