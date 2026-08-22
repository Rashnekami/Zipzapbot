import { describe, expect, it } from 'vitest';
import { randomToken, timestampFromUuidv7, uuidv7 } from './id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produz o formato canônico de UUID', () => {
    expect(uuidv7()).toMatch(UUID_RE);
  });

  it('marca versão 7 e variante RFC 4122', () => {
    const id = uuidv7();
    expect(id[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });

  it('preserva o timestamp informado', () => {
    const now = 1_755_000_000_000;
    expect(timestampFromUuidv7(uuidv7(now))).toBe(now);
  });

  it('ordena lexicograficamente na mesma ordem do tempo', () => {
    const ids = [1000, 2000, 3000, 4000].map((ms) => uuidv7(1_700_000_000_000 + ms));
    expect([...ids].sort()).toEqual(ids);
  });

  it('não repete dentro do mesmo milissegundo', () => {
    const ms = Date.now();
    const gerados = new Set(Array.from({ length: 5000 }, () => uuidv7(ms)));
    expect(gerados.size).toBe(5000);
  });
});

describe('randomToken', () => {
  it('devolve hexadecimal com o dobro do número de bytes', () => {
    expect(randomToken(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('não produz caractere que atravesse diretório', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomToken()).not.toMatch(/[^0-9a-f]/);
    }
  });
});
