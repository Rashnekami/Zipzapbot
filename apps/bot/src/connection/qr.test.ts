import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '@zipzap/logger';
import { QrPresenter } from './qr.js';

function logger() {
  return createLogger({ destination: new Writable({ write: (_c, _e, cb) => cb() }) });
}

describe('QrPresenter', () => {
  it('guarda o QR mais recente', () => {
    const escrever = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const qr = new QrPresenter(logger());

    qr.present('codigo-1');
    expect(qr.current).toBe('codigo-1');

    qr.present('codigo-2');
    expect(qr.current).toBe('codigo-2');

    escrever.mockRestore();
  });

  it('desenha o QR no terminal', () => {
    const escrever = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    new QrPresenter(logger()).present('codigo');

    expect(escrever).toHaveBeenCalled();
    escrever.mockRestore();
  });

  it('nao serve QR vencido: ler um codigo expirado nunca funcionaria', () => {
    const escrever = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    let agora = 1_000;
    const qr = new QrPresenter(logger(), 60_000, () => agora);

    qr.present('codigo');
    agora += 59_000;
    expect(qr.current).toBe('codigo');

    agora += 2_000;
    expect(qr.current).toBeUndefined();

    escrever.mockRestore();
  });

  it('nao tem QR antes do primeiro e depois de limpar', () => {
    const escrever = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const qr = new QrPresenter(logger());

    expect(qr.current).toBeUndefined();
    qr.present('codigo');
    qr.clear();
    expect(qr.current).toBeUndefined();

    escrever.mockRestore();
  });

  it('nao escreve o codigo no log estruturado', () => {
    const linhas: string[] = [];
    const stream = new Writable({
      write(c, _e, cb) {
        linhas.push(String(c));
        cb();
      },
    });
    const escrever = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    new QrPresenter(createLogger({ destination: stream })).present('SEGREDO-DO-QR');

    expect(linhas.join('')).not.toContain('SEGREDO-DO-QR');
    escrever.mockRestore();
  });
});
