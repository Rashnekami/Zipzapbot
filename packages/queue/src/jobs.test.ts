import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { maintenanceJobSchema, mediaJobSchema, outboundJobSchema } from './jobs.js';

const base = {
  requestId: randomUUID(),
  chatJid: '120@g.us',
  requesterJid: '55a@s.whatsapp.net',
};

describe('contrato dos jobs de mídia', () => {
  it('aceita um pedido de metadados válido', () => {
    const r = mediaJobSchema.safeParse({
      ...base,
      type: 'fetch_metadata',
      url: 'https://www.youtube.com/watch?v=abc',
    });
    expect(r.success).toBe(true);
  });

  it('recusa URL malformada — o job nem chega ao worker', () => {
    const r = mediaJobSchema.safeParse({ ...base, type: 'fetch_metadata', url: 'nao-e-url' });
    expect(r.success).toBe(false);
  });

  it('recusa requestId que não é uuid, quebrando a correlação de log', () => {
    const r = mediaJobSchema.safeParse({
      ...base,
      requestId: 'qualquer-coisa',
      type: 'fetch_metadata',
      url: 'https://youtu.be/abc',
    });
    expect(r.success).toBe(false);
  });

  it('recusa tipo de job desconhecido', () => {
    const r = mediaJobSchema.safeParse({ ...base, type: 'minerar', url: 'https://x.com' });
    expect(r.success).toBe(false);
  });

  it('exige maxBytes positivo no download de vídeo', () => {
    const comum = {
      ...base,
      type: 'download_video',
      url: 'https://youtu.be/a',
      jobRecordId: randomUUID(),
    };
    expect(mediaJobSchema.safeParse({ ...comum, maxBytes: 0 }).success).toBe(false);
    expect(mediaJobSchema.safeParse({ ...comum, maxBytes: 47_185_920 }).success).toBe(true);
  });

  it('não deixa campo extra passar como se fosse conhecido', () => {
    const r = mediaJobSchema.safeParse({
      ...base,
      type: 'make_sticker',
      jobRecordId: randomUUID(),
      inputPath: '/data/tmp/abc/in.jpg',
      animated: false,
      pack: 'Zipzapbot',
      author: 'Zipzapbot',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.keys(r.data)).not.toContain('campoInventado');
    }
  });
});

describe('contrato dos jobs de saída', () => {
  it('exige o tipo de registro, para que bot_messages saiba classificar', () => {
    const semKind = {
      type: 'send_text',
      requestId: randomUUID(),
      chatJid: '120@g.us',
      text: 'oi',
    };
    expect(outboundJobSchema.safeParse(semKind).success).toBe(false);
    expect(outboundJobSchema.safeParse({ ...semKind, kind: 'command_reply' }).success).toBe(
      true,
    );
  });

  it('recusa texto vazio', () => {
    const r = outboundJobSchema.safeParse({
      type: 'send_text',
      requestId: randomUUID(),
      chatJid: '120@g.us',
      text: '',
      kind: 'system',
    });
    expect(r.success).toBe(false);
  });

  it('apaga o arquivo depois de enviar, por padrão — critério de aceite 16', () => {
    const r = outboundJobSchema.safeParse({
      type: 'send_media',
      requestId: randomUUID(),
      chatJid: '120@g.us',
      filePath: '/data/tmp/abc/out.mp3',
      mediaType: 'audio',
      mimetype: 'audio/mpeg',
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.type === 'send_media') {
      expect(r.data.deleteAfterSend).toBe(true);
    }
  });

  it('recusa tipo de mídia que não sabemos enviar', () => {
    const r = outboundJobSchema.safeParse({
      type: 'send_media',
      requestId: randomUUID(),
      chatJid: '120@g.us',
      filePath: '/tmp/a',
      mediaType: 'holograma',
      mimetype: 'application/octet-stream',
    });
    expect(r.success).toBe(false);
  });

  it('limita a quantidade de menções, para não virar disparo em massa', () => {
    const muitas = Array.from({ length: 300 }, (_, i) => `55${i}@s.whatsapp.net`);
    const r = outboundJobSchema.safeParse({
      type: 'send_text',
      requestId: randomUUID(),
      chatJid: '120@g.us',
      text: 'marcando todo mundo',
      kind: 'command_reply',
      mentions: muitas,
    });
    expect(r.success).toBe(false);
  });
});

describe('contrato dos jobs de manutenção', () => {
  it('aceita as rotinas previstas', () => {
    expect(maintenanceJobSchema.safeParse({ type: 'purge_expired_cache' }).success).toBe(true);
    expect(
      maintenanceJobSchema.safeParse({ type: 'purge_old_bot_messages', days: 30 }).success,
    ).toBe(true);
    expect(
      maintenanceJobSchema.safeParse({ type: 'reap_stale_jobs', olderThanMs: 3_600_000 })
        .success,
    ).toBe(true);
    expect(maintenanceJobSchema.safeParse({ type: 'sweep_orphan_temp_files' }).success).toBe(
      true,
    );
  });

  it('recusa retenção negativa, que apagaria tudo', () => {
    expect(
      maintenanceJobSchema.safeParse({ type: 'purge_old_bot_messages', days: -1 }).success,
    ).toBe(false);
  });
});
