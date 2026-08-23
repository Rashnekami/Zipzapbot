import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  decrypt,
  decryptToString,
  encrypt,
  isEncrypted,
  parseKey,
  safeEqual,
} from './crypto.js';

const chave = randomBytes(32);

describe('parseKey', () => {
  it('aceita hexadecimal de 64 caracteres', () => {
    expect(parseKey('a'.repeat(64))).toHaveLength(32);
  });

  it('aceita base64 de 32 bytes', () => {
    expect(parseKey(randomBytes(32).toString('base64'))).toHaveLength(32);
  });

  it('recusa chave de tamanho errado, em vez de aceitar em silêncio', () => {
    expect(() => parseKey('curta')).toThrow(CryptoError);
    expect(() => parseKey('a'.repeat(62))).toThrow(CryptoError);
  });
});

describe('encrypt/decrypt', () => {
  it('devolve o mesmo conteúdo', () => {
    const texto = 'credencial da sessão do WhatsApp';
    expect(decryptToString(encrypt(texto, chave), chave)).toBe(texto);
  });

  it('preserva dados binários intactos', () => {
    const bin = randomBytes(1024);
    expect(decrypt(encrypt(bin, chave), chave).equals(bin)).toBe(true);
  });

  it('não vaza o conteúdo no envelope', () => {
    const envelope = encrypt('minha-senha-secreta', chave);
    expect(envelope).not.toContain('minha-senha-secreta');
    expect(isEncrypted(envelope)).toBe(true);
  });

  it('gera envelope diferente a cada chamada, mesmo com o mesmo texto', () => {
    const a = encrypt('igual', chave);
    const b = encrypt('igual', chave);
    expect(a).not.toBe(b);
    expect(decryptToString(a, chave)).toBe(decryptToString(b, chave));
  });

  it('recusa decifrar com chave errada', () => {
    const envelope = encrypt('segredo', chave);
    expect(() => decrypt(envelope, randomBytes(32))).toThrow(CryptoError);
  });

  it('detecta adulteração do conteúdo — é isso que GCM garante', () => {
    const envelope = encrypt('transferir 100 reais', chave);
    const [v, nonce, tag, dados] = envelope.split(':');
    const adulterado = Buffer.from(dados!, 'base64');
    adulterado[0] = (adulterado[0]! ^ 0xff) & 0xff;

    expect(() =>
      decrypt([v, nonce, tag, adulterado.toString('base64')].join(':'), chave),
    ).toThrow(/adulterado ou chave incorreta/);
  });

  it('detecta adulteração da tag de autenticação', () => {
    const envelope = encrypt('segredo', chave);
    const [v, nonce, , dados] = envelope.split(':');
    const tagFalsa = randomBytes(16).toString('base64');
    expect(() => decrypt([v, nonce, tagFalsa, dados].join(':'), chave)).toThrow(CryptoError);
  });

  it('recusa envelope malformado ou de versão desconhecida', () => {
    expect(() => decrypt('nao-e-envelope', chave)).toThrow(/malformado/);
    expect(() => decrypt('v9:a:b:c', chave)).toThrow(/Versão de envelope desconhecida/);
    expect(() => decrypt('v1:curto:curto:x', chave)).toThrow(/tamanho inválido/);
  });

  it('não confunde texto puro com envelope', () => {
    expect(isEncrypted('texto normal')).toBe(false);
    expect(isEncrypted('v1:so:tres')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('compara corretamente', () => {
    expect(safeEqual('token-abc', 'token-abc')).toBe(true);
    expect(safeEqual('token-abc', 'token-abd')).toBe(false);
  });

  it('não estoura com tamanhos diferentes', () => {
    expect(safeEqual('curto', 'bem mais comprido')).toBe(false);
  });
});
