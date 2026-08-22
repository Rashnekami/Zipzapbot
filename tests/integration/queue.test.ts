import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import type { Worker } from 'bullmq';
import {
  createConsumer,
  createRedis,
  QueueProducer,
  type MediaJobPayload,
} from '../../packages/queue/src/index.js';

const TEST_REDIS_URL = process.env['TEST_REDIS_URL'];
const temRedis = TEST_REDIS_URL !== undefined;

/** Prefixo único por execução, para que rodadas paralelas não se atrapalhem. */
const sufixo = randomUUID().slice(0, 8);

function jobDeTeste(url: string): MediaJobPayload {
  return {
    type: 'fetch_metadata',
    requestId: randomUUID(),
    chatJid: '120@g.us',
    requesterJid: '55a@s.whatsapp.net',
    url,
  };
}

describe.skipIf(!temRedis)('filas', () => {
  let redis: Redis;
  const paraFechar: Array<{ close: () => Promise<void> }> = [];
  const workers: Worker[] = [];

  beforeAll(() => {
    redis = createRedis(TEST_REDIS_URL!);
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(paraFechar.map((c) => c.close()));
    await redis.quit();
  });

  it('recusa payload inválido antes de tocar no Redis', async () => {
    const fila = new QueueProducer('media', createRedis(TEST_REDIS_URL!));
    paraFechar.push(fila);

    await expect(
      // @ts-expect-error payload propositalmente inválido
      fila.add({ type: 'fetch_metadata', url: 'não é url' }),
    ).rejects.toThrow();

    expect(await fila.raw.getWaitingCount()).toBe(0);
  });

  it('respeita o limite de downloads simultâneos — critério de aceite 18', async () => {
    const nomeFila = `media`;
    const prefix = `{zzb-${sufixo}}`;
    const conexaoProdutor = createRedis(TEST_REDIS_URL!);
    const conexaoWorker = createRedis(TEST_REDIS_URL!);

    const fila = new QueueProducer(nomeFila, conexaoProdutor, { prefix });
    paraFechar.push(fila);
    await fila.raw.obliterate({ force: true }).catch(() => undefined);

    const CONCORRENCIA = 2;
    const TOTAL = 6;

    let emExecucao = 0;
    let picoSimultaneo = 0;
    let concluidos = 0;

    const terminou = new Promise<void>((resolve) => {
      const worker = createConsumer(
        nomeFila,
        conexaoWorker,
        async () => {
          emExecucao += 1;
          picoSimultaneo = Math.max(picoSimultaneo, emExecucao);
          await new Promise((r) => setTimeout(r, 60));
          emExecucao -= 1;
          concluidos += 1;
          if (concluidos === TOTAL) resolve();
        },
        { concurrency: CONCORRENCIA, prefix },
      );
      workers.push(worker);
    });

    for (let i = 0; i < TOTAL; i++) {
      await fila.add(jobDeTeste(`https://youtu.be/video-${i}`));
    }

    await terminou;

    expect(concluidos).toBe(TOTAL);
    expect(
      picoSimultaneo,
      `a fila deixou ${picoSimultaneo} jobs rodarem ao mesmo tempo, o limite é ${CONCORRENCIA}`,
    ).toBeLessThanOrEqual(CONCORRENCIA);
    // Se nunca chegou a 2, o teste não provou nada sobre paralelismo.
    expect(picoSimultaneo).toBe(CONCORRENCIA);
  }, 20_000);

  it('não enfileira o mesmo job duas vezes quando o id é reaproveitado', async () => {
    const conexao = createRedis(TEST_REDIS_URL!);
    const fila = new QueueProducer('media', conexao, { prefix: `{zzb-${sufixo}-idem}` });
    paraFechar.push(fila);
    await fila.raw.obliterate({ force: true }).catch(() => undefined);

    const idFixo = `job-${randomUUID()}`;
    await fila.add(jobDeTeste('https://youtu.be/a'), idFixo);
    await fila.add(jobDeTeste('https://youtu.be/a'), idFixo);

    expect(await fila.raw.getWaitingCount()).toBe(1);
  });

  it('revalida na leitura: job envenenado falha na borda, não no meio do trabalho', async () => {
    const prefixoMau = `{zzb-${sufixo}-mau}`;
    const conexaoProdutor = createRedis(TEST_REDIS_URL!);
    const conexaoWorker = createRedis(TEST_REDIS_URL!);

    const fila = new QueueProducer('media', conexaoProdutor, { prefix: prefixoMau });
    paraFechar.push(fila);
    await fila.raw.obliterate({ force: true }).catch(() => undefined);

    // Simula o payload de um deploy antigo, escrito direto na fila.
    await fila.raw.add(
      'media',
      { type: 'fetch_metadata', url: 'formato-antigo' },
      { attempts: 1 },
    );

    let handlerChamado = false;
    const falhou = new Promise<Error>((resolve) => {
      const worker = createConsumer(
        'media',
        conexaoWorker,
        () => {
          handlerChamado = true;
          return Promise.resolve();
        },
        { concurrency: 1, prefix: prefixoMau },
      );
      workers.push(worker);
      worker.on('failed', (_job, err) => resolve(err));
    });

    const erro = await falhou;
    expect(handlerChamado, 'o handler não deveria ter sido chamado').toBe(false);
    expect(erro).toBeDefined();
  }, 20_000);
});
