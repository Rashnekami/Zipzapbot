import { uuidv7 } from '@zipzap/shared';
import type { Db } from '../pool.js';
import type { BotMessage, BotMessageKind } from '../schema.js';

export interface RecordSentMessage {
  readonly chatJid: string;
  readonly stanzaId: string;
  readonly kind: BotMessageKind;
  readonly groupId?: string | undefined;
  readonly replyToUser?: string | undefined;
  readonly preview?: string | undefined;
}

/** Limite do trecho guardado para contexto. O objetivo é lembrar do que
 *  falávamos, não arquivar a conversa inteira. */
const PREVIEW_MAX = 500;

/**
 * Registro de tudo que o bot envia.
 *
 * Toda mensagem enviada passa por aqui, e é isso que permite responder à
 * pergunta do resolver 5: "esta mensagem está citando algo que nós mandamos?".
 * A gravação fica no adaptador de saída, não em cada comando, justamente para
 * que seja impossível esquecer de registrar.
 */
export class BotMessageRepository {
  constructor(private readonly db: Db) {}

  async record(msg: RecordSentMessage): Promise<BotMessage> {
    const preview = msg.preview?.slice(0, PREVIEW_MAX) ?? null;

    return await this.db
      .insertInto('bot_messages')
      .values({
        id: uuidv7(),
        chat_jid: msg.chatJid,
        stanza_id: msg.stanzaId,
        kind: msg.kind,
        group_id: msg.groupId ?? null,
        reply_to_user: msg.replyToUser ?? null,
        preview,
      })
      // Reenvio de um job idempotente não deve estourar por chave duplicada.
      .onConflict((oc) => oc.columns(['chat_jid', 'stanza_id']).doUpdateSet({ preview }))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Procura uma mensagem nossa por chat e id de stanza.
   *
   * Devolver `undefined` significa "não fomos nós", e o pipeline trata a
   * mensagem como comum — ou seja, ignora. Falha fechada, do lado seguro: se a
   * mensagem é antiga demais e já saiu da retenção, preferimos não responder a
   * responder a algo que não sabemos o que é.
   */
  async find(chatJid: string, stanzaId: string): Promise<BotMessage | undefined> {
    return await this.db
      .selectFrom('bot_messages')
      .selectAll()
      .where('chat_jid', '=', chatJid)
      .where('stanza_id', '=', stanzaId)
      .executeTakeFirst();
  }

  /** Remove registros além da janela de retenção. Roda na fila de manutenção. */
  async purgeOlderThan(days: number): Promise<number> {
    const limite = new Date(Date.now() - days * 86_400_000);
    const r = await this.db
      .deleteFrom('bot_messages')
      .where('sent_at', '<', limite)
      .executeTakeFirst();
    return Number(r.numDeletedRows ?? 0n);
  }
}
