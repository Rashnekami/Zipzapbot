import { getContentType } from 'baileys';
import type { WAMessage, WAMessageContent, proto } from 'baileys';
import { isAddressableChat, isGroupJid, normalizeJid } from '@zipzap/core';
import type { IncomingMessage, MediaKind, QuotedContext } from '@zipzap/core';

/**
 * Traduz a estrutura do Baileys para o formato interno do projeto.
 *
 * Este arquivo é a única fronteira em que o formato do WhatsApp aparece. Tudo o
 * mais — resolvers, comandos, testes de aceite — trabalha sobre
 * `IncomingMessage`.
 */

/**
 * Envelopes que embrulham a mensagem real.
 *
 * Mensagem temporária, visualização única e documento com legenda chegam
 * aninhados. Sem desembrulhar, `getContentType` devolve o envelope e o bot
 * ignora mensagens perfeitamente válidas — inclusive comandos enviados em
 * grupos com mensagens temporárias ligadas, que é um padrão comum.
 */
const ENVELOPES = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const satisfies ReadonlyArray<keyof proto.IMessage>;

const MAX_PROFUNDIDADE = 5;

export function unwrapMessage(
  content: WAMessageContent | null | undefined,
): WAMessageContent | undefined {
  let atual = content ?? undefined;

  for (let i = 0; i < MAX_PROFUNDIDADE && atual !== undefined; i++) {
    const envelope = ENVELOPES.find((nome) => atual?.[nome] != null);
    if (envelope === undefined) return atual;

    const interno = (
      atual[envelope] as { message?: WAMessageContent | null } | null | undefined
    )?.message;
    if (interno == null) return atual;
    atual = interno;
  }

  return atual;
}

const TIPO_PARA_MIDIA: Partial<Record<keyof proto.IMessage, MediaKind>> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
};

export function mediaKindOf(content: WAMessageContent | undefined): MediaKind {
  const tipo = getContentType(content);
  return tipo === undefined ? 'none' : (TIPO_PARA_MIDIA[tipo] ?? 'none');
}

/** Texto da mensagem: corpo, legenda de mídia ou seleção de lista/botão. */
export function extractText(content: WAMessageContent | undefined): string {
  if (content === undefined) return '';

  if (typeof content.conversation === 'string' && content.conversation !== '') {
    return content.conversation;
  }
  if (typeof content.extendedTextMessage?.text === 'string') {
    return content.extendedTextMessage.text;
  }

  const legenda =
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption;
  if (typeof legenda === 'string' && legenda !== '') return legenda;

  // Resposta a botão ou lista: o usuário escolheu uma opção, e para nós isso
  // vale como se ele tivesse digitado o texto correspondente (ADR-05).
  const escolha =
    content.buttonsResponseMessage?.selectedButtonId ??
    content.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content.templateButtonReplyMessage?.selectedId;
  if (typeof escolha === 'string' && escolha !== '') return escolha;

  return '';
}

function contextInfoOf(content: WAMessageContent | undefined): proto.IContextInfo | undefined {
  if (content === undefined) return undefined;
  const tipo = getContentType(content);
  if (tipo === undefined) return undefined;

  const node = content[tipo] as { contextInfo?: proto.IContextInfo | null } | null | undefined;
  return node?.contextInfo ?? undefined;
}

function quotedOf(ctx: proto.IContextInfo | undefined): QuotedContext | undefined {
  if (ctx?.stanzaId == null || ctx.quotedMessage == null) return undefined;

  const citada = unwrapMessage(ctx.quotedMessage);
  const texto = extractText(citada);

  return {
    stanzaId: ctx.stanzaId,
    ...(ctx.participant == null
      ? {}
      : { claimedParticipant: normalizeJid(ctx.participant) ?? ctx.participant }),
    ...(texto === '' ? {} : { text: texto }),
    mediaKind: mediaKindOf(citada),
  };
}

/** Converte o timestamp do Baileys, que vem como número ou Long, para ms. */
function timestampMs(valor: WAMessage['messageTimestamp']): number {
  if (typeof valor === 'number') return valor * 1000;
  if (valor != null && typeof valor === 'object' && 'toNumber' in valor) {
    return (valor as { toNumber: () => number }).toNumber() * 1000;
  }
  return Date.now();
}

/**
 * Normaliza uma mensagem recebida.
 *
 * Devolve `undefined` para o que não é conversa endereçável — status, canal,
 * evento de protocolo, mensagem sem conteúdo. Filtrar aqui, num lugar só, evita
 * que cada resolver precise repetir a verificação.
 */
export function normalizeMessage(msg: WAMessage): IncomingMessage | undefined {
  const chatJid = normalizeJid(msg.key.remoteJid);
  const id = msg.key.id;

  if (chatJid === undefined || typeof id !== 'string' || id === '') return undefined;
  if (!isAddressableChat(chatJid)) return undefined;

  const content = unwrapMessage(msg.message);
  if (content === undefined) return undefined;

  const tipo = getContentType(content);
  // protocolMessage cobre apagar, editar e sincronizar: não é conversa.
  if (
    tipo === undefined ||
    tipo === 'protocolMessage' ||
    tipo === 'senderKeyDistributionMessage'
  ) {
    return undefined;
  }

  const isGroup = isGroupJid(chatJid);

  // Em grupo o remetente é o participante; em conversa direta é o próprio chat.
  const remetente = isGroup
    ? normalizeJid(msg.key.participant ?? msg.key.participantPn)
    : chatJid;
  if (remetente === undefined) return undefined;

  const ctx = contextInfoOf(content);
  const senderLid = normalizeJid(msg.key.senderLid ?? msg.key.participantLid);

  const mencionados = (ctx?.mentionedJid ?? [])
    .map((j) => normalizeJid(j))
    .filter((j): j is string => j !== undefined);

  const quoted = quotedOf(ctx);

  return {
    id,
    chatJid,
    senderJid: remetente,
    ...(senderLid === undefined ? {} : { senderLid }),
    ...(typeof msg.pushName === 'string' && msg.pushName !== ''
      ? { pushName: msg.pushName }
      : {}),
    isGroup,
    fromMe: msg.key.fromMe === true,
    timestamp: timestampMs(msg.messageTimestamp),
    text: extractText(content),
    mediaKind: mediaKindOf(content),
    mentionedJids: mencionados,
    ...(quoted === undefined ? {} : { quoted }),
    raw: msg,
  };
}
