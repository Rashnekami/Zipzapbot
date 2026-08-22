import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

function captura(): { stream: Writable; linhas: () => Array<Record<string, unknown>> } {
  const buffer: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      buffer.push(String(chunk));
      cb();
    },
  });
  return {
    stream,
    linhas: (): Array<Record<string, unknown>> =>
      buffer
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe('createLogger — critério de aceite 17', () => {
  it('redige campo de segredo por caminho conhecido', () => {
    const { stream, linhas } = captura();
    const log = createLogger({ destination: stream, level: 'info' });

    log.info({ token: 'valor-super-secreto', etapa: 'boot' }, 'iniciando');

    const [linha] = linhas();
    expect(linha?.['token']).toBe('[redigido]');
    expect(linha?.['etapa']).toBe('boot');
  });

  it('redige segredo que veio dentro da mensagem', () => {
    const { stream, linhas } = captura();
    const log = createLogger({ destination: stream });

    log.error('falha ao chamar provedor: Authorization: Bearer sk-abcdefghijklmnopqrstu');

    const texto = JSON.stringify(linhas());
    expect(texto).not.toContain('sk-abcdefghijklmnopqrstu');
    expect(texto).toContain('[redigido]');
  });

  it('redige URL de banco com senha', () => {
    const { stream, linhas } = captura();
    const log = createLogger({ destination: stream });

    log.warn({ DATABASE_URL: 'postgres://u:senhaSecreta@db/zipzap' }, 'reconectando');

    const texto = JSON.stringify(linhas());
    expect(texto).not.toContain('senhaSecreta');
  });

  it('mantém o log utilizável: nível, mensagem e contexto sobrevivem', () => {
    const { stream, linhas } = captura();
    const log = createLogger({ destination: stream, name: 'bot' });

    log.info({ jobId: 'abc', fila: 'media' }, 'job concluído');

    const [linha] = linhas();
    expect(linha?.['level']).toBe('info');
    expect(linha?.['msg']).toBe('job concluído');
    expect(linha?.['jobId']).toBe('abc');
    expect(linha?.['name']).toBe('bot');
  });
});
