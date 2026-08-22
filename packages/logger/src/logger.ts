import { pino, stdSerializers, type Logger, type LoggerOptions } from 'pino';
import { REDACT_PATHS, REDACTED, redactText } from './redact.js';

export type { Logger };

export interface LoggerConfig {
  readonly level?: string;
  readonly name?: string;
  readonly pretty?: boolean;
  /** Destino alternativo. Usado nos testes para capturar a saída. */
  readonly destination?: NodeJS.WritableStream;
}

/**
 * Logger estruturado do projeto.
 *
 * Duas camadas de proteção, porque nenhuma sozinha basta: `redact` cuida dos
 * campos conhecidos, e o hook de formatação varre a mensagem em busca de segredo
 * que tenha vindo dentro de texto — que é como ele costuma vazar de verdade,
 * pela mensagem de erro de uma biblioteca de terceiro.
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  const options: LoggerOptions = {
    level: config.level ?? 'info',
    ...(config.name === undefined ? {} : { name: config.name }),
    redact: {
      paths: [...REDACT_PATHS],
      censor: REDACTED,
      remove: false,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    hooks: {
      logMethod(args, method) {
        const saneados = args.map((arg) => (typeof arg === 'string' ? redactText(arg) : arg));
        method.apply(this, saneados as Parameters<typeof method>);
      },
    },
    serializers: {
      // Mensagem e stack de erro são a via mais comum de vazamento: bibliotecas
      // de terceiro imprimem URL com credencial e cabeçalho de autorização ali.
      err: (e: unknown) => {
        const base = stdSerializers.err(e as Error);
        return {
          ...base,
          ...(typeof base.message === 'string' ? { message: redactText(base.message) } : {}),
          ...(typeof base.stack === 'string' ? { stack: redactText(base.stack) } : {}),
        };
      },
    },
    base: { pid: process.pid },
  };

  if (config.destination) {
    return pino(options, config.destination);
  }
  return pino(options);
}
