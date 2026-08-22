import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTestDb, temBanco } from './helpers.js';

/**
 * Divergência entre `schema.ts` e as migrations é silenciosa e cara: o
 * TypeScript continua feliz, o SQL continua válido, e o erro só aparece em
 * tempo de execução, com uma coluna que não existe. Este teste compara as duas
 * definições coluna a coluna.
 */

const fonte = readFileSync(new URL('../../packages/db/src/schema.ts', import.meta.url), 'utf8');

/** Lê o mapa `Database { tabela: TabelaTable }` do arquivo de tipos. */
function mapaDeTabelas(): Map<string, string> {
  const bloco = /export interface Database \{([\s\S]*?)\n\}/.exec(fonte);
  if (!bloco?.[1]) throw new Error('interface Database não encontrada em schema.ts');

  const mapa = new Map<string, string>();
  for (const linha of bloco[1].split('\n')) {
    const m = /^\s*(\w+):\s*(\w+);/.exec(linha);
    if (m?.[1] && m[2]) mapa.set(m[1], m[2]);
  }
  return mapa;
}

/** Lê os campos declarados numa interface de tabela. */
function camposDaInterface(nome: string): string[] {
  const re = new RegExp(`export interface ${nome} \\{([\\s\\S]*?)\\n\\}`);
  const bloco = re.exec(fonte);
  if (!bloco?.[1]) throw new Error(`interface ${nome} não encontrada em schema.ts`);

  const campos: string[] = [];
  for (const linha of bloco[1].split('\n')) {
    const m = /^\s{2}(\w+):/.exec(linha);
    if (m?.[1]) campos.push(m[1]);
  }
  return campos.sort();
}

describe.skipIf(!temBanco)('schema.ts acompanha as migrations', () => {
  it('cada tabela do banco tem interface, e as colunas batem', async () => {
    const t = await createTestDb();
    try {
      const { rows } = await t.pool.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = $1
          ORDER BY table_name, column_name`,
        [t.schema],
      );

      const noBanco = new Map<string, string[]>();
      for (const r of rows) {
        noBanco.set(r.table_name, [...(noBanco.get(r.table_name) ?? []), r.column_name]);
      }

      const mapa = mapaDeTabelas();

      // Nenhuma tabela do banco pode ficar sem tipo.
      const semTipo = [...noBanco.keys()].filter((tabela) => !mapa.has(tabela));
      expect(semTipo, `tabelas sem interface em schema.ts: ${semTipo.join(', ')}`).toEqual([]);

      // Nenhum tipo pode apontar para tabela que não existe.
      const semTabela = [...mapa.keys()].filter((tabela) => !noBanco.has(tabela));
      expect(
        semTabela,
        `interfaces sem tabela correspondente: ${semTabela.join(', ')}`,
      ).toEqual([]);

      // E as colunas precisam bater, uma a uma.
      for (const [tabela, iface] of mapa) {
        const esperado = noBanco.get(tabela)?.sort() ?? [];
        expect(camposDaInterface(iface), `colunas divergentes em "${tabela}"`).toEqual(
          esperado,
        );
      }
    } finally {
      await t.destroy();
    }
  });
});
