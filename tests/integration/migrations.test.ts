import { describe, expect, it } from 'vitest';
import {
  checksumOf,
  loadMigrations,
  migrate,
  migrationStatus,
} from '../../packages/db/src/index.js';
import { createTestDb, MIGRATIONS_DIR, temBanco, type TestDb } from './helpers.js';

describe('migrations — arquivos', () => {
  it('todos seguem o padrão NNNN_nome.sql e carregam em ordem', async () => {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    expect(migrations.length).toBeGreaterThan(0);
    const versoes = migrations.map((m) => m.version);
    expect([...versoes].sort()).toEqual(versoes);
    expect(new Set(versoes).size).toBe(versoes.length);
  });

  it('checksum ignora diferença de fim de linha entre sistemas', () => {
    expect(checksumOf('SELECT 1;\nSELECT 2;\n')).toBe(checksumOf('SELECT 1;\r\nSELECT 2;\r\n'));
  });

  it('checksum muda quando o conteúdo muda', () => {
    expect(checksumOf('SELECT 1;')).not.toBe(checksumOf('SELECT 2;'));
  });
});

describe.skipIf(!temBanco)('migrations — aplicação', () => {
  it('aplica tudo, é idempotente e cria as tabelas esperadas', async () => {
    const t: TestDb = await createTestDb();
    try {
      // createTestDb já rodou migrate uma vez; a segunda não deve aplicar nada.
      const segunda = await migrate(t.pool, MIGRATIONS_DIR);
      expect(segunda.applied).toEqual([]);
      expect(segunda.skipped.length).toBeGreaterThan(0);

      const tabelas = await t.pool
        .query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
          [t.schema],
        )
        .then((r) => r.rows.map((x) => x.table_name).sort());

      expect(tabelas).toEqual([
        'audit_log',
        'bot_messages',
        'group_members',
        'group_settings',
        'groups',
        'lyrics_cache',
        'media_cache',
        'media_jobs',
        'schema_migrations',
        'users',
      ]);
    } finally {
      await t.destroy();
    }
  });

  it('recusa aplicar quando uma migration já aplicada foi editada', async () => {
    const t = await createTestDb();
    try {
      await t.pool.query('UPDATE schema_migrations SET checksum = $1', ['adulterado']);

      await expect(migrate(t.pool, MIGRATIONS_DIR)).rejects.toThrow(/foi alterada/);

      const status = await migrationStatus(t.pool, MIGRATIONS_DIR);
      expect(status.every((s) => s.state === 'checksum_mismatch')).toBe(true);
    } finally {
      await t.destroy();
    }
  });

  it('mantém updated_at correto sem a aplicação precisar informá-lo', async () => {
    const t = await createTestDb();
    try {
      await t.pool.query(
        `INSERT INTO groups (id, jid, subject) VALUES ('00000000-0000-7000-8000-000000000001','1@g.us','antes')`,
      );
      const antes = await t.pool.query<{ updated_at: Date }>('SELECT updated_at FROM groups');

      await new Promise((r) => setTimeout(r, 10));
      await t.pool.query(`UPDATE groups SET subject = 'depois'`);

      const depois = await t.pool.query<{ updated_at: Date }>('SELECT updated_at FROM groups');
      expect(depois.rows[0]!.updated_at.getTime()).toBeGreaterThan(
        antes.rows[0]!.updated_at.getTime(),
      );
    } finally {
      await t.destroy();
    }
  });
});
