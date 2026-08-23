/**
 * Manipulação de JID do WhatsApp — sem depender do Baileys.
 *
 * O domínio não importa a biblioteca de propósito (ADR-01): trocar a versão do
 * Baileys não pode mexer na regra que decide o que é menção ao bot. E há um
 * motivo prático somando-se ao arquitetural: essas funções são a parte mais
 * fácil de errar do projeto inteiro, e aqui elas são testáveis sem socket,
 * sem rede e sem conta.
 *
 * Formas que aparecem na prática:
 *   5511999998888@s.whatsapp.net      participante por telefone
 *   5511999998888:12@s.whatsapp.net   o mesmo, com sufixo de dispositivo
 *   184736251937465@lid               participante por LID
 *   120363000000000000@g.us           grupo
 *   status@broadcast                  status
 *   ...@newsletter                    canal
 */

export const SERVER = {
  user: 's.whatsapp.net',
  lid: 'lid',
  group: 'g.us',
  broadcast: 'broadcast',
  newsletter: 'newsletter',
} as const;

export interface ParsedJid {
  /** Parte antes do `@`, já sem o sufixo de dispositivo. */
  readonly user: string;
  /** Número do dispositivo, quando presente. */
  readonly device?: number;
  readonly server: string;
}

/**
 * Divide um JID em partes.
 *
 * Devolve `undefined` para entrada que não é JID, em vez de lançar: JID chega de
 * fora, e um payload estranho não deveria derrubar o processamento da mensagem.
 */
export function parseJid(jid: string | null | undefined): ParsedJid | undefined {
  if (typeof jid !== 'string') return undefined;

  const limpo = jid.trim();
  const arroba = limpo.indexOf('@');
  if (arroba <= 0 || arroba === limpo.length - 1) return undefined;

  const esquerda = limpo.slice(0, arroba);
  const server = limpo.slice(arroba + 1).toLowerCase();

  // O sufixo de dispositivo vem depois de ':' e, em algumas formas, de '_'.
  const doisPontos = esquerda.indexOf(':');
  const user = doisPontos === -1 ? esquerda : esquerda.slice(0, doisPontos);
  if (user === '') return undefined;

  const deviceRaw = doisPontos === -1 ? undefined : esquerda.slice(doisPontos + 1);
  const device =
    deviceRaw !== undefined && /^\d+$/.test(deviceRaw) ? Number(deviceRaw) : undefined;

  return device === undefined ? { user, server } : { user, device, server };
}

/**
 * Forma canônica: sem sufixo de dispositivo, servidor em minúsculas.
 *
 * A mesma pessoa aparece como `...@s.whatsapp.net` numa mensagem e
 * `...:12@s.whatsapp.net` em outra, dependendo do dispositivo que enviou.
 * Comparar sem normalizar faz permissão de administrador falhar de forma
 * intermitente — o tipo de bug que só acontece "às vezes".
 */
export function normalizeJid(jid: string | null | undefined): string | undefined {
  const p = parseJid(jid);
  return p === undefined ? undefined : `${p.user}@${p.server}`;
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return parseJid(jid)?.server === SERVER.group;
}

export function isUserJid(jid: string | null | undefined): boolean {
  return parseJid(jid)?.server === SERVER.user;
}

export function isLidJid(jid: string | null | undefined): boolean {
  return parseJid(jid)?.server === SERVER.lid;
}

export function isBroadcastJid(jid: string | null | undefined): boolean {
  return parseJid(jid)?.server === SERVER.broadcast;
}

export function isNewsletterJid(jid: string | null | undefined): boolean {
  return parseJid(jid)?.server === SERVER.newsletter;
}

/**
 * Chat em que o bot deve operar.
 *
 * Status e canal ficam de fora: não são conversa, e responder a eles é
 * comportamento indesejado garantido.
 */
export function isAddressableChat(jid: string | null | undefined): boolean {
  const p = parseJid(jid);
  if (p === undefined) return false;
  return p.server === SERVER.group || p.server === SERVER.user || p.server === SERVER.lid;
}

/** Mesma pessoa, ignorando dispositivo. Não cruza telefone com LID. */
export function sameUser(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeJid(a);
  const nb = normalizeJid(b);
  return na !== undefined && na === nb;
}

/** Só a parte do número/identificador, útil para exibir e para indexar. */
export function jidUser(jid: string | null | undefined): string | undefined {
  return parseJid(jid)?.user;
}
