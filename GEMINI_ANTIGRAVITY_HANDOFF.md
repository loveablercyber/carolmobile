# Handoff para Gemini Antigravity

Este projeto e o backend do Carol Sol Mobile foram migrados para servidor proprio usando Coolify. O site principal em producao agora roda em:

https://agenda.carolsol.com.br

O painel do Coolify fica em:

https://painel.nextia.dev.br

## Contexto Atual

- O projeto saiu do fluxo antigo de Vercel/servicos separados e agora roda em container no Coolify.
- O deploy ativo usa o repositorio GitHub `loveablercyber/carolmobile`, branch `main`.
- O Coolify faz build/deploy automatico quando ha push na branch principal.
- O banco principal esta no PostgreSQL gerenciado pelo Coolify.
- Uploads foram migrados para MinIO.
- O WhatsApp usa Evolution API.
- O bot do WhatsApp ainda nao esta 100% funcional e continua em fase de correcao.

## Como Trabalhar no Projeto

1. Editar os arquivos do projeto localmente.
2. Rodar validacoes antes de publicar:

```bash
npm run lint
npm test
npm run build
```

3. Fazer commit e push para `main`.
4. Entrar no painel do Coolify para acompanhar o deploy.
5. Se for necessario alterar variaveis de ambiente, dominios, containers, logs ou reiniciar servicos, fazer login no painel do Coolify.

## Painel Coolify

Para edicoes de ambiente e atualizacoes operacionais, acessar:

https://painel.nextia.dev.br

No Coolify, verificar principalmente:

- Projeto: Carol Mobile
- Aplicacao: carolmobile
- Ambiente: production
- Dominio: `https://agenda.carolsol.com.br`
- Deployments
- Logs
- Environment Variables
- Scheduled Tasks
- Healthcheck

Nao colocar segredos em arquivos versionados. Chaves de API, tokens, senhas, `CRON_SECRET`, credenciais da Evolution, Resend, SumUp, MinIO e banco devem ficar apenas nas variaveis do Coolify.

## WhatsApp e Evolution API

Ainda estamos corrigindo o bot do WhatsApp.

Situacao atual:

- Provedor: Evolution API
- Instancia: `carolsol`
- O sistema tenta manter a conexao online via keepalive.
- O webhook da Evolution deve apontar para o dominio atual do app.
- O bot ja responde saudacoes simples localmente, sem usar IA, quando o webhook chega corretamente e a conversa nao esta pausada.
- Ainda ha relatos de comportamento inconsistente: responde uma mensagem padrao e depois para de responder.

Eventos esperados no webhook da Evolution:

```text
APPLICATION_STARTUP
MESSAGES_UPSERT
MESSAGES_UPDATE
CONNECTION_UPDATE
QRCODE_UPDATED
```

Endpoint interno de keepalive:

```text
GET https://agenda.carolsol.com.br/api/whatsapp?resource=keepalive&force=1&secret=CRON_SECRET
```

Nao expor o valor real de `CRON_SECRET` em commits, logs publicos ou documentacao.

## Pontos Importantes Sobre o Bot

- Se uma conversa estiver pausada em modo humano, o bot pode nao responder.
- A palavra de retomada padrao e `voltar ao bot`.
- Mensagens simples como `oi`, `bom dia`, `boa tarde` e `boa noite` devem ser respondidas sem chamar IA.
- `MESSAGES_UPSERT` e essencial para o bot receber mensagens novas.
- `APPLICATION_STARTUP` deve ficar habilitado para avisos de reinicio da Evolution.
- O webhook precisa permanecer configurado para o dominio `agenda.carolsol.com.br`, nao para dominios antigos da Vercel ou URL temporaria do Coolify.

## Validacoes Uteis

Healthcheck publico:

```bash
curl https://agenda.carolsol.com.br/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "database": true
}
```

Testes locais relevantes para WhatsApp/Evolution:

```bash
npm test -- --test-name-pattern="Evolution webhook|Baileys|greeting"
```

## Estado Resumido

O site esta online no dominio final e o deploy via Coolify esta funcionando. O WhatsApp/Evolution esta conectado, mas o bot ainda precisa de investigacao ate ficar 100% confiavel em conversas reais. A prioridade atual e estabilizar recebimento de mensagens, estado das conversas e resposta continua do bot apos a primeira mensagem.
