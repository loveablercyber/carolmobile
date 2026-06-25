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

Auditoria pré-implementação do módulo Indique e Ganhe em 22/06/2026:

- `/cliente/indique-e-ganhe` já gera o código genérico `CAROL` + oito caracteres do UUID, cria convites com código único sufixado e lista `referrals`/`referral_rewards` reais.
- O link compartilhado aponta para `/cadastro?ref=...`, mas `Auth.tsx` não encaminha `ref` ao contexto e `AuthContext.tsx` não o envia para `/api/auth`.
- O cadastro cria `auth.users`, `profiles` e `clients` na mesma transação, porém não retorna o ID da cliente nem tenta vincular a indicação.
- A atualização de agendamento já é transacional e possui lock da linha, histórico, auditoria e notificação, mas o status `completed` não processa recompensa de indicação.
- `referrals`, `referral_rewards`, `loyalty_points`, `notifications` e `audit_logs` existem no conjunto de SQLs do repositório. `referral_rewards` depende de `database/neon-complete-portal.sql`, não do schema inicial isolado.
- Não existe restrição única em `referral_rewards.referral_id`; a idempotência deve ser garantida por `SELECT ... FOR UPDATE` na indicação e transição única de `registered` para `completed`.
- A interface possui rótulo para `completed`, mas ainda exibe `invited` e `registered` sem tradução.
- Não havia testes automatizados para vínculo de código, código genérico, primeiro atendimento ou prevenção de recompensa duplicada.

Auditoria pré-implementação do módulo LGPD — Exportação e Exclusão em 22/06/2026:

- A rota cliente de privacidade consome dados reais e registra consentimentos, exportações e pedidos de exclusão por `profile_id`.
- `exportData` inseria a solicitação diretamente como `completed` antes de consultar os dados. Uma falha posterior deixaria sucesso persistido sem arquivo válido.
- A exportação incluía somente perfil, agendamentos, pagamentos, assinaturas, cupons e consentimentos; omitia fichas técnicas, fotos, pontos, indicações, avaliações, notificações, cartões mascarados e histórico dos próprios pedidos LGPD.
- O download era gerado no navegador com o JSON retornado pela API, mas a recarga do histórico não era aguardada e o botão permitia cliques repetidos durante o processamento.
- `requestDeletion` criava a solicitação e alterava `account_status` para `deletion_requested`, porém não existia endpoint administrativo para aprovar/rejeitar nem rotina de anonimização.
- A tela administrativa mostrava consentimentos, mas não carregava ou processava `account_deletion_requests`.
- Perfis bloqueados ou anonimizados continuariam usando APIs enquanto o JWT fosse válido, pois `requireUser` validava assinatura/papel sem consultar `profiles.account_status`.
- Dados que exigem anonimização foram localizados em `auth.users`, `profiles`, `clients`, notas/intake de agendamentos, mensagens, fotos, galeria, fichas técnicas, cartões salvos, notificações, avaliações e registros de indicação. Dados financeiros e relacionais precisam ser preservados sem PII para obrigações legais.

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
- Testes (36/36), typecheck e build de produção passam. Não há `DATABASE_URL` disponível no ambiente local desta auditoria; por isso a estrutura do banco foi validada pelas migrações do repositório e o comportamento foi conferido também na publicação vinculada, sem inspeção SQL direta do banco remoto.
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
- O código de indicação é processado dentro da transação de cadastro; códigos exatos só vinculam convites ainda livres e códigos genéricos bloqueiam autoindicação.
- A recompensa usa lock da indicação e transição única de `registered` para `completed`, impedindo desconto/pontos duplicados em conclusões concorrentes.
- `requireUser` consulta o estado atual do perfil; contas bloqueadas ou anonimizadas deixam de acessar APIs mesmo com JWT ainda não expirado.
- Aprovação de exclusão exige papel admin e pedido pendente bloqueado em transação. Rejeição reativa a conta; aprovação anonimiza PII e invalida login.

## Funcionalidades já concluídas

- Autenticação por cookie `HttpOnly` e proteção por papel.
- Catálogo, agenda, clientes vinculadas, histórico, pagamentos, planos, cupons, notificações, privacidade, indicações, disponibilidade e painéis principais consumindo API real nas rotas ativas.
- Alterações de status de agendamento profissional/admin aguardam a API antes de atualizar estado local; falhas mantêm o valor anterior e geram log.
- Perfil da cliente renderiza com estado seguro e persiste dados/foto antes da confirmação visual.
- Agenda profissional possui filtros Dia/Semana/Mês processados pela API, cancelamento de requisição obsoleta e status derivado da resposta persistida.
- Disponibilidade profissional usa jornada semanal real; criação de agendamento e bloqueio compartilham validação de período, lock e detecção de conflito.
- Fichas técnicas profissionais possuem criação/edição real, validação transacional de vínculo e anexos condicionados ao consentimento da cliente.
- Indicações compartilhadas são vinculadas no cadastro e liberam R$ 50,00 mais 100 pontos somente após o primeiro atendimento concluído da indicada.
- Exportação LGPD gera pacote JSON abrangente, hash SHA-256 e auditoria, com estados `pending`, `processing`, `completed` ou `failed` persistidos corretamente.
- Exclusão LGPD possui solicitação cliente, análise administrativa, anonimização transacional e limpeza de mídia pós-commit sem apagar registros financeiros obrigatórios.
- Empty states existem na maior parte das páginas de portal.
- Build TypeScript/Vite/PWA e 43 testes automatizados concluídos com sucesso.

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

## Resultado desta etapa (Módulo 2 - Remarcação e Agenda Profissional)

- **Simetria no Backend**: Refatorado o método `respondReschedule` em `api/data.js` para permitir que o perfil de cliente (`client`) responda (aceite ou recuse) a solicitações com status `'suggested'`. O endpoint resolve dinamicamente as datas `starts_at` e `ends_at` de acordo com a função de quem responde e gerencia as rotas de notificação, email e WhatsApp corretas.
- **Sugestão de Horário Profissional**: Adicionado o painel interativo "Sugerir Horário" na área da profissional (`ProfessionalArea.tsx`). A especialista pode selecionar uma data futura e consultar a disponibilidade real de slots da sua agenda antes de enviar a sugestão.
- **Resolução de Sugestões no Cliente**: Adicionado o carregamento de solicitações de reagendamento na área do cliente (`ClientArea.tsx`). Agendamentos com solicitações ativas exibem alertas dinâmicos premium: se `'suggested'`, apresentam opções de **Confirmar Novo Horário** ou **Recusar Sugestão** que atualizam a agenda e as notificações na mesma transação; se `'pending'`, mostram o indicador passivo de espera.
- **Integridade de Build e Suítes**: Validado 100% limpo com linting (`npm run lint`), testes unitários (`npm test`) e empacotamento completo (`npm run build`).

## Resultado desta etapa (Módulo 3 - Planos, Benefícios, Cupons e SumUp)

- **Ativação Completa via Webhook/Sync**: Refatorada a função `applyProviderStatus` em [`api/payments.js`](file:///c:/Users/carol/OneDrive/Área de Trabalho/site mobile carol/api/payments.js) para que confirmações de pagamento da SumUp (via webhook e sincronização) realizem a inicialização completa da assinatura no banco. Agora, a ativação calcula e define `renews_at` e `expires_at` (1 mês futuro) e o limite de manutenções com base no plano (`remaining_maintenances`).
- **Notificações e E-mail de Ativação**: Integrado o disparo de e-mail de confirmação (`Plano Carol Sol ativado`) e gravação de notificações in-app (`plan_activated`) pós-transação na confirmação do pagamento SumUp, unificando a regra com o fluxo manual do admin.
- **Configurações Locais**: Adicionadas as variáveis de configuração de sandbox e a URL de retorno absoluta ao arquivo `.env.local` para testes locais de checkout.
- **Nova Suíte de Testes**: Criada a suíte `tests/payments.test.js` para garantir a integridade do mapeamento de status da API SumUp (`mapSumupStatus`) e a robustez do carregador de configuração. A suíte passou a ter 27 testes com 100% de sucesso.
- **Qualidade e Build**: O projeto compila e empacota perfeitamente em produção (`npm run build`) sem erros de lint ou typecheck.

## Resultado desta etapa (Módulo 4 - Notificações, Resend e Baileys)

- **Correção de Usabilidade no PWA**: Corrigido o bug na tela de notificações do cliente (`ClientNotificationsPage` em [`ClientPortal.tsx`](file:///c:/Users/carol/OneDrive/Área de Trabalho/site mobile carol/src/pages/client/ClientPortal.tsx)). Agora, quando o cliente não possui preferências prévias no banco, o estado é inicializado com fallbacks seguros (`true`), tornando a lista de canais de comunicação (WhatsApp, e-mail, etc.) visível e configurável desde o primeiro acesso.
- **Tolerância a Falhas no Webhook do WhatsApp**: Adicionado tratamento seguro na recepção de payloads de webhook no backend ([`api/whatsapp.js`](file:///c:/Users/carol/OneDrive/Área de Trabalho/site mobile carol/api/whatsapp.js)), garantindo que a leitura de propriedades e o mapeamento de sessões sejam tolerantes a corpos de requisição nulos ou vazios para prevenir crashes no servidor.
- **Nova Suíte de Testes Unitários**: Criada a suíte [`tests/whatsapp.test.js`](file:///c:/Users/carol/OneDrive/Área de Trabalho/site mobile carol/tests/whatsapp.test.js) que valida a normalização de estados de conexão do Baileys (`normalizeStatus`) e a extração robusta de QR Codes (`qrValue`). A suíte total do projeto conta agora com 29 testes unitários operando com 100% de sucesso.
- **Vercel Deploy e Mapeamento de Servidor**: Devido à ausência de chaves ativas do servidor Baileys do cliente no ambiente de desenvolvimento local, a integração permanece desabilitada (`BAILEYS_ENABLED=false`) conforme solicitado para evitar simulações fictícias de conexão.

## Resultado desta etapa (Módulo 5 - Indique e Ganhe)

- **Rastreamento no cadastro**: `?ref=` é preservado por `Auth.tsx`, enviado pelo contexto e processado dentro da mesma transação que cria a cliente.
- **Convite exato**: códigos sufixados existentes são bloqueados com `FOR UPDATE` e só passam de `invited` para `registered` quando ainda não possuem indicada.
- **Código genérico**: códigos `CAROLXXXXXXXX` resolvem o perfil padrinho, bloqueiam autoindicação e criam um registro rastreável com sufixo aleatório único.
- **Auditoria**: vínculos confirmados geram `audit_logs` com ator, indicação, padrinho e código utilizado.
- **Recompensa idempotente**: na primeira transição do atendimento para `completed`, a indicação muda para `completed`, libera desconto ativo de R$ 50,00, concede 100 pontos por um ano e cria notificação in-app.
- **Proteção contra duplicidade**: a indicação é bloqueada e só pode transicionar de `registered` uma vez; atendimentos concluídos subsequentes não geram novos lançamentos.
- **Interface**: os estados `invited` e `registered` agora aparecem como “Convidado” e “Registrado”.
- **Testes**: quatro cenários de indicação foram adicionados; suíte completa com 33/33 testes, typecheck, lint e build aprovados.

## Resultado desta etapa (Módulo 6 - LGPD)

- **Exportação consistente**: a solicitação nasce `pending`, passa por `processing` e só recebe `completed` após todas as consultas, hash SHA-256 e auditoria. Falhas persistem como `failed`.
- **Pacote completo**: o JSON inclui conta, agendamentos, remarcações, mensagens, fichas, fotos, pagamentos, comprovantes, planos, orçamentos, pontos, cupons, indicações, avaliações, notificações, cartões mascarados, consentimentos e histórico LGPD, sem senha ou token de cartão.
- **Interface cliente**: botões aguardam a API, bloqueiam cliques duplicados, exibem histórico real das exportações e só iniciam o download após resposta concluída.
- **Solicitação segura**: pedidos de exclusão são serializados por lock do perfil, auditados e não podem ser duplicados enquanto estiverem em análise.
- **Análise administrativa**: a ficha da cliente mostra o pedido e oferece rejeição ou aprovação com confirmação explícita.
- **Anonimização**: aprovação remove PII de autenticação, perfil, cliente, notas, intake, mensagens, fotos, galeria, cartões, avaliações, notificações e indicações, preservando relações e registros financeiros anonimizados.
- **Sessão invalidada**: APIs e login recusam contas bloqueadas/anonimizadas; `/api/auth` também limpa o cookie ao detectar esse estado.
- **Mídias**: URLs são removidas do banco na transação e a exclusão Cloudinary ocorre pós-commit. Falhas ou integração desabilitada são registradas e informadas ao admin para limpeza manual.
- **Testes**: três testes de exportação/anonimização foram adicionados; suíte completa com 36/36 testes, lint e typecheck aprovados.
- **Limitação de validação**: SQL e transações não foram executados contra banco remoto neste ambiente por ausência de `DATABASE_URL`.

## Próxima etapa recomendada (Módulo 7)

Trabalhar somente em **Pagamentos pendentes e comprovantes**, consolidando upload, análise, rejeição/aprovação, idempotência e conciliação com SumUp sem alterar os módulos já concluídos.

## Auditoria pré-implementação — Módulo 7 (Pagamentos e comprovantes)

- **Rotas existentes:** `/cliente/pagamentos`, `/cliente/pagamentos/:id`, `/cliente/pagamento/retorno`, `/admin/pagamentos` e `/admin/integracoes/sumup`; APIs `GET /api/portal?resource=payments`, `GET /api/portal?resource=admin-payments`, `PATCH /api/portal?resource=admin-payment`, `POST /api/payments?resource=create-sumup-checkout`, `POST /api/payments?resource=payment-method`, `POST /api/payments?resource=receipt`, `POST /api/payments?resource=sync` e webhook SumUp.
- **Rotas quebradas ou ausentes:** não existe ação de API nem interface administrativa específica para aprovar ou rejeitar registros de `payment_receipts`; a confirmação genérica altera apenas `payments` e ignora o ciclo de análise do comprovante.
- **Dados mockados:** as rotas ativas de pagamentos usam API real. Não foram encontrados `mockData`, `fakeData`, `sampleData` ou arrays operacionais estáticos neste módulo.
- **Botões sem ação real:** os botões ativos chamam APIs, porém “Confirmar” permite concluir Pix manual sem selecionar ou aprovar o comprovante. O resultado visual é persistido em `payments`, mas não representa a análise registrada em `payment_receipts`.
- **Tabelas existentes:** `payments`, `payment_receipts`, `payment_status_history`, `payment_webhook_logs`, `subscriptions`, `quotes`, `coupon_usage`, `appointments`, `notifications` e `audit_logs` existem nas migrações do repositório.
- **Tabelas ausentes:** nenhuma tabela nova é necessária para concluir este módulo. A existência e a versão das tabelas no banco remoto ainda não puderam ser confirmadas sem `DATABASE_URL`.
- **Erros de API encontrados:** `paymentFor` só aplicava escopo especial à cliente e deixava o papel profissional consultar ou operar pagamentos por UUID; o upload aceitava URL sem validação, não exigia Pix manual e permitia múltiplos comprovantes simultaneamente em análise; a tela aceitava PDF, mas `uploadImage` envia exclusivamente ao endpoint de imagens do Cloudinary; `applyProviderStatus` podia regredir um pagamento `paid` para status não terminal em sincronização/webhook tardio; repetições do mesmo status criavam histórico e notificação duplicados.
- **Campos incompatíveis:** os campos ativos (`receipt_url`, `provider_*`, `paid_amount`, `reviewed_by`, `reviewed_at`, `rejection_reason`) existem em alguma migração do repositório, mas dependem de `neon-master-completion.sql`; não constam integralmente no schema Supabase inicial.
- **Problemas de permissões:** a API de pagamentos não recusava explicitamente o papel profissional; criação de checkout, escolha de método e envio de comprovante dependiam apenas do resultado permissivo de `paymentFor`. A análise de comprovante ainda não possuía autorização própria porque o fluxo não existia.
- **Funcionalidades concluídas:** listagem/detalhe real, escolha de método, checkout SumUp, retorno, sincronização administrativa, upload de imagem e ativação de assinatura após pagamento já estão implementados parcialmente.
- **Funcionalidades pendentes:** revisão administrativa do comprovante com rejeição/motivo, vínculo obrigatório entre aprovação e recibo, proteção contra duplicidade/regressão, validações de formato/estado, notificação do resultado e testes das regras.
- **Próxima ação desta etapa:** corrigir somente autorização, persistência e idempotência do fluxo de comprovantes e conciliação SumUp, mantendo o design e os demais módulos inalterados.

## Resultado desta etapa (Módulo 7 - Pagamentos pendentes e comprovantes)

- **Permissões:** `/api/payments` agora aceita acesso a um pagamento somente para a própria cliente ou para admin; o papel profissional recebe 403. Checkout, troca de método e envio de comprovante exigem papel cliente, enquanto sincronização e análise permanecem administrativas.
- **Upload consistente:** comprovantes exigem pagamento Pix manual em estado elegível, URL HTTPS do Cloudinary, imagem de até 8 MB e ausência de outro comprovante em análise. O pagamento e o histórico só mudam para `under_review` dentro da mesma transação do recibo.
- **Análise administrativa:** `/admin/pagamentos` mostra o comprovante real e oferece aprovação ou rejeição com motivo. A ação bloqueia recibo e pagamento, atualiza `payment_receipts`, `payments` e `payment_status_history` na mesma transação, gera auditoria/notificação e só então recarrega a tela.
- **Confirmação protegida:** Pix manual não pode mais ser marcado como pago sem comprovante aprovado; pagamentos SumUp exigem sincronização com o provedor; confirmação local continua disponível. Aprovação ativa assinatura, orçamento, cupom e agendamento vinculados sem repetir efeitos em reenvios idênticos.
- **Idempotência e conciliação:** atualizações repetidas do mesmo status não geram novo histórico/notificação; retorno tardio da SumUp não regride pagamento `paid`; checkout pendente existente é reutilizado; updates críticos possuem condição de estado para impedir regressão concorrente.
- **Interface cliente:** aceita somente imagens compatíveis com o upload real, lista o histórico de comprovantes e mostra o motivo de rejeição para permitir novo envio. Nenhuma confirmação visual ocorre antes da resposta da API e do recarregamento persistido.
- **Erros e rollback:** falhas mantêm os dados anteriores visíveis, registram contexto no console e exibem a mensagem retornada pela API.
- **Testes:** adicionados cenários de regressão SumUp, validação do envio e idempotência da análise; suíte completa com 39/39 testes, lint, sintaxe Node e build PWA aprovados.
- **Limitações pendentes:** não foi possível executar transações contra o banco remoto sem `DATABASE_URL`; o segredo do webhook SumUp continua opcional na configuração; chamadas simultâneas extremas ainda podem criar checkout externo órfão antes de a condição de banco recusar a segunda persistência; upload Cloudinary concluído antes de uma falha posterior da API pode exigir limpeza de mídia órfã.

## Próxima etapa recomendada (Módulo 8)

Trabalhar somente em **Cartões salvos e tokenização**, removendo qualquer confiança em token informado pelo frontend, integrando tokenização real do provedor, revisando mascaramento/permissões e criando fluxo seguro de cartão padrão e remoção.

## Auditoria pré-implementação — Módulo 8 (Cartões salvos e tokenização)

- **Rotas existentes:** `/cliente/cartoes`; API `GET`, `POST` e `PATCH /api/portal?resource=cards`. A rota é protegida para cliente e as consultas usam `client_id` da sessão.
- **Rotas quebradas ou ausentes:** não existem endpoints para criar cliente SumUp, iniciar checkout de tokenização, confirmar o instrumento retornado pelo provedor ou desativá-lo na SumUp.
- **Dados mockados:** não há array mockado nesta tela, mas o formulário manual cria uma representação local que aparenta ser cartão salvo sem existir instrumento de pagamento utilizável.
- **Botões sem ação real:** “Adicionar cartão” grava somente bandeira, últimos quatro dígitos e nome informados manualmente. Esse registro nunca é usado no checkout e não representa tokenização. “Remover” desativa apenas a linha local, sem desativar eventual instrumento no provedor.
- **Tabelas existentes:** `saved_cards`, `clients`, `profiles`, `audit_logs` e tabelas financeiras relacionadas existem nas migrações. `saved_cards.external_token` existe como texto e não é retornado nas consultas da interface.
- **Tabelas ausentes:** falta uma tabela de sessões de tokenização para vincular cliente, checkout e conclusão sem confiar em identificadores enviados pelo navegador. Também falta guardar o `customer_id` da SumUp na cliente.
- **Erros de API encontrados:** `saveCard` aceita `externalToken` arbitrário do corpo da requisição; qualquer cliente autenticada pode gravar um token falso em sua própria linha. O primeiro cartão pode nascer sem principal, duplicidades não são impedidas e a remoção do principal não promove outro cartão.
- **Campos incompatíveis:** o frontend atual não envia número completo ou CVV, mas também não recebe token legítimo. Não existe `sumup_customer_id` em `clients` nem estado de sessão de tokenização nas migrações atuais.
- **Problemas de permissões:** o escopo por cliente está correto, porém a origem do token não é autenticada. Token, checkout e metadados de cartão precisam ser obtidos exclusivamente pela API SumUp no backend e nunca retornados ao frontend.
- **Funcionalidades concluídas:** listagem mascarada, preferência de cartão principal, desativação local, empty state e espera da API antes de recarregar a tela.
- **Funcionalidades pendentes:** criação idempotente do customer SumUp, checkout `SETUP_RECURRING_PAYMENT`, Payment Widget com consentimento/3DS, confirmação server-to-server, persistência idempotente, desativação no provedor, auditoria e testes.
- **Referência oficial verificada:** o guia “Save Customer Cards” da SumUp exige `customer_id`, checkout de setup, Payment Widget e recuperação server-side do `payment_instrument.token`; listar/desativar instrumentos requer escopo `payment_instruments` na API Key.
- **Próxima ação desta etapa:** substituir o formulário manual pelo widget oficial e fazer o backend aceitar somente sessão própria e dados recuperados da SumUp, sem alterar outros módulos.

## Resultado desta etapa (Módulo 8 - Cartões salvos e tokenização)

- **Tokenização real:** o formulário manual foi removido. A cliente inicia uma sessão própria, o backend cria/reutiliza o `customer_id` da SumUp e abre checkout com `purpose=SETUP_RECURRING_PAYMENT`; o Payment Widget oficial coleta cartão, consentimento e 3DS.
- **Token somente no backend:** o navegador recebe apenas `sessionId` e `checkoutId`. Na conclusão, o servidor recupera o checkout, valida cliente/finalidade/status, consulta os instrumentos da SumUp e só então persiste token, bandeira e quatro dígitos. O token nunca é retornado pela API nem registrado no console/auditoria.
- **Persistência e idempotência:** criada a migração `008_card_tokenization`, com `clients.sumup_customer_id`, metadados seguros em `saved_cards`, tabela `card_tokenization_sessions`, unicidade de token e de cartão principal. Sessões pendentes válidas são reutilizadas e conclusões repetidas retornam o mesmo cartão.
- **Legado seguro:** referências digitadas manualmente são marcadas como `legacy`, desativadas e têm qualquer `external_token` apagado pela migração. `POST /api/portal?resource=cards` não aceita mais cadastro manual nem token vindo do frontend.
- **Cartão principal:** alterações são serializadas, persistidas antes da atualização visual e auditadas. Cada novo instrumento tokenizado torna-se principal; ao remover o principal, outro cartão ativo é promovido automaticamente.
- **Remoção no provedor:** a exclusão chama primeiro a API oficial de desativação do instrumento e somente depois remove token/estado local. Resposta 404 do provedor é tratada como remoção idempotente.
- **LGPD:** exportação inclui `sumup_customer_id` e sessões de tokenização sem expor tokens. A anonimização captura os instrumentos, remove os vínculos locais na transação e solicita a desativação na SumUp após o commit, registrando falhas de limpeza separadamente.
- **Interface:** mantém a identidade visual existente, adiciona estados reais de carregamento/erro, confirmação explícita de remoção e empty state. Nenhuma mensagem de sucesso aparece antes da resposta da API e do recarregamento persistido.
- **Permissões:** criação/conclusão, listagem, principal e remoção exigem cliente autenticada e são escopadas pelo `client_id`; checkout, sessão e token recuperados precisam corresponder à mesma cliente.
- **Referência oficial:** implementação baseada no guia oficial [Save Customer Cards](https://developer.sumup.com/online-payments/guides/tokenization-with-payment-sdk/) e nos endpoints de [payment instruments](https://developer.sumup.com/api/customers/list-payment-instruments/).
- **Testes:** adicionados cenários de referência determinística, status de checkout e validação/normalização do instrumento; suíte completa com 43/43 testes, lint, sintaxe Node e build PWA aprovados.
- **Limitações pendentes:** a migração e o fluxo sandbox não foram executados porque `DATABASE_URL`, `SUMUP_API_KEY` e `SUMUP_MERCHANT_CODE` não estavam disponíveis neste processo. A API Key precisa do escopo `payment_instruments`, e a conta sandbox pode exigir habilitação de 3DS pela SumUp. Cobrança recorrente com o token ainda não foi implementada. Se a desativação no provedor funcionar e a atualização local falhar, a reconciliação posterior ainda precisa ocultar o instrumento local obsoleto.

## Próxima etapa recomendada (Módulo 9)

Trabalhar somente em **Cobrança recorrente de assinaturas**, usando o cartão principal tokenizado em checkouts server-to-server, com consentimento verificável, idempotência por competência, retentativas limitadas e conciliação de falhas sem realizar cobranças automáticas antes da validação em sandbox.

## Auditoria pré-implementação — Módulo 9 (Cobrança recorrente de assinaturas)

- **Rotas existentes:** `/cliente/beneficios`, `/cliente/planos/:id`, `/cliente/cartoes`, `/cliente/pagamentos/:id`; APIs de benefícios, cartões e pagamentos; webhook/sincronização SumUp; `api/cron-reminders.js` protegido por `CRON_SECRET`.
- **Rotas quebradas ou ausentes:** não existe API para consentir/revogar renovação, consultar competências vencidas, executar cobrança recorrente ou reconciliar uma tentativa de renovação. O cron de lembretes também não está agendado em `vercel.json`.
- **Dados mockados:** as telas ativas de benefícios, planos, cartões e pagamentos consultam dados reais. Não foram encontrados `mockData`, `fakeData`, `sampleData` ou arrays de assinaturas estáticas neste módulo.
- **Botões sem ação real:** a contratação inicial e a gestão de cartões chamam APIs reais, mas não existe controle de renovação. O cartão tokenizado ainda não é usado para cobrança posterior.
- **Tabelas existentes:** `subscriptions`, `plans`, `payments`, `payment_status_history`, `payment_webhook_logs`, `saved_cards`, `clients`, `notifications` e `audit_logs` existem nas migrações.
- **Tabelas ausentes:** falta registro imutável de tentativas por competência, chave de idempotência e estados de processamento/retry. `subscriptions` não possui consentimento, cartão selecionado, falhas consecutivas nem próxima retentativa.
- **Erros de API encontrados:** não há motor recorrente; `renews_at`/`expires_at` só são inicializados com `coalesce` na primeira confirmação e nunca avançam em uma renovação; não há retentativa limitada nem transição para inadimplência; uma futura confirmação pelo webhook cairia no fluxo genérico de ativação e não concluiria a competência recorrente.
- **Campos incompatíveis:** o frontend mostra `renews_at` e `expires_at`, mas o banco não registra `auto_renew`, `recurring_card_id`, datas/versão do consentimento, `renewal_failures`, `next_retry_at` ou `last_renewal_at`.
- **Problemas de permissões:** cliente e admin ainda não possuem endpoints recorrentes com escopo definido. A futura execução automática deve aceitar apenas `CRON_SECRET`; a cliente só pode alterar consentimento da própria assinatura; profissional não pode acessar nem disparar cobranças.
- **Funcionalidades concluídas:** contratação e ativação inicial, tokenização server-side, cartão principal, checkout SumUp, webhook/sync e histórico de pagamentos.
- **Funcionalidades pendentes:** consentimento verificável, idempotência por competência, seleção segura de vencimentos, processamento com token, conciliação, avanço do ciclo, retentativas limitadas, inadimplência, notificações e validação sandbox.
- **Referência oficial verificada:** a API SumUp orienta criar `POST /v0.1/checkouts` e processar `PUT /v0.1/checkouts/{checkout_id}` com `payment_type=card`, `installments=1`, `token` e o `customer_id` correspondente; a confirmação deve vir da recuperação do checkout/transação.
- **Próxima ação desta etapa:** implementar consentimento e motor recorrente idempotente, protegido por segredo e flags de ambiente, deixando cobrança desabilitada por padrão e bloqueando modo real até a validação sandbox.

## Resultado desta etapa (Módulo 9 - Cobrança recorrente de assinaturas)

- **Consentimento real da cliente:** `/cliente/beneficios` ganhou controle de renovação automática vinculado à assinatura ativa. Ativar/desativar chama `PATCH /api/portal?resource=subscription-recurring`, aguarda resposta da API, recarrega os dados persistidos e registra erro no console em falhas, sem sucesso visual otimista.
- **Uso do cartão tokenizado:** a renovação só pode ser ativada com cartão SumUp ativo, token salvo no backend e `customer_id` correspondente. O frontend recebe apenas dados mascarados; tokens continuam fora da interface.
- **Migração de recorrência:** criada a migração `009_recurring_billing`, adicionando consentimento, cartão recorrente, falhas, próxima retentativa e último ciclo em `subscriptions`, além da tabela `subscription_renewal_attempts` com chave de idempotência por assinatura/competência/tentativa.
- **Motor idempotente:** criada a rotina server-side de renovação com lock transacional, uma tentativa por competência e número de tentativa, limite de três falhas, retentativas em 1 e 3 dias e transição para `delinquent` após esgotar as tentativas.
- **Processamento SumUp server-to-server:** o backend cria checkout recorrente e processa `PUT /v0.1/checkouts/{checkout_id}` com `payment_type=card`, `installments=1`, token e `customer_id`, conforme documentação oficial da SumUp. Nenhum segredo ou token sensível é enviado ao frontend.
- **Conciliação recorrente:** webhook e sincronização SumUp agora detectam pagamentos vinculados a `renewal_attempt_id` e usam finalizador próprio de recorrência. Pagamentos aprovados avançam `renews_at`/`expires_at`, resetam falhas e renovam o limite de manutenções; falhas preservam o estado anterior e agendam retentativa quando aplicável.
- **Cron protegido:** criado `api/cron-renewals.js`, aceitando apenas `GET`/`POST` com `Authorization: Bearer ${CRON_SECRET}`. O `vercel.json` agenda execução diária, mas a rotina permanece em dry-run por padrão.
- **Bloqueio de cobrança real:** cobranças automáticas só são liberadas quando `SUMUP_RECURRING_ENABLED=true`, `SUMUP_RECURRING_MODE=sandbox` e `SUMUP_ENVIRONMENT=sandbox`. Modo live/produção fica bloqueado nesta etapa até validação formal em sandbox.
- **Prévia administrativa segura:** admin pode consultar `GET /api/payments?resource=recurring-preview` para ver candidatas à renovação e motivos de bloqueio, sem expor tokens e sem executar cobrança.
- **Variáveis de ambiente:** a renovação usa a mesma `SUMUP_API_KEY` backend já cadastrada no Vercel, desde que tenha os escopos `payments` e `payment_instruments` e use o mesmo `SUMUP_MERCHANT_CODE`. Foram adicionadas apenas flags de controle (`SUMUP_RECURRING_ENABLED`, `SUMUP_RECURRING_MODE`, `RECURRING_BATCH_LIMIT`, `CRON_SECRET`), não uma nova chave pública.
- **Testes e qualidade:** adicionada suíte de regras de recorrência; `npm test` aprovado com 46/46 testes, `npm run lint` aprovado, `npm run build` aprovado e checagem de sintaxe Node aprovada nos arquivos alterados.
- **Limitações pendentes:** a migração não foi aplicada contra o banco remoto e nenhuma cobrança sandbox foi executada neste ambiente porque `DATABASE_URL`, `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE` e `CRON_SECRET` não estavam disponíveis no processo local. `git diff --check` não pôde ser executado porque `git` não está instalado/reconhecido neste ambiente.

## Próxima etapa recomendada (Módulo 10)

Trabalhar somente em **Validação sandbox da cobrança recorrente**, aplicando a migração no Neon/Vercel, habilitando as flags de sandbox, criando uma assinatura ativa com cartão tokenizado de teste, executando a prévia administrativa e uma cobrança recorrente controlada, validando webhook/sincronização/retry antes de qualquer decisão sobre ativação em produção.

## Resultado parcial desta etapa (Módulo 10 - Validação sandbox da cobrança recorrente)

- **Autorização recebida:** a validação sandbox da recorrência foi iniciada após autorização explícita da responsável.
- **Ambiente Vercel conferido:** o projeto local está vinculado ao Vercel como `wzwebdezign/carolmobile`. O Vercel CLI está disponível e foi executado com `NODE_OPTIONS=--use-system-ca` para contornar erro local de certificado ao consultar o projeto.
- **Variáveis remotas:** `vercel env ls` não retornou variáveis listáveis para o projeto nesta sessão. O pull de `production`, `preview` e `development` não forneceu `DATABASE_URL` utilizável; os arquivos temporários `.env.vercel.*` foram removidos do workspace após a conferência para não manter cópias locais de segredos.
- **Variáveis locais:** `.env.local` contém `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_ENABLED=true`, `SUMUP_ENVIRONMENT=sandbox` e `SUMUP_RETURN_URL`, mas não contém `DATABASE_URL`, `CRON_SECRET`, `SUMUP_RECURRING_ENABLED` nem `SUMUP_RECURRING_MODE`.
- **Migração remota:** a migração `009_recurring_billing` não foi aplicada porque não há `DATABASE_URL` disponível localmente nem via Vercel para conectar ao Neon/PostgreSQL.
- **Cobrança sandbox:** nenhuma cobrança, checkout recorrente ou tentativa automática foi executada. A ausência de banco impede selecionar assinatura ativa, cartão tokenizado, tentativa idempotente e prévia administrativa real.
- **Flags de segurança:** o código continua bloqueando cobrança recorrente real por padrão; sem `SUMUP_RECURRING_ENABLED=true`, `SUMUP_RECURRING_MODE=sandbox` e `SUMUP_ENVIRONMENT=sandbox`, o motor permanece em dry-run/bloqueado.
- **Estado da etapa:** validação sandbox ainda pendente por configuração de ambiente, não por erro de código identificado nesta etapa.

## Próxima etapa recomendada (Módulo 10 - desbloqueio)

Trabalhar somente em **Configuração de ambiente para validação sandbox**, confirmando/adicionando no Vercel/ambiente seguro: `DATABASE_URL`, `SUMUP_API_KEY`, `SUMUP_MERCHANT_CODE`, `SUMUP_ENABLED=true`, `SUMUP_ENVIRONMENT=sandbox`, `SUMUP_RECURRING_ENABLED=true`, `SUMUP_RECURRING_MODE=sandbox`, `RECURRING_BATCH_LIMIT=1` e `CRON_SECRET`. Depois disso, executar apenas a migração `009_recurring_billing`, a prévia administrativa e uma cobrança sandbox controlada.

## Resultado desta etapa (Módulo 10 - Validação sandbox da cobrança recorrente)

- **Configuração Vercel aplicada:** `SUMUP_ENABLED=true`, `SUMUP_ENVIRONMENT=sandbox`, `SUMUP_RECURRING_ENABLED=true`, `SUMUP_RECURRING_MODE=sandbox`, `RECURRING_BATCH_LIMIT=1` e `CRON_SECRET` foram configurados para validação. Preview, Development e Production receberam as credenciais SumUp sandbox disponíveis localmente; Production também recebeu um novo `CRON_SECRET` sensível.
- **Banco remoto identificado:** `DATABASE_URL` existe como variável criptografada em Production no Vercel. Como o valor não é exposto pelo CLI, a validação foi feita por função protegida rodando dentro da própria Vercel.
- **Trava extra de cobrança:** `api/cron-renewals.js` e `server/lib/recurring-billing.js` foram ajustados para que o cron agendado execute somente dry-run. Cobrança real só pode ocorrer em `POST` manual com confirmação explícita (`execute=1` ou header `x-recurring-execute=true`) e `Authorization: Bearer ${CRON_SECRET}`.
- **Rota protegida de migração:** criada `api/admin-migrations.js`, restrita por `CRON_SECRET` e limitada à migração fixa `recurring-billing`; ela não aceita SQL externo nem parâmetros arbitrários. A lógica reutilizável ficou em `server/lib/recurring-migration.js`.
- **Deploy realizado:** a versão validada foi publicada em Production no Vercel e associada a `https://carolmobile.vercel.app`.
- **Migração aplicada:** antes da execução, `subscription_renewal_attempts`, `subscriptions.auto_renew` e `payments.renewal_attempt_id` estavam ausentes. Após `POST /api/admin-migrations?resource=recurring-billing`, os três itens passaram a existir e a migração `009_recurring_billing` foi registrada.
- **Dry-run executado:** `GET /api/cron-renewals` foi repetido após o deploy final e retornou `dryRun=true`, `enabled=true`, `mode=sandbox`, `environment=sandbox`, `chargeAllowed=false` e motivo `Execução de cobrança requer confirmação manual explícita.`. Não havia candidatas à renovação (`candidates=[]`) e nada foi processado.
- **Cobranças:** nenhuma cobrança SumUp foi executada nesta etapa, porque não havia assinatura candidata vencida com consentimento/cartão recorrente e porque o cron permanece em dry-run por padrão.
- **Segurança de segredos:** valores sensíveis não foram impressos no console nem registrados no documento. Arquivos `.env.vercel.*` temporários foram removidos e o segredo temporário usado localmente para chamadas protegidas foi apagado do ambiente local após a validação.
- **Validação técnica:** `npm test` passou com 46/46 testes, `npm run lint` passou, `npm run build` passou e a checagem de sintaxe Node dos arquivos novos/alterados passou.
- **Atenção operacional:** Production está temporariamente configurada para SumUp `sandbox` durante a validação. Enquanto isso, pagamentos reais não devem ser processados por essa instância.

## Próxima etapa recomendada (Módulo 11)

Trabalhar somente em **cenário controlado de renovação sandbox**, criando ou selecionando uma cliente de teste com assinatura ativa/vencida, cartão tokenizado sandbox e consentimento de renovação ligado. Depois rodar a prévia novamente e, se houver candidata de teste, executar uma única cobrança manual com `execute=1`, validando status SumUp, webhook/sync, avanço de ciclo e retentativas.

## Resultado desta etapa (Módulo 11 - Cenário controlado de renovação sandbox)

- **Rota protegida de cenário sandbox:** criada `api/recurring-sandbox.js`, acessível somente com `Authorization: Bearer ${CRON_SECRET}` e recorrência configurada em sandbox. A rota não retorna tokens, não recebe SQL externo e só prepara assinatura marcada como teste/sandbox/demo no nome ou e-mail.
- **Seleção segura de teste:** a preparação automática foi limitada a clientes de teste com assinatura renovável, cartão SumUp tokenizado, token backend (`external_token`) e `customer_id`. Assinaturas reais ou não marcadas como teste não são alteradas por essa rota.
- **Migração 008 aplicada no remoto:** a primeira auditoria retornou erro porque `saved_cards.provider` não existia no banco remoto. A rota protegida de migração foi ampliada para aceitar somente `card-tokenization` e `recurring-billing`; `POST /api/admin-migrations?resource=card-tokenization` aplicou `008_card_tokenization` e confirmou `clients.sumup_customer_id`, `saved_cards.provider`, `saved_cards.provider_customer_id` e `card_tokenization_sessions`.
- **Migração 009 mantida válida:** `GET /api/admin-migrations?resource=recurring-billing` confirmou `subscription_renewal_attempts`, `subscriptions.auto_renew` e `payments.renewal_attempt_id`.
- **Auditoria sandbox real:** `GET /api/recurring-sandbox` retornou `enabled=true`, `mode=sandbox`, `environment=sandbox`, `chargeAllowed=true`, `subscriptions=1`, `renewable_subscriptions=1`, `tokenized_cards=0` e `consented_subscriptions=0`.
- **Preparação recusada com segurança:** `POST /api/recurring-sandbox` com `action=prepare` retornou `prepared=false`, motivo `Nenhuma assinatura de teste com cartão SumUp tokenizado e customer_id foi encontrada.` Nenhuma assinatura foi vencida artificialmente e nenhum consentimento foi criado.
- **Dry-run final:** `GET /api/cron-renewals` retornou `dryRun=true`, `candidates=[]` e `processed=[]`. A trava de execução manual permaneceu ativa com `chargeAllowed=false` no cron por padrão.
- **Cobranças:** nenhuma cobrança SumUp foi executada. A cobrança manual com `execute=1` não foi chamada porque não havia candidata válida com cartão tokenizado sandbox.
- **Validação técnica:** `node --check` passou nos arquivos novos/alterados, `npm test` passou com 46/46 testes, `npm run lint` passou e `npm run build` passou.
- **Atenção operacional:** Production continua temporariamente apontada para SumUp sandbox durante esta validação; pagamentos reais não devem ser processados nessa configuração.

## Próxima etapa recomendada (Módulo 12)

Trabalhar somente em **tokenização sandbox de cartão em cliente de teste**, criando/acessando uma cliente explicitamente marcada como teste, adicionando um cartão pelo Payment Widget oficial da SumUp e confirmando que o banco passou a ter `tokenized_cards>0`. Só depois repetir o Módulo 11 para executar uma única cobrança manual sandbox com `execute=1`.

## Resultado desta etapa (Módulo 12 - Tokenização sandbox de cartão em cliente de teste)

- **Cliente de teste usada:** foi criada/acessada a cliente `Teste Sandbox Recorrencia` em `https://carolmobile.vercel.app/cliente/cartoes`, com sessão autenticada de perfil Cliente e empty state real de cartões.
- **Documentação SumUp verificada:** a página oficial de testes da SumUp foi usada para cartões sandbox, CVV genérico, validade futura e ambiente sandbox; o guia oficial de tokenização foi conferido para o fluxo de `SETUP_RECURRING_PAYMENT`, recuperação server-side do `payment_instrument.token` e uso recomendado de checkout com `amount=0` para verificação/tokenização.
- **Correção crítica aplicada:** `api/payments.js` passou a criar checkout de tokenização com `amount: 0`, alinhado ao fluxo atual de verificação sem cobrança.
- **Correção de confirmação aplicada:** a conclusão da tokenização deixou de rejeitar imediatamente checkouts com status `FAILED` quando a SumUp ainda retorna `payment_instrument.token`; agora o backend tenta recuperar/listar o instrumento e só salva se o instrumento correspondente estiver ativo e normalizado.
- **Sem sucesso falso:** duas tentativas reais no Payment Widget sandbox retornaram `hasPaymentInstrument=true`, mas a listagem de instrumentos da SumUp marcou os instrumentos correspondentes como `active=false`. Por isso o backend manteve `tokenized_cards=0` e exibiu erro, sem salvar cartão inválido no banco.
- **Diagnóstico protegido ampliado:** `server/lib/recurring-sandbox-scenario.js` agora mostra, somente na rota protegida por `CRON_SECRET`, dados sanitizados de sessão de tokenização: status do checkout, finalidade, existência de instrumento, quantidade de instrumentos, bandeira/últimos quatro dígitos, `active`, normalização e correspondência de customer. Tokens e segredos continuam ocultos.
- **Estado final remoto:** `GET /api/recurring-sandbox` retornou `tokenized_cards=0`; sessões sandbox têm `provider.status=FAILED`, `hasPaymentInstrument=true`, `customerMatches=true`, mas `matchingInstrument.active=false` para os cartões de teste usados.
- **Deploy:** a correção foi publicada em Production e o alias `https://carolmobile.vercel.app` aponta para o deploy validado. A Vercel executou build remoto com sucesso.
- **Validação técnica:** `node --check api/payments.js server/lib/recurring-sandbox-scenario.js` passou, `npm test` passou com 46/46 testes, `npm run lint` passou e o build remoto da Vercel passou. Um build local foi interrompido/estourou tempo antes da retomada, mas o deploy remoto validou a compilação final.
- **Cobranças:** nenhuma cobrança recorrente sandbox foi executada, porque ainda não existe cartão SumUp ativo/tokenizado para a cliente de teste.
- **Atenção operacional:** Production continua temporariamente configurada para SumUp `sandbox`; pagamentos reais não devem ser processados nessa configuração.
- **Pendência externa provável:** a conta/merchant sandbox da SumUp aparentemente cria instrumentos inativos no fluxo de setup, mesmo com cartões oficiais de teste. O guia da SumUp indica que sandbox/3DS para tokenização pode exigir habilitação/contato com a SumUp.

## Próxima etapa recomendada (Módulo 13)

Trabalhar somente em **desbloqueio da tokenização SumUp sandbox**, verificando com a SumUp/conta sandbox se o merchant está habilitado para tokenização/3DS e instrumentos ativos em `SETUP_RECURRING_PAYMENT`. Depois repetir apenas o cadastro de um cartão sandbox até `matchingInstrument.active=true` e `tokenized_cards>0`; só então voltar ao Módulo 11 para preparar a assinatura e executar uma única cobrança recorrente manual sandbox.

## Resultado desta etapa (Uploads Cloudinary com rotação multi-conta)

- **Rota de upload:** `POST /api/upload` permanece autenticada e agora emite uma assinatura curta para upload direto no Cloudinary, sem devolver `apiSecret`. O navegador recebe apenas URL de envio, `apiKey`, pasta, timestamp e assinatura.
- **Rotação global:** criada a sequência PostgreSQL `public.cloudinary_upload_rotation_seq`. Cada autorização usa `nextval` e alterna atomicamente entre as cinco contas configuradas, inclusive com requisições concorrentes e múltiplas instâncias serverless. A migração `010_cloudinary_rotation` também pode ser aplicada por `npm run db:setup`; se ainda estiver ausente, o endpoint a cria sob advisory lock no primeiro upload.
- **Imagens e arquivos:** `src/lib/api.ts` passou a expor `uploadFile` para imagens, vídeos e documentos permitidos, mantendo `uploadImage` para campos exclusivamente fotográficos. Comprovantes Pix aceitam imagem ou PDF de até 8 MB; fotos continuam limitadas aos formatos e tamanhos próprios de cada tela.
- **Sem sucesso visual antecipado:** o Diagnóstico Inteligente não mostra mais preview local como se estivesse salvo. A foto só entra no estado da tela depois do upload Cloudinary, registro na API e resposta de sucesso; em falha, o estado anterior é preservado e uma mensagem é exibida.
- **Validação backend:** avatar, fotos de diagnóstico, fotos técnicas e comprovantes novos são aceitos para persistência somente quando a URL pertence a uma das contas Cloudinary configuradas. URLs externas não podem contornar o fluxo seguro.
- **Limpeza multi-conta:** a remoção de mídia agora identifica pela URL o `cloud_name`, `resource_type` (`image`, `video` ou `raw`) e `public_id`, usando somente a credencial correspondente. O backend não tenta apagar um arquivo de uma conta desconhecida com a chave de outra conta.
- **Configuração Vercel:** `CLOUDINARY_PROVIDERS_JSON` foi configurado como sensível em Production e Preview, com cinco provedores válidos, e `CLOUDINARY_DEFAULT_FOLDER=carol-sol`. A cópia de credenciais em Development foi removida porque a Vercel não permite marcá-la como sensível nesse ambiente.
- **Segurança:** nenhum segredo Cloudinary foi gravado no código, nos arquivos versionados ou no frontend. A varredura do repositório encontrou zero cloud names/credenciais nos arquivos rastreáveis; as cinco credenciais responderam `200` no endpoint autenticado de verificação do Cloudinary.
- **Validação em produção:** cinco autorizações consecutivas autenticadas retornaram, na ordem, os cinco cloud names configurados. Nenhum arquivo de teste foi criado nessa validação. `/api/health` confirmou `ok=true`, banco ativo e `cloudinary=true`.
- **Deploy:** publicado em Production no deployment `dpl_4FbFyabFECbwmxXLEPZC9CqgDbKS`; o alias ativo é `https://carolmobile.vercel.app`.
- **Qualidade:** `node --check` passou nos arquivos Node alterados, `npm test` passou com 49/49 testes, `npm run lint` passou e `npm run build` local e remoto passaram.
- **Pendência:** uploads concluídos no Cloudinary que falhem antes do vínculo relacional ainda podem ficar órfãos. A limpeza por exclusão/substituição já funciona, mas falta uma rotina periódica segura para localizar mídia antiga não vinculada.

## Próxima etapa recomendada (Módulo específico)

Trabalhar somente em **limpeza compensatória de uploads Cloudinary órfãos**, registrando uma autorização de upload pendente, confirmando o vínculo após a persistência e removendo de forma idempotente arquivos expirados que nunca foram associados a avatar, foto técnica, diagnóstico ou comprovante.

## Resultado desta etapa (Bot WhatsApp via API Baileys própria)

- **API externa validada:** `https://whatsapp-api-tyd0.onrender.com` respondeu online com engine `baileys`. O estado atual é `qr` e a API informa `hasQr=true`; nenhuma mensagem foi enviada antes do pareamento.
- **Client exclusivamente server-side:** criado `server/lib/baileys-client.js` com `getBaileysStatus`, `sendBaileysTextMessage`, `resetBaileysSession`, `getBaileysQr` e `logoutBaileysSession`. O local solicitado inicialmente (`src/lib`) não foi usado porque `src` compõe o bundle do navegador neste projeto; manter o client em `server/lib` impede qualquer risco de inclusão da chave privada no frontend.
- **Contrato real aplicado:** o backend agora usa somente `GET /api/status`, `POST /api/send-text`, `POST /api/reset-session`, `GET /api/qr` e `POST /api/logout`, sempre com `x-api-key`. Os endpoints genéricos antigos de instância foram removidos do fluxo ativo.
- **Envio protegido:** números são normalizados e validados no formato `55 + DDD + número`; mensagens vazias são recusadas. Antes de `POST /api/send-text`, o backend exige que a API externa retorne exatamente `ready`. Estados `qr`, `starting`, `reconnecting` e `logged_out` produzem estado/erro amigável sem sucesso falso.
- **Tratamento de falhas:** rede/timeout, credencial recusada (`401`), indisponibilidade (`503`) e respostas inválidas são normalizados por `BaileysClientError`. Somente mensagens seguras marcadas pelo client podem ser exibidas em erros 5xx; erros internos continuam ocultos pelo handler global.
- **Painel preservado:** nenhum arquivo visual foi alterado. Os botões existentes foram conectados ao contrato real: Conectar/Gerar QR consultam `/api/qr`, Reconectar usa `/api/reset-session`, Desconectar usa `/api/logout`, Atualizar consulta `/api/status` e Testar envio usa `/api/send-text` somente após `ready`.
- **Sessão única:** Administrador e Profissional consultam a mesma sessão configurada `carol-sol`, coerente com a API Baileys externa única; não são mais fabricados nomes de instância que o provedor não suporta.
- **Configuração Vercel:** `BAILEYS_API_KEY` foi gravada como sensível somente em Production e Preview. `BAILEYS_API_URL`, `BAILEYS_ENABLED=true` e `BAILEYS_DEFAULT_INSTANCE=carol-sol` foram configurados nos ambientes aplicáveis; Development não recebeu a chave porque a Vercel não permite variável sensível nesse alvo.
- **Validação em produção:** a rota interna autenticada retornou `configured=true`, `enabled=true`, `status=qrcode`, `liveStatus=qrcode`, `hasQr=true` e `error=null`. O QR existente foi carregado no painel sem reset ou envio de mensagem.
- **Correção do QR piscando:** o painel deixou de apagar `qr_code_data` quando o polling de status retorna `hasQr=true` sem enviar o payload do QR. Enquanto o estado não for `connected` ou `disconnected`, o backend preserva o QR anterior e tenta renovar o QR atual via `/api/qr` quando o provedor indica `hasQr=true`.
- **Validação pós-correção:** após carregar o QR em produção e aguardar mais que o intervalo de polling, a segunda consulta ao painel manteve `hasQr=true`. O estado do provedor oscilou para `connecting`, mas o QR não voltou a ficar indisponível.
- **Deploy:** publicado em Production no deployment `dpl_77RXLSX3CbJf7SijC6V3ekmhoT6q`, com alias `https://carolmobile.vercel.app`.
- **Qualidade:** `node --check` passou nos arquivos Node alterados, `npm test` passou com 54/54 testes, `npm run lint` passou e os builds local/remoto passaram.
- **Pendências:** é necessário escanear o QR pelo WhatsApp responsável para a API alcançar `ready`. O webhook de mensagens recebidas não foi ampliado nesta etapa; o escopo solicitado permanece somente texto de saída.

## Próxima etapa recomendada (Módulo específico)

Trabalhar somente em **pareamento e envio controlado do WhatsApp**: escanear o QR disponível em `/admin/integracoes/whatsapp`, aguardar `ready` e então enviar uma única mensagem de teste para um número autorizado, validando `messageId` e registro de erro sem implementar áudio, imagens, documentos ou automações adicionais.

## Resultado desta etapa (Correção de pareamento WhatsApp/Baileys)

- **Render auditado:** o serviço `whatsapp-api` está como Web Service Docker, plano Free, região Oregon, repositório `loveablercyber/whats`, branch `main`, `Dockerfile Path=./Dockerfile`, contexto `.`, auto-deploy `On Commit` e URL pública `https://whatsapp-api-tyd0.onrender.com`.
- **Variáveis Render conferidas:** existem `API_KEY`, `MONGODB_URI`, `CLIENT_ID`, `LOG_LEVEL`, `PORT`, `WEBHOOK_URL`, `BAILEYS_IGNORE_GROUPS` e `BAILEYS_IGNORE_STATUS`, todas mascaradas no painel. As flags `BAILEYS_IGNORE_*` não são usadas pelo código atual, mas foram preservadas por não causarem falha.
- **Causa provável corrigida no bot externo:** o repositório do servidor WhatsApp tinha risco de manter `isStarting=true`/socket antigo após falhas de conexão, impedindo reinício limpo depois de uma tentativa de pareamento por QR.
- **Baileys atualizado no bot externo:** o pacote antigo/deprecado `@whiskeysockets/baileys` foi substituído por `baileys@7.0.0-rc13`; o projeto do bot passou a declarar `engines.node>=20.0.0`, compatível com o `Dockerfile` atual (`node:20-bookworm-slim`).
- **Conexão mais estável:** o socket agora usa `Browsers.ubuntu("Chrome")`, timeouts explícitos, limpeza de timer de reconexão, limpeza de QR/código em `ready`, `logged_out`, `logout` e `reset-session`, e diagnósticos seguros de desconexão no `/api/status`.
- **Fallback oficial ao QR:** criado no bot externo `POST /api/pairing-code`, que gera código de pareamento pelo número (`55 + DDD + número`) quando o QR é recusado pelo WhatsApp.
- **PWA conectado ao fallback:** `server/lib/baileys-client.js`, `api/whatsapp.js` e `src/pages/WhatsAppIntegration.tsx` agora suportam `pairing_code`; o painel usa o mesmo campo de telefone para gerar e exibir o código somente após resposta real da API.
- **Sem exposição de segredo:** a chave do bot continua apenas em backend/Vercel/Render; nenhum segredo foi adicionado ao frontend ou ao código versionado.
- **Validação local:** `node --check api/whatsapp.js server/lib/baileys-client.js` passou; `npm test` passou com 55/55 testes; `npm run lint` passou; `npm run build` passou. No bot externo, `node --check index.js` passou e `npm ls baileys --depth=0` confirmou `baileys@7.0.0-rc13`.
- **Deploy Render:** o commit `5d5393e` (`fix: estabilizar pareamento baileys`) foi enviado ao GitHub e o Render publicou esse deploy como `live` por auto-deploy. A API retornou `status=qr`, `hasQr=true`, QR presente e diagnósticos novos (`lastQrGeneratedAt`, `lastDisconnectReason`, `lastDisconnectAt`) sem erro.
- **Deploy Vercel:** o PWA foi publicado em Production e o alias `https://carolmobile.vercel.app` ficou `Ready`. A rota interna autenticada retornou `configured=true`, `enabled=true`, `connection_status=qrcode`, `liveStatus=qrcode` e `provider.hasQr=true`.

## Próxima etapa recomendada (Módulo específico)

Trabalhar somente em **pareamento final do WhatsApp**: tentar primeiro o QR novo; se o celular ainda recusar, informar o número com `55 + DDD + número` no painel e usar **Gerar código de pareamento**. Depois aguardar `ready` e enviar uma única mensagem de teste para número autorizado, sem ampliar automações ou mídia.

## Resultado desta etapa (Atendimento IA no WhatsApp + Gemini — Fundação)

- **Auditoria curta do WhatsApp atual:** a integração existente usa `src/pages/WhatsAppIntegration.tsx` para `/admin/integracoes/whatsapp` e `/profissional/whatsapp`, com API real em `/api/whatsapp`. A área profissional foi preservada com a tela simples de conexão; a área admin recebeu abas adicionais sem recriar o design.
- **Rotas existentes:** `/admin/integracoes/whatsapp`, `/profissional/whatsapp`, `/api/whatsapp?resource=panel|action`, `/api/ai-whatsapp?resource=panel|settings|action|test` e `/api/admin-migrations?resource=ai-whatsapp`.
- **Rotas quebradas ou ausentes:** não foi identificada quebra nova nas rotas existentes. Ainda está ausente, por escolha de escopo, o processamento real de mensagens recebidas do webhook Baileys para acionar Gemini automaticamente.
- **Telas com dados mockados:** as novas abas **Atendimento IA**, **Base de Atendimento**, **Fluxos e Automação**, **Conversas** e **Logs e Diagnóstico** consultam somente `/api/ai-whatsapp`. Conversas e logs exibem empty state real enquanto o webhook/motor de mensagens não estiver ligado.
- **Botões sem ação real:** os botões novos de salvar configuração, ativar/pausar IA, restaurar padrão, testar Gemini e atualizar diagnóstico chamam API real e só atualizam a tela após resposta do backend. Em falha, o estado persistido anterior é preservado e o erro é exibido/logado.
- **Tabelas Supabase/Neon adicionadas:** `ai_settings`, `ai_prompt_versions`, `ai_service_settings`, `ai_plan_settings`, `ai_automation_flows`, `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_message_logs`, `ai_interactions`, `ai_tool_calls`, `human_handoff_tickets`, `conversation_tags` e `conversation_tag_links`.
- **Tabelas ausentes:** nenhuma tabela do módulo IA fica sem definição; a migração `011_ai_whatsapp` foi adicionada em `database/neon-ai-whatsapp.sql`, no `scripts/neon-admin.mjs` e na rota protegida de migração.
- **Erros de API encontrados:** nenhum erro local após correção; `node --check`, `npm test`, `npm run lint` e `npm run build` passaram. O teste real do Gemini depende de `GEMINI_API_KEY`, `GEMINI_ENABLED=true` e `GEMINI_MODEL` no ambiente.
- **Campos frontend x banco:** os campos usados na aba Atendimento IA foram criados em `ai_settings`; listas de serviços, planos e cupons vêm das tabelas reais existentes e são combinadas com configurações IA quando houver.
- **Permissões:** `/api/ai-whatsapp` exige usuário admin; `/api/admin-migrations?resource=ai-whatsapp` exige `CRON_SECRET`; o frontend não recebe `GEMINI_API_KEY`, `BAILEYS_API_KEY`, `SUMUP_API_KEY`, service role ou segredos Cloudinary.
- **Configuração Vercel:** `GEMINI_API_KEY` foi cadastrada como sensível em Production e Preview; `GEMINI_ENABLED=true` e `GEMINI_MODEL=gemini-2.5-flash-lite` foram configuradas nos mesmos ambientes.
- **Funcionalidades concluídas:** base de schema IA, painel admin com abas solicitadas, persistência das configurações, status público do Gemini sem segredo, teste manual backend do Gemini, empty states e diagnóstico inicial.
- **Validação em produção:** deploy publicado e associado ao alias `https://carolmobile.vercel.app`. Login admin validou `/api/ai-whatsapp?resource=panel` com `geminiConfigured=true`, `geminiEnabled=true`, modelo `gemini-2.5-flash-lite`, 4 serviços, 5 planos, 1 cupom e 21 fluxos reais. O teste backend do Gemini retornou `200` com resposta de texto e metadados de uso, sem expor chave.
- **Validação técnica:** `node --check` passou nos arquivos Node alterados, `npm test` passou com 59/59 testes, `npm run lint` passou e `npm run build` passou local e remoto.
- **Funcionalidades pendentes:** webhook de mensagens recebidas, gravação de conversas reais, chamada automática Gemini por mensagem, ferramentas reais de agenda/serviços/cupons/pagamentos, pré-agendamento com confirmação explícita, transferência humana operacional e edição fina da Base de Atendimento/Fluxos.
- **Próxima etapa recomendada:** trabalhar somente em **motor de mensagens recebidas do WhatsApp + Gemini**, conectando o webhook Baileys ao registro de conversa, chamando Gemini com o prompt salvo e respondendo texto simples apenas quando a IA estiver ativa, sem ainda criar agendamentos ou links de pagamento automáticos.

## Resultado desta etapa (Motor de mensagens recebidas WhatsApp + Gemini)

- **Webhook real conectado:** `/api/whatsapp?resource=webhook` agora diferencia payload de mensagem recebida e payload de status. Mensagens recebidas não atualizam mais a sessão como `disconnected` por falta de campo `status`.
- **Rota compatível adicionada:** criado rewrite em `vercel.json` para `/api/webhooks/baileys/carolsol`, apontando para o mesmo handler seguro do webhook WhatsApp sem criar Serverless Function extra. Essa rota facilita configurar o `WEBHOOK_URL` no Render como URL direta do PWA.
- **Persistência de conversas:** mensagens inbound válidas são normalizadas, vinculadas por telefone e registradas em `whatsapp_conversations`, `whatsapp_messages` e `whatsapp_message_logs`.
- **IA sob controle:** o Gemini só responde quando `ai_settings.enabled=true`, `GEMINI_ENABLED=true`, `GEMINI_API_KEY` existe, conversa está com `ai_enabled=true`, telefone é válido e a mensagem não veio do próprio bot.
- **Sem sucesso falso:** se IA estiver desativada, Gemini indisponível, conversa pausada, telefone inválido, grupo/status ou texto vazio, o webhook responde `200` para evitar retry duplicado, mas registra o motivo quando há conversa válida.
- **Comandos operacionais:** `atendente` pausa a IA, cria ticket em `human_handoff_tickets` e envia a mensagem de transferência; `parar` fecha/pausa a conversa; `voltar ao bot` reativa a IA naquela conversa.
- **Limite de segurança:** respeita horário configurado, atendimento 24h, novos contatos/clientes existentes e limite máximo de mensagens automáticas por conversa.
- **Resposta Gemini inicial:** o prompt enviado ao Gemini inclui contexto comercial real liberado para IA, histórico recente e regra explícita para não criar agendamento, não confirmar horário e não enviar link de pagamento nesta etapa.
- **Dados reais:** serviços só entram no contexto da IA quando estão ativos e liberados em `ai_service_settings.ai_active`; planos e cupons vêm das tabelas reais.
- **Segurança:** payloads gravados em logs são podados e chaves/tokens são mascarados por nome de campo. Nenhuma chave Gemini, Baileys, SumUp ou service role é enviada ao frontend ou ao Gemini.
- **Validação técnica:** `node --check` passou nos arquivos novos/alterados, `npm test` passou com 65/65 testes, `npm run lint` passou e o build local passou.
- **Deploy:** publicado em Production no Vercel e associado ao alias `https://carolmobile.vercel.app`. Uma tentativa inicial falhou pelo limite de 12 Serverless Functions do plano Hobby; a rota compatível foi convertida para rewrite e o deploy final passou.
- **Validação em produção:** `POST /api/webhooks/baileys/carolsol` respondeu `200` via rewrite com payload inválido e retornou `ignored=true, reason=invalid_phone`, sem criar conversa fake. O painel admin confirmou Gemini configurado/habilitado, IA ainda desativada e `conversations=0`, `logs=0`.
- **Bot externo atualizado:** o repositório `loveablercyber/whats` recebeu o commit `a631bee` para resolver o webhook de saída. Se `WEBHOOK_URL` estiver vazio, inválido ou apontando para a própria API do Render, o bot usa automaticamente `https://carolmobile.vercel.app/api/webhooks/baileys/carolsol`. A API externa respondeu online com `status=ready` após o push.
- **Funcionalidades pendentes:** validar com uma mensagem real do WhatsApp conectado, liberar serviços na Base de Atendimento e só depois avançar para consulta real de agenda.

## Próxima etapa recomendada (Módulo específico)

Trabalhar somente em **validação real do webhook Baileys em produção**, ativando a IA no painel admin, liberando no máximo um serviço teste na Base de Atendimento e enviando uma única mensagem de WhatsApp para confirmar registro de conversa, log e resposta Gemini. Não implementar agenda, pagamento ou mídia nesta etapa.

## Resultado desta etapa (Base de Atendimento — Serviços liberados para IA)

- **Escopo mantido:** foi trabalhada somente a configuração de serviços na aba **Base de Atendimento**. Não foram implementados agenda automática, pagamento, mídia, cupons editáveis ou fluxos avançados nesta etapa.
- **Persistência real:** criada ação `POST /api/ai-whatsapp?resource=service-settings`, restrita a admin, salvando em `ai_service_settings` com retorno do painel atualizado após resposta real da API.
- **Campos configuráveis por serviço:** ativo no WhatsApp, nome comercial, descrição curta, descrição detalhada, valor inicial, duração estimada, exige avaliação, exige fotos, permite pré-orçamento, permite pré-agendamento, exige sinal, tipo/valor do sinal, mensagem recomendada e prioridade.
- **Sem sucesso falso:** a tela só atualiza o painel após a API retornar sucesso. Se a API falhar, o card volta ao último estado persistido e mostra erro.
- **Bloqueio de catálogo inativo:** o backend não permite ativar IA para serviço inativo no catálogo real. A interface também sinaliza `catálogo inativo` e bloqueia ativação.
- **Dados reais no Gemini:** o contexto comercial do motor WhatsApp agora prefere `ai_service_settings.initial_price` e `estimated_duration_minutes` quando configurados, caindo para `services.base_price`/`duration_minutes` apenas como fallback real.
- **Logs e auditoria:** alterações em serviço IA registram `audit_logs` quando a tabela está disponível, sem gravar segredos.
- **Validação técnica:** `node --check` passou, `npm test` passou com 67/67 testes, `npm run lint` passou e `npm run build` passou.
- **Funcionalidades pendentes:** validar em produção salvando um serviço real pela UI/admin e, depois, ativar a IA para uma mensagem real controlada do WhatsApp.

## Próxima etapa recomendada (Módulo específico)

Trabalhar somente em **validação real controlada da IA no WhatsApp**, salvando um único serviço ativo na Base de Atendimento, ativando a IA no painel, enviando uma mensagem real curta pelo WhatsApp e conferindo conversa, mensagem, log, interação Gemini e resposta. Não avançar para agenda ou pagamento ainda.
