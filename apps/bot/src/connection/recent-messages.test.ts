import { describe, expect, it } from 'vitest';
import type { WAMessage } from 'baileys';
import { RecentMessages } from './recent-messages.js';

function msg(chat: string, id: string): WAMessage {
  return { key: { remoteJid: chat, id, fromMe: false }, message: {} };
}

describe('RecentMessages', () => {
  it('guarda e devolve por chat e stanza', () => {
    const cache = new RecentMessages();
    cache.remember(msg('120@g.us', 'A'));
    expect(cache.get('120@g.us', 'A')).toBeDefined();
  });

  it('nao confunde o mesmo stanza em chats diferentes', () => {
    const cache = new RecentMessages();
    cache.remember(msg('120@g.us', 'IGUAL'));
    expect(cache.get('121@g.us', 'IGUAL')).toBeUndefined();
  });

  it('descarta as mais antigas ao passar da capacidade', () => {
    const cache = new RecentMessages(3);
    for (const id of ['A', 'B', 'C', 'D']) cache.remember(msg('120@g.us', id));

    expect(cache.size).toBe(3);
    expect(cache.get('120@g.us', 'A')).toBeUndefined();
    expect(cache.get('120@g.us', 'D')).toBeDefined();
  });

  it('reinserir renova a posicao, protegendo a mensagem em uso', () => {
    const cache = new RecentMessages(3);
    cache.remember(msg('120@g.us', 'A'));
    cache.remember(msg('120@g.us', 'B'));
    cache.remember(msg('120@g.us', 'C'));
    cache.remember(msg('120@g.us', 'A')); // A volta a ser a mais recente
    cache.remember(msg('120@g.us', 'D')); // expulsa B, nao A

    expect(cache.get('120@g.us', 'A')).toBeDefined();
    expect(cache.get('120@g.us', 'B')).toBeUndefined();
  });

  it('ignora mensagem sem chat ou sem id, em vez de guardar lixo', () => {
    const cache = new RecentMessages();
    cache.remember({ key: { remoteJid: null, id: 'A' } });
    cache.remember({ key: { remoteJid: '120@g.us', id: null } });
    expect(cache.size).toBe(0);
  });
});
