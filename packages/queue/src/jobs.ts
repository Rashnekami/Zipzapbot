import { z } from 'zod';

/**
 * Contratos dos jobs.
 *
 * O payload é validado na entrada e na saída da fila, não só na produção. Job
 * fica parado no Redis enquanto o deploy troca: sem validação na leitura, um
 * worker novo consome um payload no formato antigo e falha em algum ponto
 * distante, com erro que não diz nada. Aqui ele falha na borda, dizendo qual
 * campo mudou.
 */

const jidSchema = z.string().min(3).max(128);

/** Base comum: quem pediu, em que grupo, e o id que amarra tudo no log. */
const baseJob = z.object({
  requestId: z.uuid(),
  chatJid: jidSchema,
  requesterJid: jidSchema,
  groupId: z.uuid().optional(),
  userId: z.uuid().optional(),
  /** stanza da mensagem que originou o pedido, para responder citando. */
  originStanzaId: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// fila: media
// ---------------------------------------------------------------------------

export const fetchMetadataJob = baseJob.extend({
  type: z.literal('fetch_metadata'),
  url: z.url(),
});

export const downloadAudioJob = baseJob.extend({
  type: z.literal('download_audio'),
  url: z.url(),
  jobRecordId: z.uuid(),
});

export const downloadVideoJob = baseJob.extend({
  type: z.literal('download_video'),
  url: z.url(),
  jobRecordId: z.uuid(),
  maxBytes: z.number().int().positive(),
});

export const convertToAudioJob = baseJob.extend({
  type: z.literal('convert_to_audio'),
  jobRecordId: z.uuid(),
  /** Mídia já baixada no volume compartilhado. */
  inputPath: z.string().min(1),
});

export const makeStickerJob = baseJob.extend({
  type: z.literal('make_sticker'),
  jobRecordId: z.uuid(),
  inputPath: z.string().min(1),
  animated: z.boolean(),
  pack: z.string().max(120),
  author: z.string().max(120),
});

export const mediaJobSchema = z.discriminatedUnion('type', [
  fetchMetadataJob,
  downloadAudioJob,
  downloadVideoJob,
  convertToAudioJob,
  makeStickerJob,
]);

export type MediaJobPayload = z.infer<typeof mediaJobSchema>;

// ---------------------------------------------------------------------------
// fila: outbound — consumida SÓ pelo processo do bot
// ---------------------------------------------------------------------------

export const sendTextJob = z.object({
  type: z.literal('send_text'),
  requestId: z.uuid(),
  chatJid: jidSchema,
  text: z.string().min(1).max(60_000),
  quoteStanzaId: z.string().min(1).optional(),
  mentions: z.array(jidSchema).max(256).optional(),
  kind: z.enum(['ai_reply', 'command_reply', 'media', 'system']),
});

export const sendMediaJob = z.object({
  type: z.literal('send_media'),
  requestId: z.uuid(),
  chatJid: jidSchema,
  filePath: z.string().min(1),
  mediaType: z.enum(['audio', 'video', 'image', 'sticker', 'document']),
  mimetype: z.string().min(3).max(120),
  fileName: z.string().max(200).optional(),
  caption: z.string().max(4_000).optional(),
  quoteStanzaId: z.string().min(1).optional(),
  /** Metadados de faixa, quando enviamos como música. */
  track: z
    .object({
      title: z.string().max(300).optional(),
      artist: z.string().max(300).optional(),
      durationSeconds: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** Apagar o arquivo depois de enviar. Padrão do projeto: sempre. */
  deleteAfterSend: z.boolean().default(true),
});

export const outboundJobSchema = z.discriminatedUnion('type', [sendTextJob, sendMediaJob]);
export type OutboundJobPayload = z.infer<typeof outboundJobSchema>;

// ---------------------------------------------------------------------------
// fila: maintenance
// ---------------------------------------------------------------------------

export const maintenanceJobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('purge_expired_cache') }),
  z.object({ type: z.literal('purge_old_bot_messages'), days: z.number().int().positive() }),
  z.object({ type: z.literal('reap_stale_jobs'), olderThanMs: z.number().int().positive() }),
  z.object({ type: z.literal('sweep_orphan_temp_files') }),
]);

export type MaintenanceJobPayload = z.infer<typeof maintenanceJobSchema>;

export const jobSchemas = {
  media: mediaJobSchema,
  outbound: outboundJobSchema,
  maintenance: maintenanceJobSchema,
} as const;
