import { resolve } from 'node:path';
import { loadEnv, ConfigError } from '@zipzap/config';
import { createLogger } from '@zipzap/logger';
import {
  createDb,
  createPool,
  BotMessageRepository,
  GroupRepository,
  UserRepository,
} from '@zipzap/db';
import { parseKey } from '@zipzap/shared';
import type { ConnectionState, IncomingMessage } from '@zipzap/core';
import { useEncryptedAuthState } from './connection/auth-state.js';
import { BaileysGateway } from './connection/socket.js';
import { QrPresenter } from './connection/qr.js';
import { MessageSender } from './outbound/sender.js';

/**
 * Processo do bot.
 *
 * Unico dono do socket do WhatsApp em todo o sistema. Nenhum worker envia
 * mensagem diretamente: eles publicam na fila `outbound` e este processo
 * consome. Duas conexoes com a mesma credencial derrubam a sessao em ciclo e
 * aumentam o risco de banimento da conta.
 */

async function main(): Promise<void> {
  const env = (() => {
    try {
      return loadEnv();
    } catch (erro) {
      if (erro instanceof ConfigError) {
        process.stderr.write(`${erro.message}\n`);
        process.exit(1);
      }
      throw erro;
    }
  })();

  const logger = createLogger({ level: env.LOG_LEVEL, name: 'bot' });
  // Logger proprio para a biblioteca: ela fala demais e, em nivel info, imprime
  // material criptografico de pareamento.
  const baileysLogger = createLogger({ level: env.BAILEYS_LOG_LEVEL, name: 'baileys' });
  logger.info({ node: process.version, ambiente: env.NODE_ENV }, 'iniciando');

  const pool = createPool({ connectionString: env.DATABASE_URL });
  const db = createDb(pool);

  const groups = new GroupRepository(db);
  const users = new UserRepository(db);
  const botMessages = new BotMessageRepository(db);

  const auth = await useEncryptedAuthState(
    resolve(env.SESSION_DIR),
    parseKey(env.ENCRYPTION_KEY),
  );

  const gateway = new BaileysGateway({
    auth,
    logger,
    baileysLogger,
    deviceName: env.BOT_NAME,
  });
  const sender = new MessageSender(gateway, botMessages, groups, logger);
  const qr = new QrPresenter(logger);

  gateway.onConnectionState((state: ConnectionState) => {
    switch (state.status) {
      case 'qr':
        qr.present(state.qr);
        break;
      case 'open':
        qr.clear();
        logger.info(
          {
            identidades: state.self.all.length,
            temLid: state.self.all.some((j) => j.endsWith('@lid')),
          },
          'conectado ao WhatsApp',
        );
        break;
      case 'logged_out':
        logger.warn(
          { motivo: state.reason },
          'sessao encerrada: sera preciso ler o QR de novo',
        );
        break;
      case 'closed':
        logger.error({ motivo: state.reason }, 'conexao encerrada em definitivo');
        break;
      default:
        break;
    }
  });

  gateway.onMessage(async (msg: IncomingMessage) => {
    // Mensagem do proprio bot volta como evento; ignorar evita laco.
    if (msg.fromMe) return;

    // Registra quem falou, para que permissao e memoria tenham a quem se
    // referir. Isto nao gera resposta nenhuma.
    if (msg.isGroup) {
      await groups.ensure(msg.chatJid);
    }
    await users.upsert({
      jid: msg.senderJid,
      lid: msg.senderLid,
      pushName: msg.pushName,
    });

    // O pipeline de intents chega no M4. Ate la o bot fica em silencio, que e
    // exatamente o comportamento exigido pelo criterio de aceite 1: mensagem
    // comum, sem comando e sem mencao, nao recebe resposta.
    logger.debug(
      { chat: msg.isGroup ? 'grupo' : 'direto', temMidia: msg.mediaKind !== 'none' },
      'mensagem recebida',
    );
  });

  await gateway.connect();

  // `sender` ainda nao tem chamador: o pipeline entra no M4. Referenciar aqui
  // deixa explicito que ele e o unico caminho de saida previsto.
  void sender;

  let encerrando = false;
  const encerrar = (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    logger.info({ sinal }, 'encerrando');

    void (async () => {
      try {
        await gateway.disconnect();
        await db.destroy();
        await pool.end();
      } catch (erro) {
        logger.error({ err: erro }, 'falha ao encerrar');
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGINT', () => encerrar('SIGINT'));
  process.on('SIGTERM', () => encerrar('SIGTERM'));
}

await main();
