import type { WAMessage } from 'baileys';

/**
 * Cache limitado das mensagens recentes, indexado por `stanzaId`.
 *
 * Existe por dois motivos concretos:
 *
 * 1. Para **citar** uma mensagem ao responder, o Baileys quer a mensagem
 *    inteira, nao so o id. Nosso dominio trabalha com `stanzaId`, entao e aqui
 *    que a traducao acontece.
 * 2. O Baileys pede a mensagem original de volta (`getMessage`) quando precisa
 *    reenviar por falha de entrega. Sem isso, a mensagem simplesmente se perde.
 *
 * E deliberadamente em memoria e limitado: nao e armazenamento de conversa.
 * O que precisa sobreviver a um restart vai para `bot_messages`, no Postgres.
 */
export class RecentMessages {
  private readonly mapa = new Map<string, WAMessage>();

  constructor(private readonly capacidade = 500) {}

  private chave(chatJid: string, stanzaId: string): string {
    return `${chatJid} ${stanzaId}`;
  }

  remember(msg: WAMessage): void {
    const chatJid = msg.key.remoteJid;
    const id = msg.key.id;
    if (typeof chatJid !== 'string' || typeof id !== 'string') return;

    const chave = this.chave(chatJid, id);
    // Reinserir move a chave para o fim da ordem de iteracao do Map, que e o
    // que da o comportamento de "usado recentemente" sem estrutura extra.
    this.mapa.delete(chave);
    this.mapa.set(chave, msg);

    while (this.mapa.size > this.capacidade) {
      const maisAntiga = this.mapa.keys().next();
      if (maisAntiga.done === true) break;
      this.mapa.delete(maisAntiga.value);
    }
  }

  get(chatJid: string, stanzaId: string): WAMessage | undefined {
    return this.mapa.get(this.chave(chatJid, stanzaId));
  }

  get size(): number {
    return this.mapa.size;
  }
}
