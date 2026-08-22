import { Queue, Worker, type Job, type Processor, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { jobSchemas } from './jobs.js';
import { DEFAULT_CONCURRENCY, DEFAULT_JOB_OPTIONS, type QueueName } from './queues.js';

type PayloadOf<N extends QueueName> = z.infer<(typeof jobSchemas)[N]>;

/**
 * Prefixo das chaves no Redis.
 *
 * Vai aqui e não no `keyPrefix` do ioredis porque o BullMQ recusa aquele — ele
 * monta as próprias chaves e precisa saber o prefixo para os scripts Lua.
 * Serve para isolar ambientes que dividem a mesma instância de Redis.
 */
export interface QueueOptions {
  readonly prefix?: string;
}

/**
 * Produtor tipado.
 *
 * Valida o payload antes de enfileirar. Um job inválido descoberto na produção
 * é um erro imediato de quem chamou; descoberto no consumo, é um job envenenado
 * que consome as três tentativas e vai para a fila morta.
 */
export class QueueProducer<N extends QueueName> {
  private readonly queue: Queue;

  constructor(
    private readonly name: N,
    connection: Redis,
    options: QueueOptions = {},
  ) {
    this.queue = new Queue(name, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS[name],
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    });
  }

  async add(payload: PayloadOf<N>, jobId?: string): Promise<string> {
    const validado = jobSchemas[this.name].parse(payload) as PayloadOf<N>;
    const job = await this.queue.add(this.name, validado, jobId === undefined ? {} : { jobId });
    return job.id ?? '';
  }

  async close(): Promise<void> {
    await this.queue.close();
  }

  /** Exposto para inspeção e testes; prefira `add` no código de produção. */
  get raw(): Queue {
    return this.queue;
  }
}

export interface ConsumerOptions extends QueueOptions {
  readonly concurrency?: number;
  readonly limiter?: WorkerOptions['limiter'];
}

/**
 * Consumidor tipado.
 *
 * Revalida o payload na leitura, pelo motivo descrito em `jobs.ts`: entre
 * enfileirar e consumir pode ter havido um deploy.
 */
export function createConsumer<N extends QueueName>(
  name: N,
  connection: Redis,
  handler: (payload: PayloadOf<N>, job: Job) => Promise<void>,
  options: ConsumerOptions = {},
): Worker {
  const processor: Processor = async (job) => {
    const payload = jobSchemas[name].parse(job.data) as PayloadOf<N>;
    await handler(payload, job);
  };

  return new Worker(name, processor, {
    connection,
    concurrency: options.concurrency ?? DEFAULT_CONCURRENCY[name],
    ...(options.limiter === undefined ? {} : { limiter: options.limiter }),
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  });
}
