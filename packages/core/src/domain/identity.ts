import { normalizeJid, parseJid, SERVER } from './jid.js';

/**
 * Identidade do próprio bot.
 *
 * O WhatsApp identifica participantes ora por telefone (`@s.whatsapp.net`), ora
 * por LID (`@lid`), e um mesmo grupo pode entregar as duas formas na mesma
 * conversa. Comparar apenas com `sock.user.id` faz a menção ao bot falhar **em
 * silêncio** em grupos com LID ativo: a IA simplesmente nunca é acionada, e não
 * há erro nenhum no log para investigar.
 *
 * Por isso a identidade é resolvida uma vez, na conexão, e guarda todas as
 * formas conhecidas.
 */
export class SelfIdentity {
  private readonly formas: ReadonlySet<string>;

  private constructor(
    readonly phoneJid: string | undefined,
    readonly lid: string | undefined,
  ) {
    const formas = new Set<string>();
    if (phoneJid !== undefined) formas.add(phoneJid);
    if (lid !== undefined) formas.add(lid);
    this.formas = formas;
  }

  /**
   * Constrói a partir do que o socket informa após conectar.
   *
   * Aceita as duas fontes porque o Baileys expõe `user.id` sempre e `user.lid`
   * apenas em algumas conexões — e o LID também pode chegar depois, por evento.
   */
  static from(input: {
    id?: string | null | undefined;
    lid?: string | null | undefined;
  }): SelfIdentity {
    return new SelfIdentity(normalizeJid(input.id), normalizeJid(input.lid));
  }

  /** Devolve uma nova identidade acrescentando o LID descoberto depois. */
  withLid(lid: string | null | undefined): SelfIdentity {
    const normalizado = normalizeJid(lid);
    if (normalizado === undefined || normalizado === this.lid) return this;
    return new SelfIdentity(this.phoneJid, normalizado);
  }

  /**
   * O JID informado é o bot?
   *
   * Compara na forma canônica, então o sufixo de dispositivo não interfere.
   */
  matches(jid: string | null | undefined): boolean {
    const normalizado = normalizeJid(jid);
    return normalizado !== undefined && this.formas.has(normalizado);
  }

  /** Alguma das identidades foi resolvida? Falso antes de conectar. */
  get isResolved(): boolean {
    return this.formas.size > 0;
  }

  /** Todas as formas conhecidas, para log e diagnóstico. */
  get all(): readonly string[] {
    return [...this.formas];
  }

  /** Só o número, quando a identidade por telefone é conhecida. */
  get phoneNumber(): string | undefined {
    const p = parseJid(this.phoneJid);
    return p?.server === SERVER.user ? p.user : undefined;
  }
}
