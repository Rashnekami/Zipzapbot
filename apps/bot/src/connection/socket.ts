import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from 'baileys';
import type { WAMessage, WASocket } from 'baileys';
import { Boom } from '@hapi/boom';
import { SelfIdentity, normalizeJid } from '@zipzap/core';
import type {
  ConnectionState,
  GroupInfo,
  IncomingMessage,
  SendMediaInput,
  SendResult,
  SendTextInput,
  Unsubscribe,
  WhatsAppGateway,
} from '@zipzap/core';
import { AppError } from '@zipzap/shared';
import type { Logger } from '@zipzap/logger';
import { normalizeMessage } from '../whatsapp/normalize.js';
import { RecentMessages } from './recent-messages.js';
import { decideReconnect, type BackoffConfig } from './reconnect.js';
import type { EncryptedAuthState } from './auth-state.js';

export interface BaileysGatewayOptions {
  readonly auth: EncryptedAuthState;
  readonly logger: Logger;
  /**
   * Logger entregue ao Baileys.
   *
   * Separado do nosso de proposito. Na primeira execucao real, a biblioteca
   * emitiu em nivel info o handshake inteiro, incluindo chave efemera e dados
   * de pareamento do dispositivo. Manter este logger em 'warn' resolve na
   * origem; a redacao em `@zipzap/logger` e a segunda camada.
   */
  readonly baileysLogger?: Logger;
  readonly backoff?: BackoffConfig;
  /** Nome exibido no aparelho pareado, em Aparelhos conectados. */
  readonly deviceName?: string;
}

/**
 * Adaptador do Baileys.
 *
 * Unico lugar do projeto que conhece a biblioteca. Quando a linha 7.x sair de
 * release candidate, e este arquivo que muda, com a suite de aceite inteira
 * como rede de protecao (ADR-01).
 */
export class BaileysGateway implements WhatsAppGateway {
  private socket: WASocket | undefined;
  private identidade: SelfIdentity | undefined;
  private tentativa = 0;
  private encerrando = false;

  private readonly recentes = new RecentMessages();
  private readonly ouvintesMensagem = new Set<(msg: IncomingMessage) => void | Promise<void>>();
  private readonly ouvintesEstado = new Set<(state: ConnectionState) => void | Promise<void>>();

  constructor(private readonly options: BaileysGatewayOptions) {}

  get self(): SelfIdentity | undefined {
    return this.identidade;
  }

  onMessage(handler: (msg: IncomingMessage) => void | Promise<void>): Unsubscribe {
    this.ouvintesMensagem.add(handler);
    return () => this.ouvintesMensagem.delete(handler);
  }

  onConnectionState(handler: (state: ConnectionState) => void | Promise<void>): Unsubscribe {
    this.ouvintesEstado.add(handler);
    return () => this.ouvintesEstado.delete(handler);
  }

  private emitirEstado(state: ConnectionState): void {
    for (const h of this.ouvintesEstado) {
      void Promise.resolve(h(state)).catch((erro: unknown) => {
        this.options.logger.error({ err: erro }, 'ouvinte de estado falhou');
      });
    }
  }

  async connect(): Promise<void> {
    this.encerrando = false;
    await this.abrirSocket();
  }

  private get logBaileys(): Logger {
    return this.options.baileysLogger ?? this.options.logger;
  }

  private async abrirSocket(): Promise<void> {
    const { auth, logger } = this.options;
    const { version } = await fetchLatestBaileysVersion();

    logger.info({ waVersion: version.join('.') }, 'abrindo conexao com o WhatsApp');
    this.emitirEstado({ status: 'connecting' });

    const socket = makeWASocket({
      version,
      auth: {
        creds: auth.state.creds,
        // O cache de chaves de assinatura reduz muito a leitura em disco: sem
        // ele, cada mensagem recebida em grupo grande vira dezenas de leituras.
        keys: makeCacheableSignalKeyStore(auth.state.keys, this.logBaileys),
      },
      browser: Browsers.ubuntu(this.options.deviceName ?? 'Zipzapbot'),
      logger: this.logBaileys,
      // Nao marcamos o bot como online: ele nao e uma pessoa, e ficar online
      // permanentemente e um sinal desnecessario para o WhatsApp.
      markOnlineOnConnect: false,
      // Historico completo nao serve para nada aqui e custa memoria e banda.
      // Historico entra por importacao explicita (Etapa 3), com consentimento.
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: (key) => {
        const chat = key.remoteJid;
        const id = key.id;
        if (typeof chat !== 'string' || typeof id !== 'string')
          return Promise.resolve(undefined);
        return Promise.resolve(this.recentes.get(chat, id)?.message ?? undefined);
      },
    });

    this.socket = socket;

    socket.ev.on('creds.update', () => {
      void auth.saveCreds().catch((erro: unknown) => {
        logger.error({ err: erro }, 'falha ao gravar credenciais');
      });
    });

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (typeof qr === 'string') {
        this.emitirEstado({ status: 'qr', qr });
      }

      if (connection === 'open') {
        this.tentativa = 0;
        this.identidade = SelfIdentity.from({
          id: socket.user?.id,
          lid: socket.user?.lid,
        });
        logger.info({ identidades: this.identidade.all.length }, 'conectado');
        this.emitirEstado({ status: 'open', self: this.identidade });
      }

      if (connection === 'close') {
        void this.tratarQueda(lastDisconnect?.error);
      }
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      // 'append' e sincronizacao de historico, nao mensagem chegando agora.
      if (type !== 'notify') return;

      for (const bruta of messages) {
        this.recentes.remember(bruta);
        const normalizada = normalizeMessage(bruta);
        if (normalizada === undefined) continue;

        for (const h of this.ouvintesMensagem) {
          void Promise.resolve(h(normalizada)).catch((erro: unknown) => {
            logger.error({ err: erro, stanzaId: normalizada.id }, 'handler de mensagem falhou');
          });
        }
      }
    });
  }

  private async tratarQueda(erro: unknown): Promise<void> {
    if (this.encerrando) return;

    const statusCode =
      erro instanceof Boom ? (erro.output?.statusCode as number | undefined) : undefined;

    this.tentativa += 1;
    const decisao = decideReconnect(statusCode, this.tentativa, this.options.backoff);

    if (decisao.action === 'stop') {
      this.options.logger.error({ statusCode, motivo: decisao.reason }, 'conexao encerrada');
      this.emitirEstado({ status: 'closed', reason: decisao.reason });
      return;
    }

    if (decisao.action === 'reset_session') {
      this.options.logger.warn({ statusCode, motivo: decisao.reason }, 'sessao invalida');
      await this.options.auth.clear();
      this.emitirEstado({ status: 'logged_out', reason: decisao.reason });
      return;
    }

    this.options.logger.warn(
      {
        statusCode,
        tentativa: this.tentativa,
        esperaMs: decisao.delayMs,
        motivo: decisao.reason,
      },
      'reconectando',
    );
    this.emitirEstado({
      status: 'reconnecting',
      attempt: this.tentativa,
      delayMs: decisao.delayMs,
    });

    await delay(decisao.delayMs);
    if (this.encerrando) return;

    await this.abrirSocket().catch((falha: unknown) => {
      this.options.logger.error({ err: falha }, 'falha ao reabrir o socket');
      void this.tratarQueda(falha);
    });
  }

  async disconnect(): Promise<void> {
    this.encerrando = true;
    // `end` sem erro fecha sem marcar logout: as credenciais continuam validas
    // e o proximo boot reconecta sem QR Code.
    this.socket?.end(undefined);
    this.socket = undefined;
    await Promise.resolve();
  }

  private exigirSocket(): WASocket {
    if (this.socket === undefined) {
      throw new AppError('internal', 'Socket do WhatsApp nao esta conectado.');
    }
    return this.socket;
  }

  /**
   * Monta a citacao a partir do `stanzaId`.
   *
   * Se a mensagem nao esta mais no cache, enviamos sem citar em vez de falhar:
   * perder a citacao e um detalhe visual, perder a resposta nao e.
   */
  private citacao(
    chatJid: string,
    stanzaId: string | undefined,
  ): { quoted: WAMessage } | object {
    if (stanzaId === undefined) return {};
    const original = this.recentes.get(chatJid, stanzaId);
    return original === undefined ? {} : { quoted: original };
  }

  private resultado(enviada: WAMessage | undefined, chatJid: string): SendResult {
    const stanzaId = enviada?.key.id;
    if (typeof stanzaId !== 'string') {
      throw new AppError('internal', 'WhatsApp nao devolveu o id da mensagem enviada.');
    }
    if (enviada !== undefined) this.recentes.remember(enviada);

    return { stanzaId, chatJid, timestamp: Date.now() };
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const socket = this.exigirSocket();
    const chatJid = normalizeJid(input.chatJid);
    if (chatJid === undefined) {
      throw new AppError('invalid_input', 'JID de destino invalido.');
    }

    const mencoes = (input.mentions ?? [])
      .map((j) => normalizeJid(j))
      .filter((j): j is string => j !== undefined);

    const enviada = await socket.sendMessage(
      chatJid,
      { text: input.text, ...(mencoes.length > 0 ? { mentions: mencoes } : {}) },
      this.citacao(chatJid, input.quoteStanzaId),
    );

    return this.resultado(enviada, chatJid);
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const socket = this.exigirSocket();
    const chatJid = normalizeJid(input.chatJid);
    if (chatJid === undefined) {
      throw new AppError('invalid_input', 'JID de destino invalido.');
    }

    const arquivo = { url: input.filePath };
    const legenda = input.caption === undefined ? {} : { caption: input.caption };

    const conteudo = (() => {
      switch (input.mediaType) {
        case 'audio':
          return {
            audio: arquivo,
            mimetype: input.mimetype,
            ptt: false,
            ...(input.track?.durationSeconds === undefined
              ? {}
              : { seconds: input.track.durationSeconds }),
          };
        case 'video':
          return { video: arquivo, mimetype: input.mimetype, ...legenda };
        case 'image':
          return { image: arquivo, ...legenda };
        case 'sticker':
          return { sticker: arquivo };
        case 'document':
          return {
            document: arquivo,
            mimetype: input.mimetype,
            fileName: input.fileName ?? 'arquivo',
            ...legenda,
          };
      }
    })();

    const enviada = await socket.sendMessage(
      chatJid,
      conteudo,
      this.citacao(chatJid, input.quoteStanzaId),
    );

    return this.resultado(enviada, chatJid);
  }

  async groupInfo(groupJid: string): Promise<GroupInfo> {
    const socket = this.exigirSocket();
    const meta = await socket.groupMetadata(groupJid);

    return {
      jid: normalizeJid(meta.id) ?? meta.id,
      subject: meta.subject,
      announceOnly: meta.announce === true,
      participants: meta.participants.map((p) => {
        const lid = normalizeJid(p.lid);
        return {
          jid: normalizeJid(p.id) ?? p.id,
          ...(lid === undefined ? {} : { lid }),
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        };
      }),
    };
  }

  async downloadMedia(msg: IncomingMessage, destinationPath: string): Promise<void> {
    const bruta = msg.raw as WAMessage;
    const buffer = await downloadMediaMessage(
      bruta,
      'buffer',
      {},
      {
        logger: this.logBaileys,
        reuploadRequest: this.exigirSocket().updateMediaMessage,
      },
    );
    await writeFile(destinationPath, buffer, { mode: 0o600 });
  }
}

export { DisconnectReason };
