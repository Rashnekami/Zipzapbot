import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { BufferJSON, initAuthCreds } from 'baileys';
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from 'baileys';
import { decryptToString, encrypt, randomToken } from '@zipzap/shared';

/**
 * Estado de autenticação em disco, cifrado.
 *
 * O `useMultiFileAuthState` que vem no Baileys grava as credenciais em JSON
 * puro. Esses arquivos equivalem a acesso total à conta do WhatsApp: quem os
 * copia entra como se fosse o dono, sem QR Code e sem aviso. Num backup, num
 * volume mal configurado ou numa imagem de contêiner publicada por engano, isso
 * é o pior vazamento possível do projeto.
 *
 * Esta versão mantém o mesmo contrato do Baileys e cifra o conteúdo com
 * AES-256-GCM. A chave vem de `ENCRYPTION_KEY` e nunca toca o disco.
 */

/**
 * Nome de arquivo seguro a partir de um identificador do Baileys.
 *
 * Os ids incluem JID e podem conter `/`, `:` e `.`. Trocamos tudo que não for
 * seguro por `_`, e o chamador ainda confere que o caminho final não escapou do
 * diretório — as duas camadas, porque o id vem de dado externo.
 */
export function safeFileName(type: string, id: string): string {
  const limpo = `${type}-${id}`.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Um id composto só de caracteres proibidos não pode virar '.' ou '..'.
  return limpo.replace(/^\.+/, '_') + '.enc';
}

/** Garante que `caminho` está dentro de `base`. Fecha path traversal. */
function assertInside(base: string, caminho: string): string {
  const raiz = resolve(base);
  const alvo = resolve(caminho);
  if (alvo !== raiz && !alvo.startsWith(raiz + sep)) {
    throw new Error('Caminho de sessão fora do diretório permitido.');
  }
  return alvo;
}

export interface EncryptedAuthState {
  readonly state: AuthenticationState;
  /** Persiste as credenciais. O Baileys chama isto no evento `creds.update`. */
  saveCreds: () => Promise<void>;
  /** Apaga a sessão inteira. Usado quando o WhatsApp encerra a sessão. */
  clear: () => Promise<void>;
}

export async function useEncryptedAuthState(
  dir: string,
  key: Buffer,
): Promise<EncryptedAuthState> {
  if (!isAbsolute(dir)) dir = resolve(dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  async function escrever(nome: string, valor: unknown): Promise<void> {
    const destino = assertInside(dir, join(dir, nome));
    const envelope = encrypt(JSON.stringify(valor, BufferJSON.replacer), key);

    // Grava em arquivo temporário e renomeia: `rename` é atômico no mesmo
    // sistema de arquivos, então uma queda no meio da escrita não deixa a
    // credencial corrompida pela metade — o que exigiria novo pareamento.
    const temporario = `${destino}.${randomToken(6)}.tmp`;
    await writeFile(temporario, envelope, { mode: 0o600 });
    await rename(temporario, destino);
  }

  async function ler<T>(nome: string): Promise<T | undefined> {
    try {
      const caminho = assertInside(dir, join(dir, nome));
      const envelope = await readFile(caminho, 'utf8');
      return JSON.parse(decryptToString(envelope, key), BufferJSON.reviver) as T;
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      // Arquivo ilegível (chave trocada, conteúdo adulterado) é tratado como
      // ausente: o Baileys então pede um pareamento novo, que é recuperável.
      // Estourar aqui deixaria o bot em loop de crash sem saída.
      return undefined;
    }
  }

  async function apagar(nome: string): Promise<void> {
    await rm(assertInside(dir, join(dir, nome)), { force: true });
  }

  const creds: AuthenticationCreds =
    (await ler<AuthenticationCreds>('creds.enc')) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const saida: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              const valor = await ler<SignalDataTypeMap[typeof type]>(safeFileName(type, id));
              if (valor !== undefined) saida[id] = valor;
            }),
          );
          return saida;
        },
        set: async (data) => {
          const tarefas: Array<Promise<void>> = [];
          for (const [type, valores] of Object.entries(data)) {
            for (const [id, valor] of Object.entries(valores ?? {})) {
              const nome = safeFileName(type, id);
              tarefas.push(valor === null ? apagar(nome) : escrever(nome, valor));
            }
          }
          await Promise.all(tarefas);
        },
      },
    },

    saveCreds: () => escrever('creds.enc', creds),

    clear: async () => {
      const arquivos = await readdir(dir).catch(() => [] as string[]);
      await Promise.all(arquivos.filter((f) => f.endsWith('.enc')).map((f) => apagar(f)));
    },
  };
}
