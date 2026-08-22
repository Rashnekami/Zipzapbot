import { describe, expect, it } from 'vitest';
import { maskJid, redactDeep, redactText, REDACTED } from './redact.js';

describe('redactText', () => {
  it('esconde cabeçalho de autorização', () => {
    const out = redactText('Authorization: Bearer ghp_abcdefghijklmnop1234');
    expect(out).not.toContain('ghp_abcdefghijklmnop1234');
    expect(out).toContain(REDACTED);
  });

  it('esconde a senha de uma URL de banco, preservando o resto', () => {
    const out = redactText('falhou em postgres://zipzap:sup3rS3cr3t@db:5432/zipzap');
    expect(out).not.toContain('sup3rS3cr3t');
    expect(out).toContain('postgres://zipzap');
    expect(out).toContain('@db:5432/zipzap');
  });

  it('esconde chave com prefixo de provedor', () => {
    for (const chave of [
      'sk-abcdefghijklmnopqrstuvwx',
      'gsk_ABCDEFGHIJKLMNOPQRSTUVWX',
      'xai-0123456789abcdefghijklmn',
    ]) {
      expect(redactText(`chave ${chave} recusada`)).not.toContain(chave);
    }
  });

  it('esconde JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p';
    expect(redactText(`token=${jwt}`)).not.toContain('dBjftJeZ4CVPmB92K27uhbUJU1p');
  });

  it('esconde par chave=valor preservando a chave', () => {
    const out = redactText('config: api_key=abc123XYZ789 e porta=3000');
    expect(out).not.toContain('abc123XYZ789');
    expect(out).toContain('api_key=');
    expect(out).toContain('porta=3000');
  });

  it('não estraga texto sem segredo', () => {
    const texto = 'baixando video de 12 minutos, 2 jobs na fila';
    expect(redactText(texto)).toBe(texto);
  });
});

describe('maskJid', () => {
  it('preserva país, DDD e dois dígitos finais', () => {
    expect(maskJid('5511999998888@s.whatsapp.net')).toBe('5511*******88@s.whatsapp.net');
  });

  it('mascara identificadores curtos por inteiro', () => {
    expect(maskJid('123@lid')).toBe('***@lid');
  });

  it('ignora o sufixo de dispositivo', () => {
    expect(maskJid('5511999998888:12@s.whatsapp.net')).toBe('5511*******88@s.whatsapp.net');
  });

  it('não deixa o número original aparecer', () => {
    expect(maskJid('5511999998888@s.whatsapp.net')).not.toContain('999998888');
  });
});

describe('redactDeep', () => {
  it('varre objeto aninhado', () => {
    const entrada = {
      etapa: 'download',
      erro: { message: 'Authorization: Bearer sk-abcdefghijklmnopqrst' },
      lista: ['ok', 'senha=minhaSenhaSecreta'],
    };
    const saida = redactDeep(entrada);
    const texto = JSON.stringify(saida);
    expect(texto).not.toContain('sk-abcdefghijklmnopqrst');
    expect(texto).not.toContain('minhaSenhaSecreta');
    expect(saida.etapa).toBe('download');
  });

  it('para de descer em estrutura muito profunda em vez de estourar a pilha', () => {
    let profundo: Record<string, unknown> = { fim: 'token=abc123456789' };
    for (let i = 0; i < 50; i++) profundo = { nivel: profundo };
    expect(() => redactDeep(profundo)).not.toThrow();
  });
});
