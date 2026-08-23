import type { IncomingMessage } from '../domain/message.js';
import type { SelfIdentity } from '../domain/identity.js';

/**
 * Porta do WhatsApp.
 *
 * Todo uso do Baileys fica atrás desta interface (ADR-01). Com ela, os testes de
 * aceite rodam sem socket, sem rede e sem conta, e a migração para a linha 7.x
 * vira a reescrita de um adaptador com a suíte inteira como rede de proteção.
 */

export type ConnectionState =
  | { readonly status: 'connecting' }
  | { readonly status: 'qr'; readonly qr: string }
  | { readonly status: 'open'; readonly self: SelfIdentity }
  | { readonly status: 'reconnecting'; readonly attempt: number; readonly delayMs: number }
  | { readonly status: 'logged_out'; readonly reason: string }
  | { readonly status: 'closed'; readonly reason: string };

export interface SendTextInput {
  readonly chatJid: string;
  readonly text: string;
  readonly quoteStanzaId?: string;
  readonly mentions?: readonly string[];
}

export type OutgoingMediaType = 'audio' | 'video' | 'image' | 'sticker' | 'document';

export interface SendMediaInput {
  readonly chatJid: string;
  readonly filePath: string;
  readonly mediaType: OutgoingMediaType;
  readonly mimetype: string;
  readonly fileName?: string;
  readonly caption?: string;
  readonly quoteStanzaId?: string;
  readonly track?: {
    readonly title?: string;
    readonly artist?: string;
    readonly durationSeconds?: number;
  };
}

/** Resultado de um envio. `stanzaId` é o que vai para `bot_messages`. */
export interface SendResult {
  readonly stanzaId: string;
  readonly chatJid: string;
  readonly timestamp: number;
}

export interface GroupParticipant {
  readonly jid: string;
  readonly lid?: string;
  readonly isAdmin: boolean;
  readonly isSuperAdmin: boolean;
}

export interface GroupInfo {
  readonly jid: string;
  readonly subject: string;
  readonly participants: readonly GroupParticipant[];
  readonly announceOnly: boolean;
}

export type Unsubscribe = () => void;

export interface WhatsAppGateway {
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  /** Identidade do bot. Indefinida enquanto a conexão não abriu. */
  readonly self: SelfIdentity | undefined;

  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): Unsubscribe;
  onConnectionState(handler: (state: ConnectionState) => void | Promise<void>): Unsubscribe;

  sendText(input: SendTextInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;

  groupInfo(groupJid: string): Promise<GroupInfo>;

  /** Baixa a mídia de uma mensagem recebida para o caminho informado. */
  downloadMedia(msg: IncomingMessage, destinationPath: string): Promise<void>;
}
