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

describe('material de pareamento do WhatsApp', () => {
  // O payload abaixo e o que o logger interno do Baileys emitiu, em nivel info,
  // na primeira conexao real do bot. Nenhum destes campos tem nome que sugira
  // segredo, entao a lista generica de nomes nao os pegava.
  it('nao imprime chave efemera nem dados de pareamento do dispositivo', () => {
    const { stream, linhas } = captura();
    const log = createLogger({ destination: stream, level: 'info' });

    log.info(
      {
        helloMsg: {
          clientHello: { ephemeral: 'FJ+b95Rs+bR0S6xmPPLHM9AATjLJdsD9sH7U4qC8+BE=' },
        },
        node: {
          devicePairingData: {
            eIdent: 'uUeHH/3P7WDZpbzMoNJbVL28a9jwMS809LmmBCPs430=',
            eSkeyVal: 'w7TQEvSx7NbdmPAnW1EAuwY4uzOmBhkZQT6pyL5MdAg=',
            eSkeySig: 'nVinUg3W60tycwdEf2O/5Tp+MUnwS/FOnc7H9BUYOleBiVBhLJYQ',
          },
        },
      },
      'connected to WA',
    );

    const texto = JSON.stringify(linhas());
    for (const segredo of [
      'FJ+b95Rs+bR0S6xmPPLHM9AATjLJdsD9sH7U4qC8+BE=',
      'uUeHH/3P7WDZpbzMoNJbVL28a9jwMS809LmmBCPs430=',
      'w7TQEvSx7NbdmPAnW1EAuwY4uzOmBhkZQT6pyL5MdAg=',
      'nVinUg3W60tycwdEf2O/5Tp+MUnwS/FOnc7H9BUYOleBiVBhLJYQ',
    ]) {
      expect(texto, `vazou: ${segredo.slice(0, 16)}...`).not.toContain(segredo);
    }
  });

  it('nao imprime a chave secreta de pareamento das credenciais', () => {
    const { stream, linhas } = captura();
    const log = createLogger({ destination: stream });

    log.info({ creds: { advSecretKey: 'CHAVE-DE-PAREAMENTO-REAL' } }, 'creds.update');

    expect(JSON.stringify(linhas())).not.toContain('CHAVE-DE-PAREAMENTO-REAL');
  });
});
