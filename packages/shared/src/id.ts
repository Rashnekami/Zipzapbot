import { randomBytes, randomUUID } from 'node:crypto';

/**
 * UUID versão 7: 48 bits de timestamp em milissegundos seguidos de aleatoriedade.
 *
 * Usamos v7 e não v4 como chave primária porque a ordenação do identificador
 * acompanha a ordem de criação. Em índice B-tree isso mantém as inserções na
 * mesma página, em vez de espalhá-las pelo índice inteiro como o v4 faz.
 *
 * Layout (RFC 9562):
 *   0-5   timestamp em ms, big-endian
 *   6     versão (0111) nos 4 bits altos + 4 bits aleatórios
 *   7     8 bits aleatórios
 *   8     variante (10) nos 2 bits altos + 6 bits aleatórios
 *   9-15  aleatório
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);

  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // versão 7 nos 4 bits altos do byte 6
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // variante RFC 4122 nos 2 bits altos do byte 8
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Extrai o instante de criação de um UUID v7. */
export function timestampFromUuidv7(id: string): number {
  const hex = id.replace(/-/g, '');
  return Number.parseInt(hex.slice(0, 12), 16);
}

/**
 * Identificador de correlação de uma requisição, usado como chave de
 * idempotência ponta a ponta (bot -> fila -> gateway).
 */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Nome seguro para arquivo ou diretório temporário.
 *
 * Nunca derivado de entrada do usuário: é isso que fecha, de uma vez, path
 * traversal e colisão entre jobs simultâneos.
 */
export function randomToken(byteLength = 16): string {
  return randomBytes(byteLength).toString('hex');
}
