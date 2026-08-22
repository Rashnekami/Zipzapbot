import { z } from 'zod';

/**
 * Schema do ambiente.
 *
 * O processo não sobe com variável faltando, malformada ou fora de faixa: a
 * validação roda no boot e derruba na hora, com a lista completa do que está
 * errado. Descobrir que `MAX_FILE_BYTES` era `"45MB"` no meio de um download,
 * três horas depois, é o cenário que isto existe para evitar.
 */

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const port = z.coerce.number().int().min(1).max(65_535);

/** Chave de 32 bytes em hexadecimal ou base64, para AES-256-GCM. */
const key256 = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const bytes = /^[0-9a-fA-F]{64}$/.test(value) ? 32 : Buffer.from(value, 'base64').length;
    if (bytes !== 32) {
      ctx.addIssue({
        code: 'custom',
        message:
          'precisa ser uma chave de 32 bytes (64 caracteres hexadecimais ou base64). ' +
          'Gere com: openssl rand -hex 32',
      });
    }
  });

export const envSchema = z.object({
  // --- geral ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  TZ: z.string().default('America/Sao_Paulo'),

  // --- identidade do bot ---
  BOT_NAME: z.string().min(1).default('Zipzapbot'),
  COMMAND_PREFIX: z.string().min(1).max(3).default('!'),
  /** JIDs do dono do bot, separados por vírgula. Comandos de dono só aceitam estes. */
  OWNER_JIDS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // --- persistência ---
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // --- credenciais e cifra ---
  /** Cifra a sessão do Baileys e os campos sensíveis do banco. */
  ENCRYPTION_KEY: key256,
  SESSION_DIR: z.string().default('./data/session'),

  // --- gateway de IA (nosso) ---
  AI_GATEWAY_URL: z.string().url().optional(),
  AI_GATEWAY_TOKEN: z.string().min(16).optional(),
  AI_GATEWAY_APP_NAME: z.string().default('whatsapp-bot'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  AI_MAX_PROVIDERS: z.coerce.number().int().min(1).max(3).default(3),

  // --- limites de mídia (§13 do briefing) ---
  MAX_VIDEO_SECONDS: z.coerce.number().int().min(1).max(7_200).default(1_200),
  MAX_FILE_BYTES: z.coerce.number().int().min(1).default(47_185_920),
  MAX_CONCURRENT_DOWNLOADS: z.coerce.number().int().min(1).max(16).default(2),
  MAX_JOBS_PER_USER: z.coerce.number().int().min(1).max(10).default(1),
  MEDIA_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),
  DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(300_000),
  MAX_PLAYLIST_ITEMS: z.coerce.number().int().min(1).max(50).default(1),

  // --- cotas diárias ---
  GROUP_DAILY_MEDIA_LIMIT: z.coerce.number().int().min(0).default(100),
  GROUP_DAILY_AI_LIMIT: z.coerce.number().int().min(0).default(200),
  USER_DAILY_AI_LIMIT: z.coerce.number().int().min(0).default(30),

  // --- binários externos: caminho absoluto, nunca resolvido pelo PATH ---
  FFMPEG_PATH: z.string().default('/usr/bin/ffmpeg'),
  FFPROBE_PATH: z.string().default('/usr/bin/ffprobe'),
  YTDLP_PATH: z.string().default('/usr/local/bin/yt-dlp'),
  TMP_DIR: z.string().default('./data/tmp'),
  MEDIA_DIR: z.string().default('./data/media'),

  // --- figurinha ---
  STICKER_PACK: z.string().default('Zipzapbot'),
  STICKER_AUTHOR: z.string().default('Zipzapbot'),

  // --- api ---
  API_PORT: port.default(3000),
  API_TOKEN: z.string().min(16).optional(),

  // --- letras ---
  LRCLIB_BASE_URL: z.string().url().default('https://lrclib.net'),
  LYRICS_CACHE_TTL_SECONDS: z.coerce.number().int().min(60).default(604_800),

  // --- retenção ---
  BOT_MESSAGES_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  CONVERSATION_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  AI_USAGE_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(365),

  METRICS_ENABLED: bool.default(false),
});

export type Env = z.infer<typeof envSchema>;
