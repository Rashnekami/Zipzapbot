import { uuidv7 } from '@zipzap/shared';
import type { Db } from '../pool.js';
import type { MemberRole, User } from '../schema.js';

export interface UpsertUser {
  readonly jid: string;
  readonly lid?: string | undefined;
  readonly pushName?: string | undefined;
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  /**
   * Cria ou atualiza o participante.
   *
   * `lid` só é sobrescrito quando vem preenchido: um evento sem LID não pode
   * apagar o LID que já conhecíamos, senão a identidade do participante oscila
   * conforme o tipo de evento que chegou por último.
   */
  async upsert(input: UpsertUser): Promise<User> {
    return await this.db
      .insertInto('users')
      .values({
        id: uuidv7(),
        jid: input.jid,
        lid: input.lid ?? null,
        push_name: input.pushName ?? null,
      })
      .onConflict((oc) =>
        oc.column('jid').doUpdateSet((eb) => ({
          lid: eb.fn.coalesce(eb.ref('excluded.lid'), eb.ref('users.lid')),
          push_name: eb.fn.coalesce(eb.ref('excluded.push_name'), eb.ref('users.push_name')),
          last_seen_at: new Date(),
        })),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findByJid(jid: string): Promise<User | undefined> {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where('jid', '=', jid)
      .executeTakeFirst();
  }

  /** Resolve por JID ou por LID — o WhatsApp entrega ora um, ora outro. */
  async findByAnyId(id: string): Promise<User | undefined> {
    return await this.db
      .selectFrom('users')
      .selectAll()
      .where((eb) => eb.or([eb('jid', '=', id), eb('lid', '=', id)]))
      .executeTakeFirst();
  }

  async setMembership(groupId: string, userId: string, role: MemberRole): Promise<void> {
    await this.db
      .insertInto('group_members')
      .values({ group_id: groupId, user_id: userId, role })
      .onConflict((oc) =>
        oc.columns(['group_id', 'user_id']).doUpdateSet({ role, left_at: null }),
      )
      .execute();
  }

  async roleIn(groupId: string, userId: string): Promise<MemberRole | undefined> {
    const row = await this.db
      .selectFrom('group_members')
      .select('role')
      .where('group_id', '=', groupId)
      .where('user_id', '=', userId)
      .where('left_at', 'is', null)
      .executeTakeFirst();
    return row?.role;
  }
}
