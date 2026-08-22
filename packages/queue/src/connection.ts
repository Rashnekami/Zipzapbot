import { Redis, type RedisOptions } from 'ioredis';

/**
 * Conexão Redis para BullMQ.
 *
 * `maxRetriesPerRequest: null` é exigência do BullMQ: com um número finito, uma
 * queda de rede faz o comando bloqueante do worker estourar e o worker morre em
 * vez de esperar o Redis voltar.
 */
export function createRedis(url: string, overrides: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (tentativa) => Math.min(tentativa * 200, 5_000),
    ...overrides,
  });
}
