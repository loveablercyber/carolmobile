# Carol Sol PWA

Aplicativo para gestao especializada de Mega Hair, com areas de cliente, profissional e administracao.

## Executar

```bash
npm install
npm run build
npm start
```

O comando `npm start` serve o build em `http://localhost:5173` e tambem roteia as APIs em `/api/*`.

Para desenvolvimento com hot reload:

```bash
npm run dev:vite
```

## Producao

1. Copie `.env.example` para `.env`.
2. Configure `DATABASE_URL`, `JWT_SECRET`, `APP_URL` e as credenciais de integracoes.
3. Execute `npm run db:inspect`.
4. Se faltarem tabelas ou migracoes, execute `npm run db:setup`.
5. Configure webhooks de SumUp, WhatsApp/Baileys/Evolution, e-mail e uploads somente no backend.

O fluxo operacional atual usa APIs proprias, JWT em cookie e PostgreSQL via `DATABASE_URL`. O cliente Supabase em `src/lib/supabase.ts` e `supabase/schema.sql` permanecem apenas como legado/preparacao, nao como dependencia principal da aplicacao.

## Coolify

O projeto esta preparado para Coolify com:

```bash
npm ci
npm run build
npm start
```

Veja o passo a passo em `docs/COOLIFY_MIGRATION.md`.

## Banco PostgreSQL

O schema completo pode ser aplicado com a variavel `DATABASE_URL` disponivel apenas no processo do servidor:

```bash
npm run db:inspect
npm run db:setup
```

As migracoes ficam registradas em `public._luxe_migrations`. O arquivo `database/neon-bootstrap.sql` adiciona a camada de compatibilidade de autenticacao; `database/neon-seed.sql` cria os dados demonstrativos.
