import { DisconnectReason } from 'baileys';

/**
 * Decisão de reconexão.
 *
 * Separada do socket de propósito: é lógica pura, e é onde estão as escolhas
 * que realmente importam quando o bot cai às três da manhã. Testar isso exige
 * apenas um número, não uma conta do WhatsApp.
 */

export type ReconnectDecision =
  | { readonly action: 'reconnect'; readonly delayMs: number; readonly reason: string }
  | { readonly action: 'reset_session'; readonly reason: string }
  | { readonly action: 'stop'; readonly reason: string };

export interface BackoffConfig {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = {
  baseMs: 2_000,
  maxMs: 60_000,
  maxAttempts: 20,
};

/**
 * Espera antes da próxima tentativa: exponencial com teto e jitter.
 *
 * O jitter não é enfeite. Sem ele, várias instâncias derrubadas pelo mesmo
 * incidente voltam no mesmo instante e derrubam de novo o que acabou de subir.
 */
export function backoffDelay(
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const expoente = Math.min(attempt, 10);
  const bruto = Math.min(config.baseMs * 2 ** (expoente - 1), config.maxMs);
  const jitter = bruto * 0.25 * random();
  return Math.round(Math.min(bruto - bruto * 0.125 + jitter, config.maxMs));
}

/**
 * O que fazer diante de uma desconexão.
 *
 * A distinção central é entre "a sessão acabou" e "a conexão caiu". Reconectar
 * com credencial inválida rende um laço de tentativas que o WhatsApp enxerga
 * como abuso; pedir QR Code a cada queda de rede torna o bot inutilizável.
 */
export function decideReconnect(
  statusCode: number | undefined,
  attempt: number,
  config: BackoffConfig = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): ReconnectDecision {
  // Sessão encerrada pelo usuário ou pelo WhatsApp: só um novo pareamento
  // resolve. Insistir aqui é o caminho mais rápido para um número banido.
  if (statusCode === DisconnectReason.loggedOut) {
    return {
      action: 'reset_session',
      reason: 'sessão encerrada — é preciso ler o QR Code de novo',
    };
  }

  // Credencial corrompida: apagar e parear de novo é a única saída.
  if (statusCode === DisconnectReason.badSession) {
    return { action: 'reset_session', reason: 'credencial inválida — sessão será recriada' };
  }

  // Outra instância assumiu a sessão. Voltar significa as duas se derrubando em
  // revezamento até o WhatsApp encerrar as duas.
  if (statusCode === DisconnectReason.connectionReplaced) {
    return { action: 'stop', reason: 'outra instância assumiu esta sessão' };
  }

  if (statusCode === DisconnectReason.forbidden) {
    return { action: 'stop', reason: 'conta bloqueada pelo WhatsApp' };
  }

  if (statusCode === DisconnectReason.multideviceMismatch) {
    return { action: 'reset_session', reason: 'incompatibilidade de multi-dispositivo' };
  }

  if (attempt > config.maxAttempts) {
    return {
      action: 'stop',
      reason: `desisti após ${config.maxAttempts} tentativas de reconexão`,
    };
  }

  // 515 (restartRequired) é o caso normal logo após o pareamento: o Baileys
  // pede um restart do socket e a conexão sobe em seguida. Não é falha.
  const motivo =
    statusCode === DisconnectReason.restartRequired
      ? 'reinício pedido pelo servidor (normal após parear)'
      : `conexão caiu (código ${statusCode ?? 'desconhecido'})`;

  return {
    action: 'reconnect',
    delayMs:
      statusCode === DisconnectReason.restartRequired
        ? 0
        : backoffDelay(attempt, config, random),
    reason: motivo,
  };
}
