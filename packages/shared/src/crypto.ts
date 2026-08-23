import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Cifra simétrica autenticada (AES-256-GCM).
 *
 * Usada para dois grupos de dados: as credenciais da sessão do WhatsApp — que
 * equivalem a acesso total à conta — e os campos sensíveis de memória no banco.
 *
 * Formato do envelope: `v1:<nonce base64>:<tag base64>:<cifrado base64>`.
 * O prefixo de versão existe para permitir rotação de algoritmo depois sem
 * precisar adivinhar o formato de cada valor já gravado.
 */

const VERSION = 'v1';
const NONCE_BYTES = 12; // recomendado para GCM
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class CryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CryptoError';
  }
}

/**
 * Converte a chave de ambiente (hex de 64 caracteres ou base64) em 32 bytes.
 *
 * Aceita as duas formas porque `openssl rand -hex 32` e `openssl rand -base64 32`
 * são igualmente comuns, e errar o formato geraria uma chave silenciosamente
 * errada em vez de um erro.
 */
export function parseKey(raw: string): Buffer {
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `Chave de cifra precisa ter ${KEY_BYTES} bytes; recebi ${key.length}. ` +
        'Gere com: openssl rand -hex 32',
    );
  }
  return key;
}

export function encrypt(plaintext: string | Buffer, key: Buffer): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const dados = Buffer.concat([
    cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    nonce.toString('base64'),
    tag.toString('base64'),
    dados.toString('base64'),
  ].join(':');
}

export function decrypt(envelope: string, key: Buffer): Buffer {
  const partes = envelope.split(':');
  if (partes.length !== 4) {
    throw new CryptoError('Envelope cifrado malformado.');
  }

  const [version, nonceB64 = '', tagB64 = '', dadosB64 = ''] = partes;
  if (version !== VERSION) {
    throw new CryptoError(`Versão de envelope desconhecida: ${String(version)}`);
  }

  const nonce = Buffer.from(nonceB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError('Envelope cifrado com nonce ou tag de tamanho inválido.');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(dadosB64, 'base64')), decipher.final()]);
  } catch (causa) {
    // GCM falha aqui quando o conteúdo foi adulterado ou a chave está errada.
    // Não distinguimos os dois casos de propósito: a mensagem de erro não deve
    // ajudar quem estiver tentando descobrir qual é o problema.
    throw new CryptoError('Falha ao decifrar: conteúdo adulterado ou chave incorreta.', {
      cause: causa,
    });
  }
}

export function decryptToString(envelope: string, key: Buffer): string {
  return decrypt(envelope, key).toString('utf8');
}

/** Verifica se um valor já está no formato de envelope, sem tentar decifrar. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${VERSION}:`) && value.split(':').length === 4;
}

/**
 * Comparação em tempo constante, para segredo curto como token de serviço.
 *
 * `===` em string vaza o tamanho do prefixo em comum pelo tempo de execução.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
