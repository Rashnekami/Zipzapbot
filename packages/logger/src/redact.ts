/**
 * Redação de segredo e de dado pessoal no log.
 *
 * Critério de aceite 17: nenhuma credencial pode aparecer em log. Só listar
 * caminhos de campo não basta — segredo vaza dentro de string livre, em URL de
 * erro, em mensagem de biblioteca de terceiro. Por isso há duas camadas: os
 * caminhos conhecidos (`REDACT_PATHS`, tratados pelo pino) e uma varredura por
 * padrão no texto (`redactText`).
 */

export const REDACTED = '[redigido]';

/** Campos cujo valor nunca deve ser impresso, em qualquer profundidade. */
export const REDACT_PATHS: readonly string[] = [
  'password',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'credentials',
  'creds',
  'encryptionKey',
  'ENCRYPTION_KEY',
  'AI_GATEWAY_TOKEN',
  'API_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-service-token"]',
  'headers.authorization',
  'headers.cookie',
  'headers["x-service-token"]',
  'err.config.headers.authorization',
];

/**
 * Padrões de segredo em texto livre.
 *
 * A ordem importa: o mais específico primeiro, para que um `Bearer sk-...` seja
 * capturado inteiro pelo padrão de cabeçalho e não deixe resto.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // cabeçalho de autorização
  /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // credencial embutida em URL: postgres://user:senha@host
  /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+):([^\s@/]+)@/gi,
  // chaves com prefixo conhecido de provedor
  /\b(sk|pk|rk|gsk|xai|api)[-_][A-Za-z0-9_-]{16,}/gi,
  // JWT
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // pares chave=valor em texto
  /\b(token|secret|password|senha|api[_-]?key)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;}]+)/gi,
];

/** Remove segredo reconhecível de uma string livre. */
export function redactText(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, ...groups) => {
      // credencial em URL: preserva o esquema e o usuário, esconde a senha
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(match) && typeof groups[0] === 'string') {
        return `${groups[0]}:${REDACTED}@`;
      }
      // par chave=valor: preserva a chave
      if (/[=:]/.test(match) && typeof groups[0] === 'string' && !/^\w+\s/.test(match)) {
        return `${groups[0]}=${REDACTED}`;
      }
      return REDACTED;
    });
  }
  return out;
}

/**
 * Mascara um JID preservando o que serve para depurar.
 *
 * Mantemos os quatro primeiros dígitos (país e DDD) e os dois últimos, o
 * suficiente para distinguir participantes num log sem registrar o telefone de
 * ninguém por extenso.
 */
export function maskJid(jid: string): string {
  const [user = '', domain] = jid.split('@');
  const [numero = ''] = user.split(':');
  if (numero.length <= 6) return domain ? `${'*'.repeat(numero.length)}@${domain}` : '***';
  const inicio = numero.slice(0, 4);
  const fim = numero.slice(-2);
  const meio = '*'.repeat(Math.max(numero.length - 6, 1));
  return domain ? `${inicio}${meio}${fim}@${domain}` : `${inicio}${meio}${fim}`;
}

/** Percorre um objeto aplicando `redactText` em toda string. */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => redactDeep(v, depth + 1)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
