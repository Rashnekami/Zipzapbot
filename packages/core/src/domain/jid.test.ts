import { describe, expect, it } from 'vitest';
import {
  isAddressableChat,
  isBroadcastJid,
  isGroupJid,
  isLidJid,
  isNewsletterJid,
  isUserJid,
  jidUser,
  normalizeJid,
  parseJid,
  sameUser,
} from './jid.js';

describe('parseJid', () => {
  it('separa usuário e servidor', () => {
    expect(parseJid('5511999998888@s.whatsapp.net')).toEqual({
      user: '5511999998888',
      server: 's.whatsapp.net',
    });
  });

  it('extrai o sufixo de dispositivo', () => {
    expect(parseJid('5511999998888:12@s.whatsapp.net')).toEqual({
      user: '5511999998888',
      device: 12,
      server: 's.whatsapp.net',
    });
  });

  it('devolve undefined para entrada que não é JID, sem lançar', () => {
    for (const ruim of [null, undefined, '', 'sem-arroba', '@sozinho', 'usuario@', ':12@x']) {
      expect(parseJid(ruim)).toBeUndefined();
    }
  });

  it('trata servidor em maiúsculas', () => {
    expect(parseJid('123@S.WhatsApp.Net')?.server).toBe('s.whatsapp.net');
  });
});

describe('normalizeJid', () => {
  it('remove o sufixo de dispositivo', () => {
    expect(normalizeJid('5511999998888:12@s.whatsapp.net')).toBe(
      '5511999998888@s.whatsapp.net',
    );
  });

  it('é idempotente', () => {
    const jid = '5511999998888@s.whatsapp.net';
    expect(normalizeJid(normalizeJid(jid))).toBe(jid);
  });

  it('normaliza LID igualmente', () => {
    expect(normalizeJid('184736251937465:5@lid')).toBe('184736251937465@lid');
  });

  it('ignora espaço em volta', () => {
    expect(normalizeJid('  123@g.us  ')).toBe('123@g.us');
  });
});

describe('classificação de JID', () => {
  it('reconhece cada tipo', () => {
    expect(isGroupJid('120363000000000000@g.us')).toBe(true);
    expect(isUserJid('5511999998888@s.whatsapp.net')).toBe(true);
    expect(isLidJid('184736251937465@lid')).toBe(true);
    expect(isBroadcastJid('status@broadcast')).toBe(true);
    expect(isNewsletterJid('120363000@newsletter')).toBe(true);
  });

  it('não confunde grupo com participante', () => {
    expect(isUserJid('120363000000000000@g.us')).toBe(false);
    expect(isGroupJid('5511999998888@s.whatsapp.net')).toBe(false);
  });

  it('exclui status e canal dos chats endereçáveis', () => {
    expect(isAddressableChat('120363000000000000@g.us')).toBe(true);
    expect(isAddressableChat('5511999998888@s.whatsapp.net')).toBe(true);
    expect(isAddressableChat('184736251937465@lid')).toBe(true);
    expect(isAddressableChat('status@broadcast')).toBe(false);
    expect(isAddressableChat('120363000@newsletter')).toBe(false);
    expect(isAddressableChat('lixo')).toBe(false);
  });
});

describe('sameUser', () => {
  it('ignora o dispositivo — o mesmo participante em aparelhos diferentes', () => {
    expect(sameUser('5511999998888:1@s.whatsapp.net', '5511999998888:47@s.whatsapp.net')).toBe(
      true,
    );
  });

  it('não cruza telefone com LID: são identificadores distintos', () => {
    expect(sameUser('5511999998888@s.whatsapp.net', '5511999998888@lid')).toBe(false);
  });

  it('é falso para entrada inválida, nunca "verdadeiro por vacuidade"', () => {
    expect(sameUser(undefined, undefined)).toBe(false);
    expect(sameUser('', '')).toBe(false);
    expect(sameUser(null, '123@g.us')).toBe(false);
  });
});

describe('jidUser', () => {
  it('devolve só o identificador', () => {
    expect(jidUser('5511999998888:9@s.whatsapp.net')).toBe('5511999998888');
    expect(jidUser('nada')).toBeUndefined();
  });
});
