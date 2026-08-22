import { type z } from 'zod';
import { envSchema, type Env } from './schema.js';

/**
 * Regras que envolvem mais de uma variável.
 *
 * Ficam separadas do schema de campo porque expressam acoplamento: ter URL de
 * gateway sem token é um erro de configuração que só aparece na primeira menção
 * ao bot, ou seja, em produção e na frente do usuário.
 */
const crossFieldChecks = envSchema.superRefine((env, ctx) => {
  if (env.AI_GATEWAY_URL !== undefined && env.AI_GATEWAY_TOKEN === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['AI_GATEWAY_TOKEN'],
      message: 'é obrigatório quando AI_GATEWAY_URL está definida',
    });
  }

  if (env.NODE_ENV === 'production' && env.API_TOKEN === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['API_TOKEN'],
      message: 'é obrigatório em produção: a API expõe o QR Code e ajustes de limite',
    });
  }

  if (env.MAX_JOBS_PER_USER > env.MAX_CONCURRENT_DOWNLOADS) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAX_JOBS_PER_USER'],
      message:
        'não pode ser maior que MAX_CONCURRENT_DOWNLOADS: um único usuário conseguiria ' +
        'ocupar toda a fila do servidor',
    });
  }
});

export class ConfigError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const lista = issues
      .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    super(`Configuração inválida. Corrija as variáveis de ambiente:\n${lista}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Valida o ambiente e devolve a configuração tipada.
 *
 * Lança `ConfigError` com a lista completa de problemas — não o primeiro apenas,
 * porque corrigir um `.env` a um erro por vez é desperdício de tempo de quem
 * está instalando.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = crossFieldChecks.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues);
  }
  return parsed.data;
}
