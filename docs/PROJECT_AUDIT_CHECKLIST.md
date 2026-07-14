# Checklist de Auditoria do Projeto Carol Sol

Atualizado em 2026-07-08.

## Corrigido nesta rodada

- [x] Criar calendário visual reutilizável para agendamentos.
- [x] Exibir calendário no painel administrativo.
- [x] Exibir calendário no painel profissional.
- [x] Controlar cores por situação: agendado, pendente, expirado e cancelado.
- [x] Abrir modal de detalhes ao clicar em um agendamento.
- [x] Permitir atualização de status pelo modal do calendário.
- [x] Fazer a agenda administrativa carregar o mês visível, não apenas os últimos registros.
- [x] Abrir a agenda profissional inicialmente em visão mensal.
- [x] Cadastrar `/api/cron-reminders` no `vercel.json`.
- [x] Rodar lembretes automaticamente uma vez ao dia na Vercel Hobby.
- [x] Enviar lembretes para atendimentos de hoje, amanhã e daqui a dois dias.
- [x] Respeitar preferências de e-mail, WhatsApp e lembretes no cron.
- [x] Enviar e-mail de boas-vindas após conta criada.
- [x] Criar agendamento manual pelo admin.
- [x] Editar data, profissional, serviço e observações de agendamento pelo admin.
- [x] Cancelar ou marcar falta pelo admin com motivo salvo.
- [x] Criar modal completo de detalhe administrativo do agendamento.
- [x] Exibir histórico de status dentro do detalhe administrativo.
- [x] Criar filtros por profissional, status e serviço na agenda admin.
- [x] Criar exportação CSV da agenda por período e filtros atuais.
- [x] Criar serviço pela interface administrativa.
- [x] Editar preço, duração, descrição, categoria e método de serviço.
- [x] Ativar e desativar serviço sem apagar histórico.
- [x] Vincular serviço a profissionais com comissão e preço personalizado.
- [x] Corrigir Hosted Checkout SumUp com `hosted_checkout.enabled`, `redirect_url` e `hosted_checkout_url`.
- [x] Registrar payload enviado e resposta recebida da SumUp para diagnóstico.
- [x] Trocar erro bruto da SumUp por mensagem amigável ao usuário.
- [x] Remover criação de e-mail fictício no pré-cadastro via WhatsApp.
- [x] Exigir e-mail real, CPF e data de nascimento no pré-agendamento via WhatsApp.
- [x] Espelhar CPF coletado pelo WhatsApp no perfil da conta e no cadastro de cliente.
- [x] Criar acesso com senha temporária segura para cliente criada pelo WhatsApp.
- [x] Enviar login e senha temporária por WhatsApp e e-mail.
- [x] Gerar fatura/sinal do agendamento criado pelo WhatsApp e vincular ao pagamento do cliente.
- [x] Mostrar modal no primeiro acesso do cliente com detalhes do agendamento e link para pagamento.
- [x] Remover limite real de 5 horários no bot e paginar horários disponíveis.
- [x] Permitir “ver mais horários” no fluxo de agenda do WhatsApp.
- [x] Atualizar catálogo do bot para usar apenas cabelos/produtos cadastrados.
- [x] Criar cadastro manual de cliente no admin com acesso temporário.
- [x] Melhorar mensagem automática de agendamento manual para a cliente.
- [x] Validar build de produção.
- [x] Rodar a suíte de testes automatizados.

## Agenda e agendamentos

- [x] Cliente cria agendamento pelo app.
- [x] Profissional e admin alteram status do agendamento.
- [x] Cliente solicita reagendamento.
- [x] Profissional aceita, recusa ou sugere novo horário.
- [x] Bloqueio de horário existe para profissional e admin.
- [x] Calendário visual existe no admin e profissional.
- [x] Criar agendamento manual pelo admin com seleção de cliente, serviço, profissional, data e horário.
- [x] Editar data, profissional, serviço e observações de agendamento pelo admin.
- [x] Cancelar agendamento pelo admin com motivo salvo.
- [x] Registrar ausência com motivo e histórico.
- [x] Exibir bloqueios também no calendário visual.
- [x] Criar tela de detalhe administrativo do agendamento.
- [x] Exibir histórico de status dentro do modal ou detalhe.
- [x] Criar filtro por profissional, status e serviço na agenda admin.
- [x] Criar exportação da agenda por período.

## Notificações, WhatsApp e e-mail

- [x] Criação de agendamento chama `notifyAppointment`.
- [x] Cliente recebe aviso de agendamento criado/reservado.
- [x] Profissional recebe aviso de novo agendamento.
- [x] Admin pode receber aviso por `ADMIN_NOTIFICATION_EMAIL`.
- [x] Recuperação de senha envia e-mail.
- [x] Conta criada envia e-mail.
- [x] Reagendamento envia e-mail/WhatsApp nas respostas principais.
- [x] Cron de lembrete existe e agora está agendado na Vercel.
- [x] WhatsApp usa Baileys com `x-api-key` no servidor.
- [x] Persistir logs reais em `notification_delivery_logs`.
- [x] Criar painel admin para testar envio de e-mail e WhatsApp.
- [x] Enviar lembrete exato de 2h antes usando Vercel Pro ou scheduler externo.
- [x] Mostrar status de entrega, falha e motivo por notificação.
- [x] Aplicar preferências de canal também nos avisos imediatos de agendamento.
- [x] Criar templates editáveis para confirmação, lembrete, cancelamento e reagendamento.
- [x] Enviar aviso específico quando pagamento confirmar e agendamento virar confirmado.
- [x] Enviar WhatsApp de boas-vindas quando o cadastro tiver telefone válido.
- [x] Monitorar se a sessão Baileys está `ready` antes de prometer envio.
- [x] Responder saudações simples por horário local sem consumir IA.
- [x] Criar keepalive protegido para acordar/reiniciar Baileys sem clicar no painel.

## Admin - páginas com CRUD incompleto

- [x] Planos: editar plano existente pela interface.
- [x] Planos: pausar/reativar plano.
- [x] Planos: arquivar plano sem apagar histórico.
- [x] Cupons: editar cupom existente pela interface.
- [x] Cupons: pausar/reativar cupom.
- [x] Cupons: remover/arquivar cupom.
- [x] Serviços: criar serviço.
- [x] Serviços: editar preço, duração, descrição, categoria e método.
- [x] Serviços: ativar/desativar serviço.
- [x] Serviços: vincular serviço a profissionais e comissão.
- [x] Profissionais: criar profissional.
- [x] Profissionais: editar perfil, comissão, bio e especialidades.
- [x] Profissionais: ativar/desativar profissional.
- [x] Profissionais: configurar jornada semanal pelo admin.
- [x] Estoque: editar item.
- [x] Estoque: remover/arquivar item.
- [x] Estoque: registrar entrada, saída e ajuste manual.
- [x] Clientes: editar dados cadastrais pelo admin.
- [x] Clientes: visualizar linha do tempo completa em uma tela dedicada.
- [x] Pagamentos: criar cobrança manual.
- [x] Pagamentos: registrar pagamento parcial pela interface.
- [x] Relatórios: filtros por período.
- [x] Relatórios: exportação CSV/PDF.

## Profissional

- [x] Dashboard profissional usa dados reais.
- [x] Agenda profissional lista agendamentos reais.
- [x] Calendário visual foi adicionado.
- [x] Profissional bloqueia períodos.
- [x] Ficha técnica cria/edita registros e consome estoque.
- [x] Perfil profissional edita dados básicos.
- [x] Profissional editar disponibilidade semanal própria, se permitido pela regra de negócio.
- [x] Profissional ver detalhe completo de agendamento em rota própria.
- [x] Profissional registrar observação rápida no agendamento.
- [x] Profissional iniciar/finalizar atendimento com botões rápidos.
- [x] Profissional solicitar apoio do admin em um agendamento.

## Cliente

- [x] Cliente agenda serviço.
- [x] Cliente acompanha agendamentos.
- [x] Cliente solicita reagendamento.
- [x] Cliente vê notificações e preferências.
- [x] Cliente recupera senha por e-mail.
- [x] Cliente gerencia pagamentos, benefícios, cartões e privacidade.
- [x] Melhorar tela de detalhe de agendamento com linha do tempo e comprovantes.
- [x] Permitir cancelamento com motivo e política visível.
- [x] Confirmar recebimento de lembrete no app.
- [x] Mostrar canal usado para cada notificação.

## Banco, segurança e operação

- [x] `.env*` está ignorado no git.
- [x] Testes cobrem regras de agendamento, disponibilidade, WhatsApp, pagamentos, privacidade e estoque.
- [x] Rotas sensíveis exigem usuário ou `CRON_SECRET`.
- [x] Validar no banco de produção se todas as migrações foram aplicadas.
- [x] Criar teste específico para `cron-reminders`.
- [x] Criar teste para e-mail de boas-vindas no cadastro.
- [x] Criar auditoria de permissões por papel em todas as rotas.
- [x] Revisar textos com codificação quebrada em módulos antigos de backend/WhatsApp.
- [x] Criar monitor de saúde para Resend, Baileys, SumUp, Cloudinary e banco.
- [x] Criar rotina de limpeza para mídias órfãs quando upload passa e transação falha.

## Prioridade recomendada

1. Admin criar/editar agendamento manual.
2. Admin editar serviços, profissionais, planos e cupons.
3. Logs de entrega de notificação.
4. Filtros e detalhe completo da agenda.
5. Painel de teste de WhatsApp/e-mail.
6. Testes adicionais de cron e cadastro.
