import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { SendResult, WhatsAppGateway } from '@zipzap/core';
import type { BotMessageRepository, GroupRepository } from '@zipzap/db';
import { createLogger } from '@zipzap/logger';
import { MessageSender } from './sender.js';

const GRUPO = '120363000000000000@g.us';
const DIRETO = '5511111112222@s.whatsapp.net';

function logSilencioso() {
  const linhas: string[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) {
      linhas.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger({ destination: stream, level: 'error' }), linhas };
}

function montar(over: { sendFalha?: boolean; registroFalha?: boolean } = {}) {
  const enviadas: unknown[] = [];
  const registradas: unknown[] = [];

  const gateway = {
    sendText: vi.fn((input: unknown): Promise<SendResult> => {
      if (over.sendFalha === true) return Promise.reject(new Error('socket caiu'));
      enviadas.push(input);
      return Promise.resolve({
        stanzaId: `STANZA-${enviadas.length}`,
        chatJid: (input as { chatJid: string }).chatJid,
        timestamp: 1,
      });
    }),
    sendMedia: vi.fn((input: unknown): Promise<SendResult> => {
      enviadas.push(input);
      return Promise.resolve({
        stanzaId: `MEDIA-${enviadas.length}`,
        chatJid: (input as { chatJid: string }).chatJid,
        timestamp: 1,
      });
    }),
  } as unknown as WhatsAppGateway;

  const botMessages = {
    record: vi.fn((input: unknown) => {
      if (over.registroFalha === true) return Promise.reject(new Error('banco fora do ar'));
      registradas.push(input);
      return Promise.resolve({});
    }),
  } as unknown as BotMessageRepository;

  const findByJid = vi.fn((jid: string) =>
    Promise.resolve(jid === GRUPO ? { id: 'grupo-uuid', jid } : undefined),
  );
  const groups = { findByJid } as unknown as GroupRepository;

  const { logger, linhas } = logSilencioso();
  return {
    sender: new MessageSender(gateway, botMessages, groups, logger),
    gateway,
    botMessages,
    groups,
    findByJid,
    enviadas,
    registradas,
    linhas,
  };
}

describe('MessageSender — sustenta o critério de aceite 3', () => {
  it('registra em bot_messages tudo que envia', async () => {
    const { sender, registradas } = montar();

    await sender.sendText({ chatJid: GRUPO, text: 'menu de download', kind: 'command_reply' });

    expect(registradas).toHaveLength(1);
    expect(registradas[0]).toMatchObject({
      chatJid: GRUPO,
      stanzaId: 'STANZA-1',
      kind: 'command_reply',
      preview: 'menu de download',
      groupId: 'grupo-uuid',
    });
  });

  it('resolve o grupo para vincular o registro', async () => {
    const { sender, findByJid } = montar();
    await sender.sendText({ chatJid: GRUPO, text: 'oi', kind: 'system' });
    expect(findByJid).toHaveBeenCalledWith(GRUPO);
  });

  it('nao procura grupo em conversa direta', async () => {
    const { sender, findByJid, registradas } = montar();

    await sender.sendText({ chatJid: DIRETO, text: 'oi', kind: 'system' });

    expect(findByJid).not.toHaveBeenCalled();
    expect(registradas[0]).toMatchObject({ chatJid: DIRETO, groupId: undefined });
  });

  it('registra midia usando a legenda como contexto', async () => {
    const { sender, registradas } = montar();

    await sender.sendMedia({
      chatJid: GRUPO,
      filePath: '/data/tmp/a/out.mp3',
      mediaType: 'audio',
      mimetype: 'audio/mpeg',
      caption: 'Musica - Artista',
    });

    expect(registradas[0]).toMatchObject({ kind: 'media', preview: 'Musica - Artista' });
  });

  it('usa um marcador legivel quando a midia nao tem legenda', async () => {
    const { sender, registradas } = montar();

    await sender.sendMedia({
      chatJid: GRUPO,
      filePath: '/data/tmp/a/fig.webp',
      mediaType: 'sticker',
      mimetype: 'image/webp',
    });

    expect(registradas[0]).toMatchObject({ preview: '[sticker]' });
  });

  it('devolve o stanzaId de quem chamou, para poder citar depois', async () => {
    const { sender } = montar();
    const r = await sender.sendText({ chatJid: GRUPO, text: 'oi', kind: 'ai_reply' });
    expect(r.stanzaId).toBe('STANZA-1');
  });

  it('propaga falha de envio: o chamador precisa saber que nao entregou', async () => {
    const { sender, registradas } = montar({ sendFalha: true });

    await expect(
      sender.sendText({ chatJid: GRUPO, text: 'oi', kind: 'system' }),
    ).rejects.toThrow('socket caiu');

    // Nada registrado, porque nada foi enviado.
    expect(registradas).toHaveLength(0);
  });

  it('nao falha o envio quando o registro falha, mas grita no log', async () => {
    const { sender, linhas } = montar({ registroFalha: true });

    // A mensagem ja chegou ao usuario; lancar aqui faria um retry reenviar.
    const r = await sender.sendText({ chatJid: GRUPO, text: 'oi', kind: 'system' });
    expect(r.stanzaId).toBe('STANZA-1');

    const log = linhas.join('');
    expect(log).toContain('nao registrada em bot_messages');
    expect(log).toContain('"level":"error"');
  });
});
