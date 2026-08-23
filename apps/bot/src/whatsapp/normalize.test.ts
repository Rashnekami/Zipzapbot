import { describe, expect, it } from 'vitest';
import type { WAMessage } from 'baileys';
import { extractText, mediaKindOf, normalizeMessage, unwrapMessage } from './normalize.js';

const BOT = '5511999998888@s.whatsapp.net';
const BOT_LID = '184736251937465@lid';
const GRUPO = '120363000000000000@g.us';
const ANA = '5511111112222@s.whatsapp.net';

function msg(over: Partial<WAMessage> = {}): WAMessage {
  return {
    key: { remoteJid: GRUPO, fromMe: false, id: 'STANZA1', participant: ANA },
    messageTimestamp: 1_755_000_000,
    pushName: 'Ana',
    message: { conversation: 'oi pessoal' },
    ...over,
  };
}

describe('unwrapMessage', () => {
  it('desembrulha mensagem temporária', () => {
    const dentro = { conversation: 'texto real' };
    expect(unwrapMessage({ ephemeralMessage: { message: dentro } })).toEqual(dentro);
  });

  it('desembrulha visualização única', () => {
    const dentro = { imageMessage: { caption: 'figurinha' } };
    expect(unwrapMessage({ viewOnceMessageV2: { message: dentro } })).toEqual(dentro);
  });

  it('desembrulha envelopes aninhados', () => {
    const dentro = { conversation: 'no fundo' };
    expect(
      unwrapMessage({
        ephemeralMessage: { message: { viewOnceMessage: { message: dentro } } },
      }),
    ).toEqual(dentro);
  });

  it('não entra em laço infinito com envelope que se referencia', () => {
    const circular: Record<string, unknown> = {};
    circular['ephemeralMessage'] = { message: circular };
    expect(() => unwrapMessage(circular)).not.toThrow();
  });
});

describe('extractText', () => {
  it('lê conversa simples', () => {
    expect(extractText({ conversation: 'olá' })).toBe('olá');
  });

  it('lê texto estendido (mensagem com menção ou citação)', () => {
    expect(extractText({ extendedTextMessage: { text: 'oi @bot' } })).toBe('oi @bot');
  });

  it('lê legenda de imagem e de vídeo — é assim que "figurinha" chega', () => {
    expect(extractText({ imageMessage: { caption: 'figurinha' } })).toBe('figurinha');
    expect(extractText({ videoMessage: { caption: 'converter' } })).toBe('converter');
  });

  it('lê a opção escolhida em botão ou lista', () => {
    expect(extractText({ buttonsResponseMessage: { selectedButtonId: '1' } })).toBe('1');
    expect(
      extractText({ listResponseMessage: { singleSelectReply: { selectedRowId: '2' } } }),
    ).toBe('2');
  });

  it('devolve string vazia quando não há texto', () => {
    expect(extractText({ audioMessage: {} })).toBe('');
    expect(extractText(undefined)).toBe('');
  });
});

describe('mediaKindOf', () => {
  it('classifica cada tipo de mídia', () => {
    expect(mediaKindOf({ imageMessage: {} })).toBe('image');
    expect(mediaKindOf({ videoMessage: {} })).toBe('video');
    expect(mediaKindOf({ audioMessage: {} })).toBe('audio');
    expect(mediaKindOf({ stickerMessage: {} })).toBe('sticker');
    expect(mediaKindOf({ documentMessage: {} })).toBe('document');
    expect(mediaKindOf({ conversation: 'texto' })).toBe('none');
  });
});

describe('normalizeMessage', () => {
  it('normaliza uma mensagem de grupo', () => {
    const r = normalizeMessage(msg());

    expect(r).toBeDefined();
    expect(r?.chatJid).toBe(GRUPO);
    expect(r?.senderJid).toBe(ANA);
    expect(r?.isGroup).toBe(true);
    expect(r?.text).toBe('oi pessoal');
    expect(r?.pushName).toBe('Ana');
    expect(r?.timestamp).toBe(1_755_000_000_000);
  });

  it('usa o próprio chat como remetente em conversa direta', () => {
    const r = normalizeMessage(
      msg({ key: { remoteJid: ANA, fromMe: false, id: 'X', participant: null } }),
    );
    expect(r?.isGroup).toBe(false);
    expect(r?.senderJid).toBe(ANA);
  });

  it('remove o sufixo de dispositivo do remetente', () => {
    const r = normalizeMessage(
      msg({
        key: {
          remoteJid: GRUPO,
          fromMe: false,
          id: 'X',
          participant: `${ANA.split('@')[0]}:37@s.whatsapp.net`,
        },
      }),
    );
    expect(r?.senderJid).toBe(ANA);
  });

  it('captura o LID do remetente quando o WhatsApp informa', () => {
    const r = normalizeMessage(
      msg({
        key: {
          remoteJid: GRUPO,
          fromMe: false,
          id: 'X',
          participant: ANA,
          senderLid: '999888777@lid',
        },
      }),
    );
    expect(r?.senderLid).toBe('999888777@lid');
  });

  it('ignora status e canal — não são conversa', () => {
    expect(
      normalizeMessage(msg({ key: { remoteJid: 'status@broadcast', fromMe: false, id: 'X' } })),
    ).toBeUndefined();
    expect(
      normalizeMessage(msg({ key: { remoteJid: '1203@newsletter', fromMe: false, id: 'X' } })),
    ).toBeUndefined();
  });

  it('ignora evento de protocolo (apagar, editar, sincronizar)', () => {
    expect(normalizeMessage(msg({ message: { protocolMessage: {} } }))).toBeUndefined();
  });

  it('ignora mensagem sem conteúdo e sem id', () => {
    expect(normalizeMessage(msg({ message: null }))).toBeUndefined();
    expect(
      normalizeMessage(msg({ key: { remoteJid: GRUPO, fromMe: false, id: '' } })),
    ).toBeUndefined();
  });

  it('atravessa mensagem temporária — comando em grupo efêmero precisa funcionar', () => {
    const r = normalizeMessage(
      msg({ message: { ephemeralMessage: { message: { conversation: '!ping' } } } }),
    );
    expect(r?.text).toBe('!ping');
  });

  describe('menções — critério de aceite 2', () => {
    it('registra menção real ao bot', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: {
              text: '@zipzapbot resume aí',
              contextInfo: { mentionedJid: [BOT] },
            },
          },
        }),
      );
      expect(r?.mentionedJids).toEqual([BOT]);
    });

    it('não inventa menção a partir do texto — o nome escrito não conta', () => {
      const r = normalizeMessage(
        msg({ message: { conversation: 'o zipzapbot travou de novo' } }),
      );
      expect(r?.mentionedJids).toEqual([]);
    });

    it('normaliza o JID mencionado, para casar com a identidade do bot', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: {
              text: 'oi',
              contextInfo: { mentionedJid: ['5511999998888:12@s.whatsapp.net'] },
            },
          },
        }),
      );
      expect(r?.mentionedJids).toEqual([BOT]);
    });

    it('preserva menção por LID', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: { text: 'oi', contextInfo: { mentionedJid: [BOT_LID] } },
          },
        }),
      );
      expect(r?.mentionedJids).toEqual([BOT_LID]);
    });

    it('descarta JID inválido na lista de menções', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: {
              text: 'oi',
              contextInfo: { mentionedJid: ['lixo', BOT, ''] },
            },
          },
        }),
      );
      expect(r?.mentionedJids).toEqual([BOT]);
    });
  });

  describe('citação — critério de aceite 3', () => {
    it('extrai stanzaId e texto da mensagem citada', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: {
              text: 'e aí?',
              contextInfo: {
                stanzaId: 'DO-BOT-123',
                participant: BOT,
                quotedMessage: { conversation: 'resposta anterior do bot' },
              },
            },
          },
        }),
      );

      expect(r?.quoted?.stanzaId).toBe('DO-BOT-123');
      expect(r?.quoted?.text).toBe('resposta anterior do bot');
      expect(r?.quoted?.claimedParticipant).toBe(BOT);
    });

    it('classifica a mídia citada — base do "responder com figurinha"', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: {
              text: 'figurinha',
              contextInfo: {
                stanzaId: 'FOTO-1',
                participant: ANA,
                quotedMessage: { imageMessage: { caption: '' } },
              },
            },
          },
        }),
      );
      expect(r?.quoted?.mediaKind).toBe('image');
    });

    it('não cria citação quando falta o conteúdo citado', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: { text: 'oi', contextInfo: { stanzaId: 'SO-O-ID' } },
          },
        }),
      );
      expect(r?.quoted).toBeUndefined();
    });

    it('atravessa envelope na mensagem citada', () => {
      const r = normalizeMessage(
        msg({
          message: {
            extendedTextMessage: {
              text: 'oi',
              contextInfo: {
                stanzaId: 'EFEMERA',
                participant: BOT,
                quotedMessage: {
                  ephemeralMessage: { message: { conversation: 'texto real' } },
                },
              },
            },
          },
        }),
      );
      expect(r?.quoted?.text).toBe('texto real');
    });
  });
});
