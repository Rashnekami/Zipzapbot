import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, createPool, migrate, type Db } from '../../packages/db/src/index.js';
import type pg from 'pg';

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];

/** Sem banco de teste configurado, a suíte de integração é pulada em vez de
 *  falhar: quem roda só os testes de unidade não precisa de Postgres. */
export const temBanco = TEST_DATABASE_URL !== undefined;

export const MIGRATIONS_DIR = resolve(
  fileURLToPath(new URL('../../', import.meta.url)),
  'migrations',
);

export interface TestDb {
  readonly db: Db;
  readonly pool: pg.Pool;
  readonly schema: string;
  destroy: () => Promise<void>;
}

/**
 * Banco isolado por arquivo de teste, usando um schema próprio do Postgres.
 *
 * Schema separado em vez de banco separado porque é ordens de grandeza mais
 * rápido de criar e derrubar, e o isolamento é o mesmo para o que testamos
 * aqui. `search_path` é fixado na conexão, então as migrations rodam dentro do
 * schema sem nenhuma alteração no SQL.
 */
export async function createTestDb(): Promise<TestDb> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL não definida');

  const schema = `t_${randomBytes(6).toString('hex')}`;

  const admin = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.end();

  // search_path vai na própria connection string. Um handler de 'connect' que
  // dispara SET seria assíncrono e poderia perder a corrida para a primeira
  // query da conexão — o pg inclusive avisa sobre isso.
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = createPool({ connectionString: url.toString(), max: 4 });

  await migrate(pool, MIGRATIONS_DIR);
  const db = createDb(pool);

  return {
    db,
    pool,
    schema,
    destroy: async () => {
      await db.destroy();
      const limpeza = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
      await limpeza.query(`DROP SCHEMA "${schema}" CASCADE`);
      await limpeza.end();
    },
  };
}
