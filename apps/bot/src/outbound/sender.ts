import type { SendMediaInput, SendResult, SendTextInput, WhatsAppGateway } from '@zipzap/core';
import { isGroupJid } from '@zipzap/core';
import type { BotMessageKind, BotMessageRepository, GroupRepository } from '@zipzap/db';
import type { Logger } from '@zipzap/logger';

export interface SendTextRequest extends SendTextInput {
  readonly kind: BotMessageKind;
}

export interface SendMediaRequest extends SendMediaInput {
  readonly kind?: BotMessageKind;
  /** Trecho a guardar como contexto. Para midia, o padrao e a legenda. */
  readonly preview?: string;
  /** A quem estamos respondendo, quando aplicavel. */
  readonly replyToUser?: string;
}

/**
 * Unico ponto de saida de mensagens do bot.
 *
 * Nenhum comando, worker ou resolver chama `gateway.sendText` diretamente. Todos
 * passam por aqui, e o motivo e o critério de aceite 3: para saber se uma
 * mensagem recebida esta respondendo ao bot, precisamos ter registrado o envio.
 *
 * Se o registro ficasse a cargo de cada chamador, bastaria um comando novo
 * esquecer de registrar para que responder aquela mensagem deixasse de acionar
 * a IA — e o sintoma seria "as vezes o bot ignora a resposta", que e
 * praticamente impossivel de diagnosticar em producao. Centralizando, esquecer
 * deixa de ser uma opcao.
 */
export class MessageSender {
  constructor(
    private readonly gateway: WhatsAppGateway,
    private readonly botMessages: BotMessageRepository,
    private readonly groups: GroupRepository,
    private readonly logger: Logger,
  ) {}

  async sendText(req: SendTextRequest): Promise<SendResult> {
    const resultado = await this.gateway.sendText(req);
    await this.registrar(resultado, req.kind, req.text, undefined);
    return resultado;
  }

  async sendMedia(req: SendMediaRequest): Promise<SendResult> {
    const resultado = await this.gateway.sendMedia(req);
    await this.registrar(
      resultado,
      req.kind ?? 'media',
      req.preview ?? req.caption ?? `[${req.mediaType}]`,
      req.replyToUser,
    );
    return resultado;
  }

  private async registrar(
    resultado: SendResult,
    kind: BotMessageKind,
    preview: string,
    replyToUser: string | undefined,
  ): Promise<void> {
    try {
      const grupo = isGroupJid(resultado.chatJid)
        ? await this.groups.findByJid(resultado.chatJid)
        : undefined;

      await this.botMessages.record({
        chatJid: resultado.chatJid,
        stanzaId: resultado.stanzaId,
        kind,
        groupId: grupo?.id,
        preview,
        replyToUser,
      });
    } catch (erro) {
      // A mensagem ja foi entregue: falhar aqui seria transformar um problema de
      // registro em erro visivel para o usuario, e um retry reenviaria a
      // mensagem. Registramos o erro em nivel alto porque a consequencia e real:
      // responder a esta mensagem especifica nao vai acionar a IA.
      this.logger.error(
        { err: erro, stanzaId: resultado.stanzaId, chatJid: resultado.chatJid },
        'mensagem enviada mas nao registrada em bot_messages',
      );
    }
  }
}
