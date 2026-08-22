-- =============================================================================
-- 0001_init — grupos, participantes, configuração, mensagens do bot, mídia e
-- auditoria.
--
-- Escopo deliberado: apenas o que a Etapa 1 usa. As tabelas de memória, IA e
-- personalidade entram na migration da Etapa 2, e as de jogos e economia na
-- Etapa 4. Criar tabela antes de existir código que a use só produz schema
-- morto que ninguém sabe se pode remover.
-- =============================================================================

-- Mantém updated_at correto mesmo em UPDATE que esqueça a coluna. Regra de
-- integridade pertence ao banco, não à disciplina de quem escreve a query.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- Identidade
-- -----------------------------------------------------------------------------
CREATE TABLE groups (
  id         uuid PRIMARY KEY,
  jid        text NOT NULL UNIQUE,
  subject    text,
  is_active  boolean NOT NULL DEFAULT true,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER groups_updated_at BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- lid: o WhatsApp vem migrando a identificação de participante de número para
-- LID. Guardamos as duas formas porque um mesmo grupo pode entregar qualquer
-- uma delas, e comparar só uma faz menção e permissão falharem em silêncio.
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  jid           text NOT NULL UNIQUE,
  lid           text UNIQUE,
  push_name     text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_lid_idx ON users (lid) WHERE lid IS NOT NULL;

CREATE TABLE group_members (
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member'
    CHECK (role IN ('member','admin','superadmin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members (user_id);

-- -----------------------------------------------------------------------------
-- Configuração por grupo
-- -----------------------------------------------------------------------------
-- persona_id entra na Etapa 2, junto da tabela personas que ela referencia.
CREATE TABLE group_settings (
  group_id            uuid PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  prefix              text    NOT NULL DEFAULT '!',
  ai_enabled          boolean NOT NULL DEFAULT true,
  memory_enabled      boolean NOT NULL DEFAULT true,
  learning_enabled    boolean NOT NULL DEFAULT true,
  ai_daily_limit      integer NOT NULL DEFAULT 200  CHECK (ai_daily_limit >= 0),
  ai_user_daily_limit integer NOT NULL DEFAULT 30   CHECK (ai_user_daily_limit >= 0),
  media_daily_limit   integer NOT NULL DEFAULT 100  CHECK (media_daily_limit >= 0),
  max_video_seconds   integer NOT NULL DEFAULT 1200 CHECK (max_video_seconds > 0),
  max_file_bytes      bigint  NOT NULL DEFAULT 47185920 CHECK (max_file_bytes > 0),
  features            jsonb   NOT NULL DEFAULT '{}',
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER group_settings_updated_at BEFORE UPDATE ON group_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Mensagens que NÓS enviamos
--
-- É esta tabela que decide se uma mensagem recebida está respondendo ao bot.
-- A alternativa — confiar em contextInfo.participant da mensagem recebida —
-- seria confiar em campo preenchido pelo remetente, e existe advisory pública
-- de spoofing de mensagem no Baileys. Aqui a autoridade é nosso próprio
-- registro de envio.
-- -----------------------------------------------------------------------------
CREATE TABLE bot_messages (
  id            uuid PRIMARY KEY,
  group_id      uuid REFERENCES groups(id) ON DELETE CASCADE,
  chat_jid      text NOT NULL,
  stanza_id     text NOT NULL,
  kind          text NOT NULL
    CHECK (kind IN ('ai_reply','command_reply','media','system')),
  reply_to_user text,
  preview       text,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_jid, stanza_id)
);
CREATE INDEX bot_messages_sent_at_idx ON bot_messages (sent_at);

-- -----------------------------------------------------------------------------
-- Mídia
-- -----------------------------------------------------------------------------
-- source_host guarda só o domínio. A URL completa costuma carregar identificador
-- de conteúdo e parâmetro de sessão, e não precisamos disso para operar.
CREATE TABLE media_jobs (
  id          uuid PRIMARY KEY,
  group_id    uuid REFERENCES groups(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  kind        text NOT NULL
    CHECK (kind IN ('yt_mp3','yt_mp4','to_audio','sticker','togif','toimg','attp','transcode')),
  source_host text,
  status      text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','cancelled')),
  bytes       bigint,
  duration_s  integer,
  error_code  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX media_jobs_group_idx  ON media_jobs (group_id, created_at DESC);
CREATE INDEX media_jobs_active_idx ON media_jobs (user_id) WHERE status IN ('queued','running');

CREATE TABLE media_cache (
  cache_key  text PRIMARY KEY,
  file_path  text NOT NULL,
  mime       text NOT NULL,
  bytes      bigint NOT NULL,
  meta       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX media_cache_expiry_idx ON media_cache (expires_at);

CREATE TABLE lyrics_cache (
  cache_key  text PRIMARY KEY,
  provider   text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX lyrics_cache_expiry_idx ON lyrics_cache (expires_at);

-- -----------------------------------------------------------------------------
-- Auditoria
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         uuid PRIMARY KEY,
  actor_jid  text NOT NULL,
  group_id   uuid REFERENCES groups(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target     text,
  payload    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_group_idx ON audit_log (group_id, created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_jid, created_at DESC);
