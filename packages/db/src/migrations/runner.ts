import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Pool } from 'pg';

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
}

export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
  readonly appliedAt: Date;
}

export interface MigrationStatus {
  readonly version: string;
  readonly name: string;
  readonly state: 'applied' | 'pending' | 'checksum_mismatch';
  readonly appliedAt?: Date;
}

/**
 * Chave do advisory lock do Postgres.
 *
 * Sem ele, duas réplicas subindo ao mesmo tempo tentam aplicar a mesma migration
 * em paralelo. Uma delas falha com erro de objeto duplicado e o contêiner entra
 * em loop de restart — modo de falha desagradável de diagnosticar, porque o
 * sintoma aparece longe da causa.
 */
const LOCK_KEY = 8_273_611_004;

const MIGRATION_RE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function checksumOf(sql: string): string {
  // Normaliza fim de linha para que o checksum não mude só por causa do
  // sistema operacional de quem fez o checkout.
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir);
  const arquivos = entries.filter((f) => MIGRATION_RE.test(f)).sort();

  const invalidos = entries.filter((f) => f.endsWith('.sql') && !MIGRATION_RE.test(f));
  if (invalidos.length > 0) {
    throw new Error(
      `Migration com nome fora do padrão NNNN_nome_em_snake_case.sql: ${invalidos.join(', ')}`,
    );
  }

  const migrations: MigrationFile[] = [];
  const vistos = new Set<string>();

  for (const arquivo of arquivos) {
    const match = MIGRATION_RE.exec(arquivo);
    if (!match) continue;
    const [, version = '', name = ''] = match;

    if (vistos.has(version)) {
      throw new Error(`Duas migrations com o número ${version}. Renumere antes de aplicar.`);
    }
    vistos.add(version);

    const path = join(dir, arquivo);
    const sql = await readFile(path, 'utf8');
    migrations.push({ version, name, path, sql, checksum: checksumOf(sql) });
  }

  return migrations;
}

async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function listApplied(pool: Pool): Promise<Map<string, AppliedMigration>> {
  const { rows } = await pool.query<{ version: string; checksum: string; applied_at: Date }>(
    'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version',
  );
  return new Map(
    rows.map((r) => [
      r.version,
      { version: r.version, checksum: r.checksum, appliedAt: r.applied_at },
    ]),
  );
}

export async function migrationStatus(pool: Pool, dir: string): Promise<MigrationStatus[]> {
  await ensureTable(pool);
  const [arquivos, aplicadas] = await Promise.all([loadMigrations(dir), listApplied(pool)]);

  return arquivos.map((m) => {
    const aplicada = aplicadas.get(m.version);
    if (!aplicada) return { version: m.version, name: m.name, state: 'pending' as const };
    if (aplicada.checksum !== m.checksum) {
      return {
        version: m.version,
        name: m.name,
        state: 'checksum_mismatch' as const,
        appliedAt: aplicada.appliedAt,
      };
    }
    return {
      version: m.version,
      name: m.name,
      state: 'applied' as const,
      appliedAt: aplicada.appliedAt,
    };
  });
}

export interface MigrateResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Aplica as migrations pendentes, em ordem, cada uma em sua transação.
 *
 * Recusa a rodar se uma migration já aplicada teve o arquivo alterado: o banco
 * de produção não tem como saber o que mudou, e aplicar "de novo" um arquivo
 * editado é como bancos de dados ficam divergentes entre ambientes sem ninguém
 * perceber.
 */
export async function migrate(pool: Pool, dir: string): Promise<MigrateResult> {
  await ensureTable(pool);

  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    const arquivos = await loadMigrations(dir);
    const aplicadas = await listApplied(pool);

    const alteradas = arquivos.filter((m) => {
      const a = aplicadas.get(m.version);
      return a !== undefined && a.checksum !== m.checksum;
    });
    if (alteradas.length > 0) {
      throw new Error(
        'Migration já aplicada foi alterada: ' +
          alteradas.map((m) => `${m.version}_${m.name}.sql`).join(', ') +
          '. Crie uma migration nova em vez de editar a antiga.',
      );
    }

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const m of arquivos) {
      if (aplicadas.has(m.version)) {
        skipped.push(m.version);
        continue;
      }

      await cliente.query('BEGIN');
      try {
        await cliente.query(m.sql);
        await cliente.query(
          'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
          [m.version, m.checksum],
        );
        await cliente.query('COMMIT');
        applied.push(m.version);
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw new Error(
          `Falha na migration ${m.version}_${m.name}.sql: ${
            erro instanceof Error ? erro.message : String(erro)
          }`,
          { cause: erro },
        );
      }
    }

    return { applied, skipped };
  } finally {
    await cliente.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    cliente.release();
  }
}

export function migrationsDirFromRoot(root: string): string {
  return join(root, 'migrations');
}

export function describeMigration(m: MigrationFile): string {
  return `${m.version}_${m.name} (${basename(m.path)})`;
}
