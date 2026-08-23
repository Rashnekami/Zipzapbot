/**
 * Mensagem recebida, no formato interno do projeto.
 *
 * O pipeline inteiro trabalha sobre este tipo, nunca sobre a estrutura do
 * Baileys. Quando a linha 7.x sair de release candidate, é a função de
 * normalização que muda — não os resolvers, não os comandos, não os testes.
 */

export type MediaKind = 'image' | 'video' | 'audio' | 'sticker' | 'document' | 'none';

export interface QuotedContext {
  /** Id da mensagem citada. É por ele que consultamos `bot_messages`. */
  readonly stanzaId: string;
  /**
   * Quem o remetente **alega** ter enviado a mensagem citada.
   *
   * Campo informativo apenas. Não use para decidir se a citação é do bot: ele é
   * preenchido pelo remetente e existe advisory pública de spoofing de mensagem
   * no Baileys. A autoridade é a nossa tabela `bot_messages`.
   */
  readonly claimedParticipant?: string;
  /** Texto da mensagem citada, quando havia texto. */
  readonly text?: string;
  readonly mediaKind: MediaKind;
}

export interface IncomingMessage {
  /** `key.id` — identifica a mensagem dentro do chat. */
  readonly id: string;
  readonly chatJid: string;
  /** Quem enviou. Em grupo é o participante; em conversa direta, o próprio chat. */
  readonly senderJid: string;
  /** LID do remetente, quando o WhatsApp o informa. */
  readonly senderLid?: string;
  readonly pushName?: string;
  readonly isGroup: boolean;
  readonly fromMe: boolean;
  /** Instante do envio, em milissegundos. */
  readonly timestamp: number;
  /** Texto ou legenda. Vazio quando a mensagem não tem texto. */
  readonly text: string;
  readonly mediaKind: MediaKind;
  /**
   * JIDs realmente mencionados, segundo o WhatsApp.
   *
   * Isto é o que decide menção — não o texto. Escrever "zipzapbot" numa frase
   * não coloca nada aqui.
   */
  readonly mentionedJids: readonly string[];
  readonly quoted?: QuotedContext;
  /**
   * Referência opaca à mensagem original.
   *
   * Existe só para o adaptador conseguir baixar a mídia depois. Nenhum código de
   * domínio deve inspecionar este campo.
   */
  readonly raw: unknown;
}

/** A mensagem tem mídia utilizável por um comando de conversão? */
export function hasMedia(msg: Pick<IncomingMessage, 'mediaKind'>): boolean {
  return msg.mediaKind !== 'none';
}

/**
 * Mídia alvo de um comando: a da própria mensagem ou a da mensagem citada.
 *
 * Cobre as duas formas exigidas pelo briefing — legenda na mídia e resposta a
 * uma mídia anterior — num único ponto, para que todo comando de conversão se
 * comporte igual.
 */
export function resolveTargetMediaKind(msg: IncomingMessage): MediaKind {
  if (msg.mediaKind !== 'none') return msg.mediaKind;
  return msg.quoted?.mediaKind ?? 'none';
}
