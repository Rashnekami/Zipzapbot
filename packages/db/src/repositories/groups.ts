import { uuidv7 } from '@zipzap/shared';
import type { Db } from '../pool.js';
import type { Group, GroupSettings } from '../schema.js';

/**
 * Alterações permitidas na configuração do grupo.
 *
 * Escrita à mão em vez de `Updateable<GroupSettingsTable>` para que `features`
 * seja um objeto na fronteira — quem chama não deveria precisar saber que a
 * coluna é jsonb e exige string.
 */
export interface GroupSettingsPatch {
  readonly prefix?: string;
  readonly aiEnabled?: boolean;
  readonly memoryEnabled?: boolean;
  readonly learningEnabled?: boolean;
  readonly aiDailyLimit?: number;
  readonly aiUserDailyLimit?: number;
  readonly mediaDailyLimit?: number;
  readonly maxVideoSeconds?: number;
  readonly maxFileBytes?: number;
  readonly features?: Record<string, unknown>;
}

export class GroupRepository {
  constructor(private readonly db: Db) {}

  /**
   * Garante que o grupo existe e devolve o registro.
   *
   * O bot entra em grupo a qualquer momento, sem passar por cadastro. Toda
   * operação que depende de grupo começa por aqui, e por isso a configuração
   * padrão é criada na mesma transação: grupo sem `group_settings` seria um
   * estado que metade do código teria de tratar.
   */
  async ensure(jid: string, subject?: string): Promise<Group> {
    return await this.db.transaction().execute(async (trx) => {
      const grupo = await trx
        .insertInto('groups')
        .values({ id: uuidv7(), jid, subject: subject ?? null })
        .onConflict((oc) =>
          oc.column('jid').doUpdateSet(subject === undefined ? { jid } : { subject }),
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('group_settings')
        .values({ group_id: grupo.id })
        .onConflict((oc) => oc.column('group_id').doNothing())
        .execute();

      return grupo;
    });
  }

  async findByJid(jid: string): Promise<Group | undefined> {
    return await this.db
      .selectFrom('groups')
      .selectAll()
      .where('jid', '=', jid)
      .executeTakeFirst();
  }

  async settings(groupId: string): Promise<GroupSettings | undefined> {
    return await this.db
      .selectFrom('group_settings')
      .selectAll()
      .where('group_id', '=', groupId)
      .executeTakeFirst();
  }

  async updateSettings(groupId: string, patch: GroupSettingsPatch): Promise<GroupSettings> {
    const set = {
      ...(patch.prefix === undefined ? {} : { prefix: patch.prefix }),
      ...(patch.aiEnabled === undefined ? {} : { ai_enabled: patch.aiEnabled }),
      ...(patch.memoryEnabled === undefined ? {} : { memory_enabled: patch.memoryEnabled }),
      ...(patch.learningEnabled === undefined
        ? {}
        : { learning_enabled: patch.learningEnabled }),
      ...(patch.aiDailyLimit === undefined ? {} : { ai_daily_limit: patch.aiDailyLimit }),
      ...(patch.aiUserDailyLimit === undefined
        ? {}
        : { ai_user_daily_limit: patch.aiUserDailyLimit }),
      ...(patch.mediaDailyLimit === undefined
        ? {}
        : { media_daily_limit: patch.mediaDailyLimit }),
      ...(patch.maxVideoSeconds === undefined
        ? {}
        : { max_video_seconds: patch.maxVideoSeconds }),
      ...(patch.maxFileBytes === undefined
        ? {}
        : { max_file_bytes: String(patch.maxFileBytes) }),
      ...(patch.features === undefined ? {} : { features: JSON.stringify(patch.features) }),
    };

    return await this.db
      .updateTable('group_settings')
      .set(set)
      .where('group_id', '=', groupId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
