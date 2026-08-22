import { uuidv7 } from '@zipzap/shared';
import type { Db } from '../pool.js';
import type { MediaJob, MediaJobKind, MediaJobStatus } from '../schema.js';

export interface CreateMediaJob {
  readonly kind: MediaJobKind;
  readonly groupId?: string | undefined;
  readonly userId?: string | undefined;
  readonly sourceHost?: string | undefined;
}

export class MediaJobRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateMediaJob): Promise<MediaJob> {
    return await this.db
      .insertInto('media_jobs')
      .values({
        id: uuidv7(),
        kind: input.kind,
        group_id: input.groupId ?? null,
        user_id: input.userId ?? null,
        source_host: input.sourceHost ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async markRunning(id: string): Promise<void> {
    await this.db
      .updateTable('media_jobs')
      .set({ status: 'running' })
      .where('id', '=', id)
      .execute();
  }

  async finish(
    id: string,
    result: {
      status: Extract<MediaJobStatus, 'done' | 'failed' | 'cancelled'>;
      bytes?: number | undefined;
      durationSeconds?: number | undefined;
      errorCode?: string | undefined;
    },
  ): Promise<void> {
    await this.db
      .updateTable('media_jobs')
      .set({
        status: result.status,
        bytes: result.bytes === undefined ? null : String(result.bytes),
        duration_s: result.durationSeconds ?? null,
        error_code: result.errorCode ?? null,
        finished_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
  }

  /**
   * Quantos jobs o usuário tem em andamento.
   *
   * Sustenta o limite "um trabalho ativo por usuário" do §13. A checagem é feita
   * aqui, e não só na fila, porque a fila é por servidor e este limite é por
   * pessoa: sem ele, um participante enfileira dez vídeos e os demais esperam.
   */
  async activeCountForUser(userId: string): Promise<number> {
    const row = await this.db
      .selectFrom('media_jobs')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('user_id', '=', userId)
      .where('status', 'in', ['queued', 'running'])
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  }

  /** Total de jobs concluídos ou em curso do grupo no dia, para a cota diária. */
  async countForGroupSince(groupId: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom('media_jobs')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .where('group_id', '=', groupId)
      .where('created_at', '>=', since)
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  }

  /**
   * Jobs que ficaram presos em `running`.
   *
   * Um worker morto no meio do trabalho deixa a linha travada, e o usuário fica
   * sem conseguir pedir outro download por causa do limite por pessoa. A rotina
   * de manutenção libera esses casos.
   */
  async reapStale(olderThanMs: number): Promise<number> {
    const limite = new Date(Date.now() - olderThanMs);
    const r = await this.db
      .updateTable('media_jobs')
      .set({ status: 'failed', error_code: 'stale', finished_at: new Date() })
      .where('status', 'in', ['queued', 'running'])
      .where('created_at', '<', limite)
      .executeTakeFirst();
    return Number(r.numUpdatedRows ?? 0n);
  }
}
