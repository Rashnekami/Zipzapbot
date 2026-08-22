#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './pool.js';
import { migrate, migrationStatus } from './migrations/runner.js';

/**
 * CLI de migrations: `zipzap-migrate up | status`.
 *
 * Não há `down`. Rollback automático de schema em produção costuma destruir
 * dados que a migration de subida criou; a correção certa é uma migration nova
 * que desfaz o que precisa ser desfeito, revisada como qualquer outra mudança.
 */
async function main(): Promise<void> {
  const comando = process.argv[2] ?? 'up';
  const url = process.env['DATABASE_URL'];

  if (!url) {
    console.error('DATABASE_URL não definida.');
    process.exitCode = 1;
    return;
  }

  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const dir = process.env['MIGRATIONS_DIR'] ?? resolve(raiz, 'migrations');
  const pool = createPool({ connectionString: url, max: 2 });

  try {
    if (comando === 'status') {
      const status = await migrationStatus(pool, dir);
      if (status.length === 0) {
        console.log('Nenhuma migration encontrada em', dir);
        return;
      }
      for (const s of status) {
        const marca = s.state === 'applied' ? '✓' : s.state === 'pending' ? '·' : '!';
        const quando = s.appliedAt ? ` (${s.appliedAt.toISOString()})` : '';
        console.log(`${marca} ${s.version}_${s.name} — ${s.state}${quando}`);
      }
      if (status.some((s) => s.state === 'checksum_mismatch')) {
        process.exitCode = 1;
      }
      return;
    }

    if (comando === 'up') {
      const { applied, skipped } = await migrate(pool, dir);
      if (applied.length === 0) {
        console.log(`Nada a aplicar. ${skipped.length} migration(s) já no banco.`);
      } else {
        console.log(`Aplicadas: ${applied.join(', ')}`);
      }
      return;
    }

    console.error(`Comando desconhecido: ${comando}. Use "up" ou "status".`);
    process.exitCode = 1;
  } catch (erro) {
    console.error(erro instanceof Error ? erro.message : String(erro));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
