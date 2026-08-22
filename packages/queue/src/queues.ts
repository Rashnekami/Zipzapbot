import type { JobsOptions } from 'bullmq';

export const QUEUE_NAMES = {
  media: 'media',
  outbound: 'outbound',
  maintenance: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Política de retentativa por fila.
 *
 * `media` tenta três vezes com espera crescente: falha de rede e extrator
 * temporariamente fora do ar se resolvem sozinhos. `outbound` tenta mais vezes e
 * mais rápido, porque uma reconexão do WhatsApp costuma durar segundos e perder
 * a mensagem é pior do que reenviá-la — o registro em `bot_messages` é
 * idempotente justamente para tornar o reenvio seguro.
 */
export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  media: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 3_600, count: 500 },
    removeOnFail: { age: 86_400 },
  },
  outbound: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { age: 600, count: 1_000 },
    removeOnFail: { age: 86_400 },
  },
  maintenance: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 30_000 },
    removeOnComplete: { age: 3_600, count: 50 },
    removeOnFail: { age: 86_400 },
  },
};

/**
 * Concorrência de cada fila.
 *
 * `media` fica em 2 por padrão porque cada job gasta CPU em ffmpeg e disco em
 * arquivo temporário — é o limite "dois downloads simultâneos por servidor" do
 * briefing, e o valor real vem de MAX_CONCURRENT_DOWNLOADS.
 *
 * `outbound` fica em 1 de propósito: o socket do WhatsApp é um recurso único, e
 * paralelizar o envio embaralha a ordem das mensagens de uma mesma conversa.
 */
export const DEFAULT_CONCURRENCY: Record<QueueName, number> = {
  media: 2,
  outbound: 1,
  maintenance: 1,
};
