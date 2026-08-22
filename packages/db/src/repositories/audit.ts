import { uuidv7 } from '@zipzap/shared';
import type { Db } from '../pool.js';
import type { AuditEntry } from '../schema.js';

export interface AuditInput {
  readonly actorJid: string;
  readonly action: string;
  readonly groupId?: string | undefined;
  readonly target?: string | undefined;
  readonly payload?: Record<string, unknown> | undefined;
}

/**
 * Registro de ação administrativa.
 *
 * Vale tanto para a ação bem-sucedida quanto para a tentativa recusada: saber
 * quem tentou apagar a memória do grupo e foi barrado é tão útil quanto saber
 * quem conseguiu.
 */
export class AuditRepository {
  constructor(private readonly db: Db) {}

  async record(input: AuditInput): Promise<AuditEntry> {
    return await this.db
      .insertInto('audit_log')
      .values({
        id: uuidv7(),
        actor_jid: input.actorJid,
        action: input.action,
        group_id: input.groupId ?? null,
        target: input.target ?? null,
        payload: JSON.stringify(input.payload ?? {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async recentForGroup(groupId: string, limit = 50): Promise<AuditEntry[]> {
    return await this.db
      .selectFrom('audit_log')
      .selectAll()
      .where('group_id', '=', groupId)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
  }
}
