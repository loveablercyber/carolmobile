# Carol Sol PWA

Aplicativo demonstrativo premium para gestão especializada de Mega Hair, com áreas de cliente, profissional e administração.

## Executar

```bash
npm install
npm run build
npm run dev
```

O comando `npm run dev` serve o build validado em `http://localhost:5173`. Para desenvolvimento com hot reload em ambientes sem restrições de sandbox, use `npm run dev:vite`.

Use os seletores de perfil na tela de login para acessar cada painel. Os dados são simulados; a preparação para Supabase está em `src/lib/supabase.ts` e `supabase/schema.sql`.

## Produção

1. Copie `.env.example` para `.env` e informe as chaves do Supabase.
2. Execute `supabase/schema.sql` no projeto Supabase.
3. Revise e amplie as políticas RLS conforme as regras finais da operação.
4. Configure credenciais e webhooks para Mercado Pago, WhatsApp e push notifications somente no backend.

O build gera manifest, service worker, cache de navegação e imagens, atalho de instalação e fallback offline.

## Banco PostgreSQL / Neon

O schema completo pode ser aplicado com a variável `DATABASE_URL` disponível apenas no processo do servidor:

```bash
npm run db:inspect
npm run db:setup
```

As migrações ficam registradas em `public._luxe_migrations`. O arquivo `database/neon-bootstrap.sql` adiciona a camada de compatibilidade de autenticação; `database/neon-seed.sql` cria os dados demonstrativos.
