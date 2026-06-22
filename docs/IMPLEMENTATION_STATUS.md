# Status de implementação — Carol Sol PWA

Auditoria inicial realizada em 22/06/2026 antes das correções desta etapa.

Atualização final da primeira etapa em 22/06/2026: correções críticas aplicadas e validadas por build.

Continuação do módulo Agenda Profissional em 22/06/2026: filtros migrados para a API e cobertos por testes automatizados.

Continuação do módulo Disponibilidade Profissional em 22/06/2026: horários passaram a respeitar jornada, serviço, bloqueios e conflitos reais.

Auditoria pré-implementação do módulo Fichas Técnicas Profissionais em 22/06/2026:

- A rota ativa `/profissional/fichas` lista dados reais de `technical_records`, mas não oferece criação, edição ou visualização completa da ficha.
- O link de cada ficha abre `/profissional/clientes/:id`; essa tela valida o vínculo da profissional, porém não carrega os campos da ficha técnica.
- `ProfessionalArea.tsx` ainda contém um formulário protótipo não roteado com cliente, valores e fotos estáticos; “Gerar resumo” e “Salvar ficha” mostram sucesso apenas local.
- O `POST /api/data?resource=technical-records` aceita `appointmentId`, `clientId` e, para admin, `professionalId` enviados pelo frontend sem derivar todos os vínculos do agendamento.
- Uma profissional recebe seu próprio ID no backend, mas o endpoint não verifica se o atendimento informado pertence a ela. O `ON CONFLICT(appointment_id)` também não possui condição de escopo, criando risco de alteração de ficha de outro atendimento.
- O endpoint não valida UUIDs, status do atendimento, limites numéricos, forma de pagamento nem existência do método capilar antes do insert.
- Fotos técnicas ainda não possuem fluxo profissional: `POST resource=photos` aceita somente cliente e não vincula `appointment_id`; o upload Cloudinary exige sessão, mas o registro relacional do anexo não existe para a profissional.
- Os campos usados pela ficha (`strands_count`, `weight_grams`, `color`, `shade`, `length_cm`, `texture`, `hair_lot`, `products_used`, `recommendations`, `internal_notes`, `next_maintenance_date`, `final_value` e `payment_status`) existem em `technical_records` no schema do repositório.
- A leitura da cliente exclui corretamente `internal_notes`; a listagem profissional é escopada por `technical_records.professional_id`.

## Resultado desta etapa

- Corrigido o crash de `/cliente/perfil`: o avatar agora aceita carregamento sem nome e o formulário nasce com estado seguro.
- A edição de perfil continua aguardando o `PATCH` e a recarga da API antes de exibir sucesso. O backend agora exige que `profiles` e o registro específico de `clients`/`professionals` tenham sido realmente atualizados; ausência de linha aborta a transação.
- A troca de foto não altera mais apenas a interface: após o upload, grava `avatar_url` no perfil, recarrega os dados e só então mostra sucesso. Em falha, a foto anterior permanece.
- Os filtros Dia/Semana/Mês e as setas de período da agenda profissional agora filtram os agendamentos reais já escopados pela API e possuem loading, erro e empty state próprios.
- Mudanças de status profissional/admin foram auditadas: aguardam a resposta da API, mantêm o valor anterior em falha, registram erro e só então atualizam/recarregam a tela.
- A agenda deixou de usar avatar mockado nas rotas ativas; a API entrega `client_avatar_url` e `professional_avatar_url`.
- O link legado “Ver ficha completa” foi ligado a `/cliente/historico`. Títulos com rótulo mas sem callback deixaram de renderizar falso botão.
- O WhatsApp não aponta mais para `https://wa.me/` vazio: usa o telefone real da profissional ou exibe estado indisponível não clicável.
- Subrotas desconhecidas de cliente, profissional e admin agora exibem 404 interno com retorno seguro ao início da respectiva área.
- A seleção de profissional no agendamento foi testada na publicação com “Renata Moura” sem reprodução de erro 500.
- Permissões foram validadas nos três papéis por código e na publicação: cliente/profissional acessam seus dados escopados e uma sessão admin enviada a `/cliente/perfil` é redirecionada para `/admin/dashboard`.
- A Agenda Profissional envia `dateFrom` e `dateTo` para a API. O backend valida datas reais, ordem, intervalo máximo de 93 dias e aplica o período depois do escopo da profissional.
- Trocas rápidas entre Dia/Semana/Mês cancelam a consulta anterior; respostas antigas não sobrescrevem o período atual.
- O status exibido deixou de usar um segundo estado local: após o `PATCH`, a tela usa o `status` retornado pela transação do banco.
- O protótipo legado “Hoje”, que continha atendimento e sucesso apenas locais, foi removido da área profissional.
- O endpoint de disponibilidade não aceita mais nome como identificador: usa UUID da profissional ou o contrato explícito `firstAvailable=true` e devolve o UUID efetivamente selecionado.
- Os horários fixos `09:00`, `10:30`, `14:00` e `16:00` foram removidos. A API agora gera intervalos de 30 minutos exclusivamente dentro de `professional_availability`, respeitando a duração do serviço, agendamentos e bloqueios.
- A criação do agendamento exige UUIDs, confirma que a profissional está ativa e vinculada ao serviço, valida a jornada semanal e usa o mesmo lock transacional empregado pelos bloqueios.
- A tela da cliente aguarda a disponibilidade real, cancela consultas obsoletas e não permite confirmar horário inexistente. Reagendamentos sem opções agora limpam a seleção anterior e exibem empty state.
- O bloqueio de período profissional agora valida futuro, mesmo dia, limite de 12 horas, jornada semanal e sobreposição com agendamentos/bloqueios; o insert ocorre somente após essas verificações, na mesma transação.
- O botão de salvar bloqueio fica desabilitado durante a API e a lista só é recarregada após confirmação do banco.
- Foram adicionados 6 testes de disponibilidade; a suíte total possui 11 testes para agenda, status, jornada, intervalos e conflitos.
- A rota ativa `/profissional/fichas` agora cria, abre e edita fichas reais a partir de atendimentos vinculados; o botão só aparece quando existe atendimento apto.
- O backend deriva cliente, profissional e método padrão do agendamento bloqueado em transação. IDs de cliente/profissional enviados pelo frontend não participam mais do upsert.
- O upsert de ficha passou a validar UUID, escopo da profissional, status do atendimento, método ativo, limites numéricos, data, anexos e conteúdo mínimo.
- Uma profissional não pode alterar `payment_status` por requisição forjada; em edições o valor existente é preservado e novas fichas começam como `pending`.
- Fotos Antes/Durante/Depois são enviadas ao Cloudinary e registradas em `client_photos` junto com a ficha na mesma transação PostgreSQL. O sucesso só aparece após upload, API e recarga.
- Fotos técnicas são desabilitadas sem consentimento `photos`; o backend valida novamente `privacy_consents` antes do insert.
- O protótipo não roteado que simulava “Gerar resumo” e “Salvar ficha” com dados de Camila foi removido de `ProfessionalArea.tsx`.
- Foram adicionados 5 testes de validação de ficha técnica; a suíte total agora possui 16 testes.

## Resumo técnico

- O frontend é React 18 + TypeScript + React Router.
- Apesar de existir um cliente Supabase em `src/lib/supabase.ts` e um schema inicial em `supabase/schema.sql`, o fluxo operacional atual não usa Supabase diretamente. Ele usa `/api/*`, sessão JWT em cookie `HttpOnly` e PostgreSQL/Neon por `DATABASE_URL`.
- Testes (16/16), typecheck e build de produção passam. Não há `DATABASE_URL` disponível no ambiente local desta auditoria; por isso a estrutura do banco foi validada pelas migrações do repositório e o comportamento foi conferido também na publicação vinculada, sem inspeção SQL direta do banco remoto.
- O executável Git não está disponível neste ambiente; `git diff --check` não pôde ser executado.

## Rotas existentes

### Públicas

- `/`
- `/entrar`
- `/cadastro`
- `/recuperar`
- `/redefinir`

### Cliente

- `/cliente/inicio`
- `/cliente/descobrir`
- `/cliente/servicos`
- `/cliente/agenda` e `/cliente/agendamentos`
- `/cliente/agendamentos/:id`
- `/cliente/historico`
- `/cliente/beneficios`
- `/cliente/planos/:id`
- `/cliente/pagamentos` e `/cliente/pagamentos/:id`
- `/cliente/pagamento/retorno`
- `/cliente/cartoes`
- `/cliente/cupons`
- `/cliente/notificacoes`
- `/cliente/privacidade`
- `/cliente/indique-e-ganhe`
- `/cliente/perfil`

### Profissional

- `/profissional/dashboard`
- `/profissional/agenda`
- `/profissional/clientes`
- `/profissional/clientes/:id`
- `/profissional/fichas`
- `/profissional/servicos`
- `/profissional/comissao`, `/profissional/comissoes` e `/profissional/desempenho`
- `/profissional/disponibilidade`
- `/profissional/whatsapp`
- `/profissional/perfil`

### Administrador

- `/admin/dashboard`
- `/admin/agenda` e `/admin/agendamentos`
- `/admin/clientes` e `/admin/clientes/:id`
- `/admin/profissionais`
- `/admin/servicos`
- `/admin/estoque`
- `/admin/pagamentos` e `/admin/financeiro`
- `/admin/planos`
- `/admin/cupons` e `/admin/promocoes`
- `/admin/comissoes`
- `/admin/notificacoes`
- `/admin/integracoes/sumup`
- `/admin/integracoes/whatsapp`
- `/admin/relatorios`
- `/admin/configuracoes` e `/admin/perfil`

## Rotas quebradas ou ausentes

- As áreas ainda usam correspondência manual por `pathname`, mas subrotas desconhecidas agora exibem 404 interno em vez de abrir silenciosamente o dashboard.
- Não existe rota exclusiva de detalhe `/cliente/fichas/:id`. A ficha completa está incorporada ao histórico da cliente.
- O texto legado “Ver ficha completa” estava em um componente protótipo não roteado; foi ligado a `/cliente/historico`. A rota ativa de perfil também aponta para esse histórico.
- Os links de WhatsApp dos agendamentos agora usam o telefone retornado pela API; sem telefone, a interface exibe estado indisponível não clicável.

## Telas que usam dados mockados ou arrays estáticos

- `src/data/mock.ts`: serviços, agendamentos, clientes, estoque, profissionais, notificações e imagens de demonstração.
- `src/pages/client/ClientArea.tsx`: mantém componentes protótipo não roteados com mocks; nas rotas ativas ainda usa imagens mockadas de profissionais e arrays estáticos do questionário/etapas.
- `src/pages/professional/ProfessionalArea.tsx`: mantém outros componentes protótipo não roteados com mocks; o protótipo de fichas técnicas foi removido e as rotas profissionais ativas usam `ProfessionalPortal.tsx` com API real.
- `src/pages/admin/AdminArea.tsx`: mantém grande conjunto de componentes protótipo não roteados, gráficos, campanhas e relatórios estáticos. As rotas administrativas publicadas apontam majoritariamente para `AdminPortal.tsx`, que usa API real.
- `src/pages/Auth.tsx`: slides e imagens estáticos apenas para conteúdo institucional, não como dado operacional.
- `src/components/AppShell.tsx`: identidades e avatares estáticos usados como fallback visual.

## Botões ou controles sem ação real

- A busca global “Buscar ⌘K” sem implementação foi removida do `AppShell` para não manter um botão falso.
- Os `SectionHeading` sem `onClick` não renderizam mais um falso botão. Os links com destino real permanecem clicáveis.
- Componentes protótipo não roteados contêm ações locais que exibem sucesso sem persistência; não são a implementação ativa, mas devem ser removidos em uma etapa própria para evitar regressão.

## Tabelas existentes nas migrações do repositório

`profiles`, `clients`, `professionals`, `admins`, `salon_locations`, `chairs_or_rooms`, `service_categories`, `hair_methods`, `services`, `professional_services`, `appointments`, `appointment_status_history`, `appointment_messages`, `blocked_schedule`, `professional_availability`, `waitlist`, `reschedule_requests`, `payments`, `payment_receipts`, `payment_status_history`, `payment_webhook_logs`, `plans`, `subscriptions`, `quotes`, `quote_items`, `saved_cards`, `loyalty_points`, `coupons`, `coupon_usage`, `campaigns`, `referrals`, `referral_rewards`, `notifications`, `notification_preferences`, `notification_delivery_logs`, `whatsapp_templates`, `whatsapp_sessions`, `integration_settings`, `client_photos`, `before_after_gallery`, `technical_records`, `hair_inventory`, `inventory_movements`, `products`, `product_sales`, `commissions`, `professional_goals`, `reviews`, `consent_logs`, `privacy_consents`, `data_export_requests`, `account_deletion_requests`, `client_internal_notes`, `business_settings`, `audit_logs` e `_luxe_migrations`.

## Tabelas ausentes

- Nenhuma tabela referenciada pelas APIs está ausente do conjunto de arquivos SQL do repositório.
- O `supabase/schema.sql` isolado não contém várias tabelas operacionais posteriores, como `saved_cards`, `notification_preferences`, `privacy_consents`, `data_export_requests`, `account_deletion_requests`, `professional_availability`, `business_settings`, `client_internal_notes`, `appointment_messages`, `reschedule_requests`, `quotes`, `quote_items`, históricos/recibos de pagamento e tabelas de integração. Executar apenas esse arquivo deixa o banco incompatível com o frontend atual.
- A existência dessas tabelas no banco remoto não foi confirmada por consulta SQL nesta auditoria.

## Erros de API e runtime encontrados

- Crítico reproduzido e corrigido: `/cliente/perfil` quebrava com `TypeError: Cannot read properties of undefined (reading 'split')` antes de permitir salvar. A origem era o `Avatar` receber `name` indefinido durante a primeira renderização do formulário.
- O filtro de profissional no novo agendamento foi testado com “Renata Moura” e não reproduziu erro 500 na publicação atual. O contrato frágil por nome foi removido: disponibilidade e criação agora exigem UUID ou `firstAvailable=true`.
- Corrigido o risco de horário visualmente disponível mas fora da jornada: o backend agora valida `professional_services` e `professional_availability` antes de inserir o agendamento.
- Corrigido o bloqueio sem validação: períodos passados, fora da jornada, cruzando dias ou sobrepostos agora retornam erro antes de qualquer alteração.
- Crítico corrigido em fichas técnicas: o antigo `ON CONFLICT(appointment_id)` permitia tentativa de sobrescrita sem validar que o atendimento pertencia à profissional autenticada. O vínculo agora é consultado e bloqueado dentro da transação.
- Corrigida a ausência de validação de dados técnicos, anexos e status do atendimento antes da escrita.
- Requisições sem sessão retornam 401 JSON, como esperado.
- Alguns carregamentos usam `.catch(() => {})`, ocultando erros de API da interface e do console.

## Campos do frontend incompatíveis com o schema inicial

- Os campos ativos de perfil existem no conjunto de migrações, porém `profiles.instagram`, `profiles.address`, `profiles.account_status` e `clients.personal_notes` não existem no `supabase/schema.sql` inicial e dependem de `database/neon-complete-portal.sql`.
- Campos operacionais de agendamento, pagamento, assinatura, cupom e notificação usados pelas APIs também dependem das migrações `neon-complete-portal.sql`, `neon-master-completion.sql`, `neon-operational.sql` e `neon-portal-fixes.sql`.
- Não foi encontrado campo ativo do frontend sem definição em algum SQL do repositório; o risco é aplicar somente parte das migrações.

## Problemas de permissões

- O React protege as áreas por papel e redireciona papel divergente.
- As APIs usam `requireUser`/`requireRole`; consultas de cliente e profissional possuem escopo por `profile_id`/`professional_id` nos fluxos revisados.
- A camada RLS do Supabase está incompleta: apenas sete tabelas têm RLS habilitado no schema inicial e as políticas cobrem principalmente leitura. Não há conjunto completo de políticas para todas as operações/tabelas.
- Como a aplicação ativa acessa o banco pelo backend com `DATABASE_URL`, as políticas RLS do Supabase não são a barreira efetiva de autorização. A segurança depende integralmente do escopo correto em cada endpoint.
- `JWT_SECRET` possui fallback inseguro de desenvolvimento caso a variável não seja configurada.
- Chaves SumUp, Resend, Baileys e `DATABASE_URL` aparecem somente em backend/exemplo; não foi encontrada Service Role exposta no bundle do frontend.
- Fichas técnicas profissionais são escopadas pelo atendimento e `profile_id`; fotos exigem consentimento ativo da própria cliente.

## Funcionalidades já concluídas

- Autenticação por cookie `HttpOnly` e proteção por papel.
- Catálogo, agenda, clientes vinculadas, histórico, pagamentos, planos, cupons, notificações, privacidade, indicações, disponibilidade e painéis principais consumindo API real nas rotas ativas.
- Alterações de status de agendamento profissional/admin aguardam a API antes de atualizar estado local; falhas mantêm o valor anterior e geram log.
- Perfil da cliente renderiza com estado seguro e persiste dados/foto antes da confirmação visual.
- Agenda profissional possui filtros Dia/Semana/Mês processados pela API, cancelamento de requisição obsoleta e status derivado da resposta persistida.
- Disponibilidade profissional usa jornada semanal real; criação de agendamento e bloqueio compartilham validação de período, lock e detecção de conflito.
- Fichas técnicas profissionais possuem criação/edição real, validação transacional de vínculo e anexos condicionados ao consentimento da cliente.
- Empty states existem na maior parte das páginas de portal.
- Build TypeScript/Vite/PWA e 25 testes automatizados concluídos com sucesso.

## Resultado desta etapa (Módulo 1 & 2 - Estoque e Fotos)

- **Estoque e Movimentações**: Concluído o vínculo com o estoque real de cabelos e produtos. Validação transacional de saldo com locks concorrentes, rollback completo em falhas e idempotência na edição de fichas gerando movimentos em `inventory_movements`.
- **Visualização e Gestão de Fotos**: Ao abrir uma ficha técnica existente, o formulário agora renderiza miniaturas das fotos anexadas (Antes, Durante, Depois) com opções para **Excluir** e **Substituir** cada uma individualmente.
- **Limpeza Compensatória no Cloudinary**: Ao excluir ou substituir fotos técnicas, as imagens correspondentes são removidas da tabela `client_photos` e assincronamente limpas dos buckets do Cloudinary usando chamadas assinadas de destroy pós-commit da transação, eliminando a orfandade de mídias.
- **Testes Unitários**: Adicionados testes para validação de `deletedPhotoIds` e extração de IDs públicos de URLs Cloudinary. Suíte total de 25 testes unitários passando.
- **Build e Lint**: Todo o fluxo compila perfeitamente sem lint warnings ou type errors.

## Resultado desta etapa (Módulo 3 - Resumo da Ficha Técnica)

- **Geração Real de Resumo**: Implementado a geração e cópia de resumo formatado da ficha técnica na área profissional (botão "Copiar resumo"), resgatando os dados dinâmicos do atendimento (nome da cliente, serviço, data), detalhes reais do cabelo (método e lote selecionados do estoque real ou digitados), quantidade/peso/cor/textura, lista detalhada de produtos de estoque consumidos (com nomes e quantidade), recomendações e valor final.
- **Formatação de Fuso Horário Segura**: A data da próxima manutenção é formatada de maneira segura contra desvios de fuso horário de servidores/clientes utilizando a conversão direta de string `YYYY-MM-DD` para `DD/MM/YYYY`.
- **Integridade**: Verificado que as mudanças compilam limpas no build de produção, passam no lint e mantêm os 25 testes unitários operantes.

## Resultado desta etapa (Limpeza de Mocks & Diagnóstico Real)

- **Expurgo de Código Morto/Protótipos**: Removidos mais de 2.300 linhas de componentes locais legados e não utilizados nas áreas do cliente ([ClientArea.tsx](file:///C:/Users/carol/OneDrive/Área de Trabalho/site mobile carol/src/pages/client/ClientArea.tsx)) e do administrador ([AdminArea.tsx](file:///C:/Users/carol/OneDrive/Área de Trabalho/site mobile carol/src/pages/admin/AdminArea.tsx)). As importações dos mocks estáticos foram completamente banidas destas páginas.
- **Integração Real do Diagnóstico**: O fluxo do Diagnóstico/Questionário Inteligente (`Discover` e `Recommendation`) agora consome a API real de profissionais via `/api/data?resource=bootstrap` para renderizar dinamicamente o nome e foto de perfil real (vinculado a `profiles.avatar_url`) da especialista na recomendação de Mega Hair.
- **Otimização de Performance**: A limpeza de arquivos mortos reduziu o CSS de produção de 43.42 kB para 35.75 kB (uma otimização de 17.6%), acelerando a performance de renderização inicial do PWA.
- **Integridade da Suíte**: Todos os 25 testes unitários continuam passando com sucesso e o build do Vite executa de forma 100% limpa.

## Resultado desta etapa (Módulo 1 - Agendamento e Descobrir)

- **Cupom Interativo no Agendamento**: Implementado o endpoint `/api/data?resource=validate-coupon` no backend que realiza a validação em tempo real de cupons. No frontend, adicionado campo interativo de cupom e botão "Aplicar" na etapa de Revisão (etapa 6) do agendamento, reduzindo os valores totais e do sinal (deposit) instantaneamente e aplicando-o na criação final do agendamento.
- **Pré-seleção Inteligente de Serviço**: O agendamento pós-descoberta (`origem=descobrir` e rascunho em `sessionStorage`) agora localiza e seleciona automaticamente o serviço de "Avaliação personalizada" no catálogo.
- **Exibição do Diagnóstico Inteligente (Intake Data)**: Modificada a consulta `client-detail` no backend para entregar o campo `intake_data` às profissionais. Adicionado o componente `IntakeDetailsModal` no frontend profissional. Ao clicar em **[Ver Diagnóstico]** na listagem de atendimentos da Agenda ou na tela de Detalhes da Cliente, a especialista visualiza as respostas completas do quiz capilar e a galeria das 4 fotos enviadas (Frente, Costas, Lateral, Referência).
- **SumUp Env Setup**: Variáveis de ambiente `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_ENVIRONMENT`, `SUMUP_RETURN_URL` e `SUMUP_ENABLED` configuradas e migradas no Vercel em todos os ambientes (Development, Preview, Production).
- **Integridade**: Build (`npm run build`), lint e testes (25/25) executando de forma 100% limpa.

## Próxima etapa recomendada (Módulo 2)

Seguir para o **Módulo 2: Remarcação e agenda profissional** (Cliente solicita reagendamento → profissional recebe notificação → aceitar, recusar ou sugerir novo horário via painel profissional).



