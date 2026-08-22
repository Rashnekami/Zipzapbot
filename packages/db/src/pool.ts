import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

const { Pool, types } = pg;

/**
 * `bigint` (OID 20) chega como string por padrão no driver, para não perder
 * precisão acima de 2^53. Mantemos assim de propósito: `max_file_bytes` e
 * `bytes` são tamanhos de arquivo, e arredondamento silencioso em limite de
 * tamanho é exatamente o tipo de bug que só aparece com arquivo grande.
 */
types.setTypeParser(types.builtins.INT8, (v) => v);

export interface PoolConfig {
  readonly connectionString: string;
  readonly max?: number;
  readonly connectionTimeoutMillis?: number;
  readonly idleTimeoutMillis?: number;
}

export function createPool(config: PoolConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10_000,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    allowExitOnIdle: false,
  });
}

export function createDb(pool: pg.Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type Db = Kysely<Database>;
