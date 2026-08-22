import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Tipos das tabelas, espelhando `migrations/*.sql`.
 *
 * Escritos à mão de propósito: são a única definição que o TypeScript enxerga, e
 * mantê-los ao lado das migrations obriga quem mexe no schema a declarar o que
 * mudou. Há teste de integração que compara estes tipos com o schema real do
 * banco, então divergência quebra o CI em vez de aparecer em produção.
 */

/**
 * Coluna de tempo com DEFAULT no banco: sai como Date, é opcional na inserção.
 *
 * Não envolva em `Generated<>`: `Generated<T>` já é um `ColumnType`, e aninhar
 * um dentro do outro produz um tipo que o Kysely não consegue usar em `where`.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

/** Igual à anterior, mas para coluna que aceita nulo. */
type NullableTimestamp = ColumnType<
  Date | null,
  Date | string | null | undefined,
  Date | string | null
>;

/** Coluna jsonb: sai desserializada, entra como string JSON. */
type Json<T> = ColumnType<T, string | undefined, string>;

export interface GroupsTable {
  id: string;
  jid: string;
  subject: string | null;
  is_active: Generated<boolean>;
  joined_at: Timestamp;
  updated_at: Timestamp;
}

export interface UsersTable {
  id: string;
  jid: string;
  lid: string | null;
  push_name: string | null;
  first_seen_at: Timestamp;
  last_seen_at: Timestamp;
}

export type MemberRole = 'member' | 'admin' | 'superadmin';

export interface GroupMembersTable {
  group_id: string;
  user_id: string;
  role: Generated<MemberRole>;
  joined_at: Timestamp;
  left_at: NullableTimestamp;
}

export interface GroupSettingsTable {
  group_id: string;
  prefix: Generated<string>;
  ai_enabled: Generated<boolean>;
  memory_enabled: Generated<boolean>;
  learning_enabled: Generated<boolean>;
  ai_daily_limit: Generated<number>;
  ai_user_daily_limit: Generated<number>;
  media_daily_limit: Generated<number>;
  max_video_seconds: Generated<number>;
  max_file_bytes: Generated<string>;
  features: Json<Record<string, unknown>>;
  updated_at: Timestamp;
}

export type BotMessageKind = 'ai_reply' | 'command_reply' | 'media' | 'system';

export interface BotMessagesTable {
  id: string;
  group_id: string | null;
  chat_jid: string;
  stanza_id: string;
  kind: BotMessageKind;
  reply_to_user: string | null;
  preview: string | null;
  sent_at: Timestamp;
}

export type MediaJobKind =
  'yt_mp3' | 'yt_mp4' | 'to_audio' | 'sticker' | 'togif' | 'toimg' | 'attp' | 'transcode';

export type MediaJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface MediaJobsTable {
  id: string;
  group_id: string | null;
  user_id: string | null;
  kind: MediaJobKind;
  source_host: string | null;
  status: Generated<MediaJobStatus>;
  bytes: string | null;
  duration_s: number | null;
  error_code: string | null;
  created_at: Timestamp;
  finished_at: NullableTimestamp;
}

export interface MediaCacheTable {
  cache_key: string;
  file_path: string;
  mime: string;
  bytes: string;
  meta: Json<Record<string, unknown>>;
  created_at: Timestamp;
  expires_at: ColumnType<Date, Date | string, Date | string>;
}

export interface LyricsCacheTable {
  cache_key: string;
  provider: string;
  payload: Json<Record<string, unknown>>;
  created_at: Timestamp;
  expires_at: ColumnType<Date, Date | string, Date | string>;
}

export interface AuditLogTable {
  id: string;
  actor_jid: string;
  group_id: string | null;
  action: string;
  target: string | null;
  payload: Json<Record<string, unknown>>;
  created_at: Timestamp;
}

export interface SchemaMigrationsTable {
  version: string;
  checksum: string;
  applied_at: Timestamp;
}

export interface Database {
  groups: GroupsTable;
  users: UsersTable;
  group_members: GroupMembersTable;
  group_settings: GroupSettingsTable;
  bot_messages: BotMessagesTable;
  media_jobs: MediaJobsTable;
  media_cache: MediaCacheTable;
  lyrics_cache: LyricsCacheTable;
  audit_log: AuditLogTable;
  schema_migrations: SchemaMigrationsTable;
}

export type Group = Selectable<GroupsTable>;
export type NewGroup = Insertable<GroupsTable>;
export type GroupUpdate = Updateable<GroupsTable>;

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;

export type GroupSettings = Selectable<GroupSettingsTable>;
export type BotMessage = Selectable<BotMessagesTable>;
export type NewBotMessage = Insertable<BotMessagesTable>;
export type MediaJob = Selectable<MediaJobsTable>;
export type AuditEntry = Selectable<AuditLogTable>;
