import { describe, expect, it } from 'vitest';
import { DisconnectReason } from 'baileys';
import { backoffDelay, decideReconnect, DEFAULT_BACKOFF } from './reconnect.js';

describe('backoffDelay', () => {
  it('cresce a cada tentativa', () => {
    const semJitter = () => 0.5;
    const esperas = [1, 2, 3, 4].map((n) => backoffDelay(n, DEFAULT_BACKOFF, semJitter));
    for (let i = 1; i < esperas.length; i++) {
      expect(esperas[i]!).toBeGreaterThan(esperas[i - 1]!);
    }
  });

  it('respeita o teto, mesmo com muitas tentativas', () => {
    for (const n of [10, 20, 100]) {
      expect(backoffDelay(n, DEFAULT_BACKOFF, () => 1)).toBeLessThanOrEqual(
        DEFAULT_BACKOFF.maxMs,
      );
    }
  });

  it('aplica jitter: duas instâncias não voltam no mesmo instante', () => {
    const cedo = backoffDelay(5, DEFAULT_BACKOFF, () => 0);
    const tarde = backoffDelay(5, DEFAULT_BACKOFF, () => 1);
    expect(tarde).toBeGreaterThan(cedo);
  });

  it('nunca devolve espera negativa', () => {
    for (let n = 1; n <= 30; n++) {
      expect(backoffDelay(n, DEFAULT_BACKOFF, () => 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('decideReconnect', () => {
  it('sessão encerrada exige novo QR Code, e não reconexão', () => {
    const d = decideReconnect(DisconnectReason.loggedOut, 1);
    expect(d.action).toBe('reset_session');
    expect(d.reason).toMatch(/QR Code/);
  });

  it('credencial inválida recria a sessão', () => {
    expect(decideReconnect(DisconnectReason.badSession, 1).action).toBe('reset_session');
  });

  it('para quando outra instância assume — senão as duas se derrubam em revezamento', () => {
    const d = decideReconnect(DisconnectReason.connectionReplaced, 1);
    expect(d.action).toBe('stop');
    expect(d.reason).toMatch(/outra instância/);
  });

  it('para quando a conta é bloqueada', () => {
    expect(decideReconnect(DisconnectReason.forbidden, 1).action).toBe('stop');
  });

  it('reconecta em queda de rede', () => {
    for (const codigo of [
      DisconnectReason.connectionClosed,
      DisconnectReason.connectionLost,
      DisconnectReason.timedOut,
      DisconnectReason.unavailableService,
      undefined,
    ]) {
      const d = decideReconnect(codigo, 1);
      expect(d.action, `código ${String(codigo)}`).toBe('reconnect');
    }
  });

  it('reconecta imediatamente no reinício pedido após parear', () => {
    const d = decideReconnect(DisconnectReason.restartRequired, 1);
    expect(d.action).toBe('reconnect');
    if (d.action === 'reconnect') expect(d.delayMs).toBe(0);
    expect(d.reason).toMatch(/normal após parear/);
  });

  it('desiste depois do limite de tentativas, em vez de insistir para sempre', () => {
    const config = { ...DEFAULT_BACKOFF, maxAttempts: 3 };
    expect(decideReconnect(undefined, 3, config).action).toBe('reconnect');
    expect(decideReconnect(undefined, 4, config).action).toBe('stop');
  });

  it('o limite de tentativas não sobrepõe a decisão de recriar a sessão', () => {
    const config = { ...DEFAULT_BACKOFF, maxAttempts: 1 };
    expect(decideReconnect(DisconnectReason.loggedOut, 99, config).action).toBe(
      'reset_session',
    );
  });
});
