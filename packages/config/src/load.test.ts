import { describe, expect, it } from 'vitest';
import { ConfigError, loadEnv } from './load.js';

const minimo = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/zipzap',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'a'.repeat(64),
} satisfies NodeJS.ProcessEnv;

describe('loadEnv', () => {
  it('aceita o mínimo e aplica os padrões do briefing', () => {
    const env = loadEnv(minimo);
    expect(env.COMMAND_PREFIX).toBe('!');
    expect(env.MAX_VIDEO_SECONDS).toBe(1_200); // 20 minutos
    expect(env.MAX_FILE_BYTES).toBe(47_185_920); // ~45 MB
    expect(env.MAX_CONCURRENT_DOWNLOADS).toBe(2);
    expect(env.MAX_JOBS_PER_USER).toBe(1);
    expect(env.MEDIA_CACHE_TTL_SECONDS).toBe(86_400); // 24 h
    expect(env.AI_MAX_PROVIDERS).toBe(3);
  });

  it('recusa quando falta variável obrigatória', () => {
    expect(() => loadEnv({})).toThrow(ConfigError);
  });

  it('reúne todos os problemas numa mensagem só', () => {
    try {
      loadEnv({ DATABASE_URL: 'nao-e-url', ENCRYPTION_KEY: 'curta' });
      expect.unreachable('deveria ter lançado');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const erro = e as ConfigError;
      const campos = erro.issues.map((i) => i.path.join('.'));
      expect(campos).toContain('DATABASE_URL');
      expect(campos).toContain('REDIS_URL');
      expect(campos).toContain('ENCRYPTION_KEY');
    }
  });

  it('exige chave de cifra de exatamente 32 bytes', () => {
    expect(() => loadEnv({ ...minimo, ENCRYPTION_KEY: 'a'.repeat(62) })).toThrow(ConfigError);
    expect(() => loadEnv({ ...minimo, ENCRYPTION_KEY: 'a'.repeat(64) })).not.toThrow();
    // base64 de 32 bytes também vale
    const base64 = Buffer.alloc(32, 7).toString('base64');
    expect(() => loadEnv({ ...minimo, ENCRYPTION_KEY: base64 })).not.toThrow();
  });

  it('exige token quando há URL de gateway', () => {
    expect(() => loadEnv({ ...minimo, AI_GATEWAY_URL: 'http://gateway:3001' })).toThrow(
      /AI_GATEWAY_TOKEN/,
    );

    expect(() =>
      loadEnv({
        ...minimo,
        AI_GATEWAY_URL: 'http://gateway:3001',
        AI_GATEWAY_TOKEN: 'x'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('exige API_TOKEN em produção, porque a API expõe o QR Code', () => {
    expect(() => loadEnv({ ...minimo, NODE_ENV: 'production' })).toThrow(/API_TOKEN/);
  });

  it('impede que um usuário sozinho ocupe toda a fila', () => {
    expect(() =>
      loadEnv({ ...minimo, MAX_CONCURRENT_DOWNLOADS: '2', MAX_JOBS_PER_USER: '5' }),
    ).toThrow(/MAX_JOBS_PER_USER/);
  });

  it('interpreta lista de donos separada por vírgula', () => {
    const env = loadEnv({ ...minimo, OWNER_JIDS: '55a@s.whatsapp.net, 55b@s.whatsapp.net ,' });
    expect(env.OWNER_JIDS).toEqual(['55a@s.whatsapp.net', '55b@s.whatsapp.net']);
  });

  it('não aceita limite de vídeo fora de faixa', () => {
    expect(() => loadEnv({ ...minimo, MAX_VIDEO_SECONDS: '0' })).toThrow(ConfigError);
    expect(() => loadEnv({ ...minimo, MAX_VIDEO_SECONDS: '99999' })).toThrow(ConfigError);
  });
});
