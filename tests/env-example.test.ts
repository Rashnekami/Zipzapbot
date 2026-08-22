import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envSchema, loadEnv } from '../packages/config/src/index.js';

/** Parser mínimo de `.env`: só o necessário para conferir o arquivo de exemplo. */
function parseEnv(texto: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const linhaBruta of texto.split('\n')) {
    const linha = linhaBruta.trim();
    if (linha === '' || linha.startsWith('#')) continue;
    const sep = linha.indexOf('=');
    if (sep === -1) continue;
    const chave = linha.slice(0, sep).trim();
    let valor = linha.slice(sep + 1).trim();
    // remove comentário à direita, respeitando aspas
    if (!valor.startsWith('"') && !valor.startsWith("'")) {
      const hash = valor.indexOf('#');
      if (hash !== -1) valor = valor.slice(0, hash).trim();
    }
    out[chave] = valor.replace(/^["']|["']$/g, '');
  }
  return out;
}

const exemplo = parseEnv(readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));

describe('.env.example', () => {
  it('é aceito pelo schema — quem copiar o arquivo consegue subir o projeto', () => {
    expect(() => loadEnv(exemplo)).not.toThrow();
  });

  it('não deixou nenhuma variável do schema fora do arquivo', () => {
    const noSchema = Object.keys(envSchema.shape);
    const noArquivo = new Set(Object.keys(exemplo));
    // Comentadas de propósito: opcionais que dependem de etapa ou de ambiente.
    const opcionaisComentadas = new Set(['AI_GATEWAY_URL', 'AI_GATEWAY_TOKEN', 'API_TOKEN']);

    const faltando = noSchema.filter((k) => !noArquivo.has(k) && !opcionaisComentadas.has(k));
    expect(faltando, `variáveis ausentes de .env.example: ${faltando.join(', ')}`).toEqual([]);
  });

  it('não inventou variável que o schema não conhece', () => {
    const noSchema = new Set(Object.keys(envSchema.shape));
    const sobrando = Object.keys(exemplo).filter((k) => !noSchema.has(k));
    expect(sobrando, `variáveis desconhecidas em .env.example: ${sobrando.join(', ')}`).toEqual(
      [],
    );
  });

  it('não contém segredo de verdade — critério de aceite 17', () => {
    const texto = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    const suspeitos = [
      /\bsk-[A-Za-z0-9]{20,}/,
      /\bgsk_[A-Za-z0-9]{20,}/,
      /\bghp_[A-Za-z0-9]{20,}/,
      /\beyJ[A-Za-z0-9_-]{10,}\./,
    ];
    for (const p of suspeitos) {
      expect(texto, `padrão de segredo encontrado: ${p}`).not.toMatch(p);
    }
    // A chave de exemplo precisa ser obviamente falsa.
    expect(exemplo['ENCRYPTION_KEY']).toMatch(/^0{64}$/);
  });

  it('mantém os limites padrão que o briefing definiu', () => {
    const env = loadEnv(exemplo);
    expect(env.MAX_VIDEO_SECONDS).toBe(1_200);
    expect(env.MAX_FILE_BYTES).toBe(47_185_920);
    expect(env.MAX_CONCURRENT_DOWNLOADS).toBe(2);
    expect(env.MAX_JOBS_PER_USER).toBe(1);
    expect(env.MEDIA_CACHE_TTL_SECONDS).toBe(86_400);
    expect(env.MAX_PLAYLIST_ITEMS).toBe(1);
  });
});
