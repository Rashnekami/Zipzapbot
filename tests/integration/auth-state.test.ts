import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  safeFileName,
  useEncryptedAuthState,
} from '../../apps/bot/src/connection/auth-state.js';

/**
 * Credencial da sessao do WhatsApp equivale a acesso total a conta. Estes
 * testes exercitam o caminho real de disco, porque o que importa aqui e o que
 * fica gravado no arquivo, nao o que a funcao devolve.
 */

let dir: string;
const chave = randomBytes(32);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zzb-auth-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('safeFileName', () => {
  it('neutraliza separador de caminho e travessia de diretorio', () => {
    for (const perigoso of ['../../etc/passwd', 'a/b/c', '..', '../..', './x']) {
      const nome = safeFileName('session', perigoso);
      expect(nome).not.toContain('/');
      expect(nome).not.toContain('\\');
      expect(nome.startsWith('.')).toBe(false);
    }
  });

  it('preserva o suficiente para o arquivo continuar identificavel', () => {
    expect(safeFileName('session', '5511999998888.0')).toBe('session-5511999998888.0.enc');
  });

  it('nao colide entre tipos diferentes com o mesmo id', () => {
    expect(safeFileName('session', 'X')).not.toBe(safeFileName('pre-key', 'X'));
  });
});

describe('useEncryptedAuthState', () => {
  it('cria credenciais novas quando nao ha sessao', async () => {
    const auth = await useEncryptedAuthState(dir, chave);

    expect(auth.state.creds).toBeDefined();
    expect(auth.state.creds.registrationId).toBeTypeOf('number');
    expect(auth.state.creds.registered).toBe(false);
  });

  it('grava as credenciais cifradas, nunca em claro', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    auth.state.creds.advSecretKey = 'SEGREDO-QUE-NAO-PODE-VAZAR';
    await auth.saveCreds();

    const conteudo = await readFile(join(dir, 'creds.enc'), 'utf8');

    expect(conteudo).not.toContain('SEGREDO-QUE-NAO-PODE-VAZAR');
    expect(conteudo).not.toContain('advSecretKey');
    expect(conteudo.startsWith('v1:')).toBe(true);
  });

  it('recarrega a sessao no boot seguinte, sem novo QR Code', async () => {
    const primeiro = await useEncryptedAuthState(dir, chave);
    primeiro.state.creds.advSecretKey = 'chave-de-pareamento';
    primeiro.state.creds.registered = true;
    await primeiro.saveCreds();

    const segundo = await useEncryptedAuthState(dir, chave);

    expect(segundo.state.creds.advSecretKey).toBe('chave-de-pareamento');
    expect(segundo.state.creds.registered).toBe(true);
    expect(segundo.state.creds.registrationId).toBe(primeiro.state.creds.registrationId);
  });

  it('preserva Buffer e Uint8Array das chaves do Signal', async () => {
    const primeiro = await useEncryptedAuthState(dir, chave);
    const publicaOriginal = Buffer.from(primeiro.state.creds.signedIdentityKey.public);
    await primeiro.saveCreds();

    const segundo = await useEncryptedAuthState(dir, chave);
    const recarregada = Buffer.from(segundo.state.creds.signedIdentityKey.public);

    // Se a serializacao de Buffer quebrar, o pareamento falha com erro
    // criptografico obscuro em vez de erro de leitura.
    expect(recarregada.equals(publicaOriginal)).toBe(true);
  });

  it('guarda e devolve chaves de sessao do Signal', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    const sessao = new Uint8Array([1, 2, 3, 4, 5]);

    await auth.state.keys.set({ session: { '5511999998888.0': sessao } });
    const lidas = await auth.state.keys.get('session', ['5511999998888.0']);

    expect(Buffer.from(lidas['5511999998888.0']!)).toEqual(Buffer.from(sessao));
  });

  it('devolve objeto vazio para chave inexistente, sem lancar', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    await expect(auth.state.keys.get('session', ['nao-existe'])).resolves.toEqual({});
  });

  it('apaga a chave quando o valor e nulo', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    await auth.state.keys.set({ session: { alvo: new Uint8Array([9]) } });
    await auth.state.keys.set({ session: { alvo: null } });

    expect(await auth.state.keys.get('session', ['alvo'])).toEqual({});
  });

  it('trata sessao ilegivel como ausente, em vez de entrar em loop de crash', async () => {
    const primeiro = await useEncryptedAuthState(dir, chave);
    await primeiro.saveCreds();

    // Simula chave de cifra trocada: o arquivo existe, mas nao decifra.
    const outraChave = randomBytes(32);
    const segundo = await useEncryptedAuthState(dir, outraChave);

    // Credenciais novas, ou seja, o bot pede QR de novo. Recuperavel.
    expect(segundo.state.creds.registered).toBe(false);
  });

  it('trata arquivo corrompido como ausente', async () => {
    await writeFile(join(dir, 'creds.enc'), 'isto nao e um envelope');
    const auth = await useEncryptedAuthState(dir, chave);
    expect(auth.state.creds.registered).toBe(false);
  });

  it('nao deixa arquivo temporario para tras', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    await auth.saveCreds();
    await auth.state.keys.set({ session: { a: new Uint8Array([1]) } });

    const arquivos = await readdir(dir);
    expect(arquivos.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('grava com permissao restrita ao dono', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    await auth.saveCreds();

    const info = await stat(join(dir, 'creds.enc'));
    // 0o600: so o dono le e escreve.
    expect(info.mode & 0o077).toBe(0);
  });

  it('clear apaga a sessao inteira', async () => {
    const auth = await useEncryptedAuthState(dir, chave);
    await auth.saveCreds();
    await auth.state.keys.set({ session: { a: new Uint8Array([1]), b: new Uint8Array([2]) } });

    await auth.clear();

    expect((await readdir(dir)).filter((f) => f.endsWith('.enc'))).toEqual([]);
  });

  it('id malicioso nao escreve fora do diretorio da sessao', async () => {
    const auth = await useEncryptedAuthState(dir, chave);

    await auth.state.keys.set({
      session: { '../../../fora': new Uint8Array([1]) },
    });

    const arquivos = await readdir(dir);
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]).not.toContain('/');
    // e nada foi criado acima do diretorio
    await expect(stat(join(dir, '..', 'fora'))).rejects.toThrow();
  });
});
