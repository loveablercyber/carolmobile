-- Migração 012: Outbox de mensagens enviadas pelo bot e colunas de sessão
CREATE TABLE IF NOT EXISTS public.whatsapp_outbox_ids (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider_message_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_outbox_ids_sent_at_idx 
  ON public.whatsapp_outbox_ids(sent_at DESC);

ALTER TABLE public.whatsapp_conversations 
  ADD COLUMN IF NOT EXISTS session_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_attempt_id uuid;
