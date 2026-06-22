# Auditoria funcional — Carol Sol PWA

Atualizada em 22/06/2026. Este documento registra o diagnóstico técnico; os fluxos corrigidos estão implementados no código e nas migrações.

## Corrigido e persistido no Neon

- Autenticação e autorização por perfil (cliente, profissional e administrador).
- Criação de agendamento com serviço/profissional por UUID, bloqueio concorrente de horário, código único, histórico e auditoria.
- Dados do fluxo Descobrir anexados ao agendamento em `appointments.intake_data`.
- Notificação interna e tentativa real de e-mail/WhatsApp para cliente e profissional após novo agendamento.
- Solicitação de reagendamento com data antiga/nova, histórico, aprovação/recusa profissional e notificações.
- Histórico completo da cliente, fichas técnicas, fotos, pagamentos e rota “Ver todos”.
- Mudança de status profissional/admin persistente, auditada e recarregada após confirmação.
- Solicitação de plano cria orçamento, assinatura aguardando pagamento e pagamento pendente; o plano não ativa antes de `paid`.
- Validação de cupom no backend para plano e agendamento, com desconto persistido e consumo definitivo apenas após pagamento/serviço.
- Pagamentos com escolha Pix manual/local, comprovante, histórico de status e estrutura SumUp.
- Notificações reais, leitura individual, “marcar todas” e URL de ação.
- LGPD: consentimentos, exportação e solicitação de exclusão.
- Indicações registradas e rastreáveis.
- Painéis principais profissional/admin alimentados pelo Neon.
- Painéis seguros de WhatsApp para admin e profissional; credenciais nunca chegam ao navegador.
- Estrutura SumUp: checkout no backend, retorno consultando estado real, sincronização, webhook idempotente e ativação somente após `paid`.

## Rotas funcionais principais

- Cliente: início, descobrir, serviços, agenda, detalhe de agendamento, histórico, benefícios, planos, pagamentos, retorno de pagamento, cupons, notificações, indicações, privacidade e perfil.
- Profissional: dashboard, agenda, clientes vinculadas, fichas, comissões, serviços, disponibilidade, WhatsApp e perfil.
- Admin: dashboard, agenda, clientes, profissionais, serviços, estoque, pagamentos, planos, cupons, comissões, notificações, relatórios, SumUp, WhatsApp e configurações.

## Dependências externas ainda não configuradas

- SumUp: faltam `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_RETURN_URL`, `SUMUP_WEBHOOK_SECRET` e `SUMUP_ENABLED=true`. O sistema mostra estado inativo e não simula cartão.
- Cloudinary: o JSON existente no Vercel não contém provedores válidos. Upload de fotos/comprovantes exige credenciais reais.
- WhatsApp: o painel e o proxy estão implementados; conexão/QR dependem de os endpoints do servidor Baileys responderem ao contrato configurado.

## Observação sobre dados estáticos

As rotas operacionais usam APIs reais. Componentes visuais legados não roteados ainda existem nos arquivos de área e utilizam imagens/dados de demonstração, mas não são usados como fonte nas páginas operacionais. A remoção física desses protótipos pode ser feita separadamente sem alterar os fluxos publicados.
