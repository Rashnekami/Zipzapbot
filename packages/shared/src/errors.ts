/**
 * Erros de domínio com código estável.
 *
 * O código é o que atravessa camadas: vira métrica, entra em log estruturado e
 * escolhe a mensagem enviada ao WhatsApp. A mensagem em português fica na borda,
 * junto do envio — aqui não, porque erro de domínio não sabe quem vai lê-lo.
 */
export type AppErrorCode =
  // entrada
  | 'invalid_input'
  | 'unsupported_url'
  | 'blocked_url'
  // autorização
  | 'not_authorized'
  | 'group_only'
  | 'admin_only'
  // limites
  | 'rate_limited'
  | 'quota_exceeded'
  | 'too_large'
  | 'too_long'
  | 'already_running'
  // execução
  | 'external_tool_failed'
  | 'timeout'
  | 'not_found'
  | 'internal';

export interface AppErrorOptions {
  readonly cause?: unknown;
  /** Contexto seguro para log. Não coloque segredo nem conteúdo de mensagem. */
  readonly details?: Readonly<Record<string, unknown>>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details ?? {};
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}

/** Normaliza qualquer coisa capturada em `catch` para um AppError. */
export function toAppError(value: unknown, fallbackCode: AppErrorCode = 'internal'): AppError {
  if (AppError.is(value)) return value;
  if (value instanceof Error) {
    return new AppError(fallbackCode, value.message, { cause: value });
  }
  return new AppError(fallbackCode, String(value));
}
