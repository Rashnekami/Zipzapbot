import { describe, expect, it } from 'vitest';
import { SelfIdentity } from './identity.js';

describe('SelfIdentity — base do critério de aceite 2', () => {
  const eu = SelfIdentity.from({
    id: '5511999998888:12@s.whatsapp.net',
    lid: '184736251937465@lid',
  });

  it('reconhece o próprio JID de telefone, com ou sem dispositivo', () => {
    expect(eu.matches('5511999998888@s.whatsapp.net')).toBe(true);
    expect(eu.matches('5511999998888:3@s.whatsapp.net')).toBe(true);
  });

  it('reconhece o próprio LID — o caso que falha em silêncio se esquecido', () => {
    expect(eu.matches('184736251937465@lid')).toBe(true);
    expect(eu.matches('184736251937465:5@lid')).toBe(true);
  });

  it('não reconhece outra pessoa', () => {
    expect(eu.matches('5511888887777@s.whatsapp.net')).toBe(false);
    expect(eu.matches('999999999999999@lid')).toBe(false);
  });

  it('não reconhece o mesmo número em servidor diferente', () => {
    expect(eu.matches('5511999998888@lid')).toBe(false);
    expect(eu.matches('184736251937465@s.whatsapp.net')).toBe(false);
  });

  it('não reconhece entrada inválida', () => {
    for (const ruim of [null, undefined, '', 'zipzapbot', '@']) {
      expect(eu.matches(ruim)).toBe(false);
    }
  });

  it('funciona quando só o telefone é conhecido', () => {
    const so = SelfIdentity.from({ id: '5511999998888@s.whatsapp.net' });
    expect(so.matches('5511999998888@s.whatsapp.net')).toBe(true);
    expect(so.matches('184736251937465@lid')).toBe(false);
    expect(so.isResolved).toBe(true);
  });

  it('não está resolvida antes de conectar, e não reconhece ninguém', () => {
    const vazia = SelfIdentity.from({});
    expect(vazia.isResolved).toBe(false);
    expect(vazia.matches('5511999998888@s.whatsapp.net')).toBe(false);
  });

  it('aceita o LID descoberto depois da conexão', () => {
    const antes = SelfIdentity.from({ id: '5511999998888@s.whatsapp.net' });
    const depois = antes.withLid('184736251937465:2@lid');

    expect(depois.matches('184736251937465@lid')).toBe(true);
    // a identidade é imutável: a instância antiga não muda
    expect(antes.matches('184736251937465@lid')).toBe(false);
  });

  it('withLid não recria quando nada muda', () => {
    const id = SelfIdentity.from({ id: '55a@s.whatsapp.net', lid: '1@lid' });
    expect(id.withLid('1@lid')).toBe(id);
    expect(id.withLid(undefined)).toBe(id);
  });

  it('expõe o número para exibição, mas não o LID como número', () => {
    expect(eu.phoneNumber).toBe('5511999998888');
    expect(SelfIdentity.from({ lid: '1@lid' }).phoneNumber).toBeUndefined();
  });

  it('lista todas as formas conhecidas, já normalizadas', () => {
    expect([...eu.all].sort()).toEqual(['184736251937465@lid', '5511999998888@s.whatsapp.net']);
  });
});
