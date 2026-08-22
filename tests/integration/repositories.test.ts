import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditRepository,
  BotMessageRepository,
  GroupRepository,
  MediaJobRepository,
  UserRepository,
} from '../../packages/db/src/index.js';
import { createTestDb, temBanco, type TestDb } from './helpers.js';

describe.skipIf(!temBanco)('repositórios', () => {
  let t: TestDb;
  let grupos: GroupRepository;
  let usuarios: UserRepository;
  let mensagens: BotMessageRepository;
  let jobs: MediaJobRepository;
  let auditoria: AuditRepository;

  beforeAll(async () => {
    t = await createTestDb();
    grupos = new GroupRepository(t.db);
    usuarios = new UserRepository(t.db);
    mensagens = new BotMessageRepository(t.db);
    jobs = new MediaJobRepository(t.db);
    auditoria = new AuditRepository(t.db);
  });

  afterAll(async () => {
    await t?.destroy();
  });

  describe('GroupRepository', () => {
    it('cria o grupo junto da configuração padrão, numa transação só', async () => {
      const g = await grupos.ensure('120@g.us', 'Grupo de teste');
      const cfg = await grupos.settings(g.id);

      expect(cfg).toBeDefined();
      expect(cfg?.prefix).toBe('!');
      expect(cfg?.max_video_seconds).toBe(1200);
      // bigint chega como string de propósito, para não perder precisão
      expect(cfg?.max_file_bytes).toBe('47185920');
    });

    it('é idempotente: chamar de novo não duplica nem apaga o assunto', async () => {
      const a = await grupos.ensure('121@g.us', 'Original');
      const b = await grupos.ensure('121@g.us');

      expect(b.id).toBe(a.id);
      expect(b.subject).toBe('Original');
    });

    it('atualiza a configuração aceitando objeto em features', async () => {
      const g = await grupos.ensure('122@g.us');
      const cfg = await grupos.updateSettings(g.id, {
        prefix: '/',
        maxFileBytes: 10_000_000,
        features: { antilink: true, welcome: false },
      });

      expect(cfg.prefix).toBe('/');
      expect(cfg.max_file_bytes).toBe('10000000');
      expect(cfg.features).toEqual({ antilink: true, welcome: false });
    });

    it('recusa configuração fora de faixa no próprio banco', async () => {
      const g = await grupos.ensure('123@g.us');
      await expect(grupos.updateSettings(g.id, { maxVideoSeconds: 0 })).rejects.toThrow();
    });
  });

  describe('UserRepository', () => {
    it('não apaga o LID já conhecido quando o evento novo não traz LID', async () => {
      await usuarios.upsert({ jid: '55a@s.whatsapp.net', lid: '999@lid', pushName: 'Ana' });
      const depois = await usuarios.upsert({ jid: '55a@s.whatsapp.net' });

      expect(depois.lid).toBe('999@lid');
      expect(depois.push_name).toBe('Ana');
    });

    it('encontra o participante tanto por JID quanto por LID', async () => {
      await usuarios.upsert({ jid: '55b@s.whatsapp.net', lid: '888@lid' });

      const porJid = await usuarios.findByAnyId('55b@s.whatsapp.net');
      const porLid = await usuarios.findByAnyId('888@lid');

      expect(porJid?.id).toBe(porLid?.id);
    });

    it('registra e atualiza o papel no grupo', async () => {
      const g = await grupos.ensure('124@g.us');
      const u = await usuarios.upsert({ jid: '55c@s.whatsapp.net' });

      await usuarios.setMembership(g.id, u.id, 'member');
      expect(await usuarios.roleIn(g.id, u.id)).toBe('member');

      await usuarios.setMembership(g.id, u.id, 'admin');
      expect(await usuarios.roleIn(g.id, u.id)).toBe('admin');
    });

    it('recusa papel que não existe', async () => {
      const g = await grupos.ensure('125@g.us');
      const u = await usuarios.upsert({ jid: '55d@s.whatsapp.net' });
      await expect(
        // @ts-expect-error papel inválido é barrado pelo tipo e pelo CHECK
        usuarios.setMembership(g.id, u.id, 'dono_supremo'),
      ).rejects.toThrow();
    });
  });

  describe('BotMessageRepository — base do critério de aceite 3', () => {
    it('encontra a mensagem que nós enviamos', async () => {
      const g = await grupos.ensure('130@g.us');
      await mensagens.record({
        chatJid: '130@g.us',
        stanzaId: 'STANZA-1',
        kind: 'command_reply',
        groupId: g.id,
        preview: 'menu de download',
      });

      const achada = await mensagens.find('130@g.us', 'STANZA-1');
      expect(achada?.preview).toBe('menu de download');
      expect(achada?.kind).toBe('command_reply');
    });

    it('não encontra mensagem de outro chat com o mesmo stanza id', async () => {
      await mensagens.record({ chatJid: '131@g.us', stanzaId: 'IGUAL', kind: 'system' });
      expect(await mensagens.find('132@g.us', 'IGUAL')).toBeUndefined();
    });

    it('devolve undefined para stanza que não é nossa — o pipeline então ignora', async () => {
      expect(await mensagens.find('130@g.us', 'STANZA-QUE-NAO-EXISTE')).toBeUndefined();
    });

    it('corta o preview em 500 caracteres', async () => {
      await mensagens.record({
        chatJid: '133@g.us',
        stanzaId: 'LONGA',
        kind: 'ai_reply',
        preview: 'x'.repeat(2000),
      });
      const achada = await mensagens.find('133@g.us', 'LONGA');
      expect(achada?.preview).toHaveLength(500);
    });

    it('regravar a mesma mensagem não estoura — retry de fila é idempotente', async () => {
      const args = { chatJid: '134@g.us', stanzaId: 'REPETIDA', kind: 'media' as const };
      const primeira = await mensagens.record({ ...args, preview: 'a' });
      const segunda = await mensagens.record({ ...args, preview: 'b' });

      expect(segunda.id).toBe(primeira.id);
      expect(segunda.preview).toBe('b');
    });

    it('purga registros fora da janela de retenção', async () => {
      await mensagens.record({ chatJid: '135@g.us', stanzaId: 'VELHA', kind: 'system' });
      await t.pool.query(`UPDATE bot_messages SET sent_at = now() - interval '40 days'
                          WHERE stanza_id = 'VELHA'`);

      const removidas = await mensagens.purgeOlderThan(30);
      expect(removidas).toBeGreaterThanOrEqual(1);
      expect(await mensagens.find('135@g.us', 'VELHA')).toBeUndefined();
      // as recentes continuam lá
      expect(await mensagens.find('130@g.us', 'STANZA-1')).toBeDefined();
    });
  });

  describe('MediaJobRepository — limite de um job por usuário', () => {
    it('conta apenas jobs em andamento', async () => {
      const u = await usuarios.upsert({ jid: '55e@s.whatsapp.net' });

      const j1 = await jobs.create({ kind: 'yt_mp3', userId: u.id });
      expect(await jobs.activeCountForUser(u.id)).toBe(1);

      await jobs.markRunning(j1.id);
      expect(await jobs.activeCountForUser(u.id)).toBe(1);

      await jobs.finish(j1.id, { status: 'done', bytes: 1234, durationSeconds: 42 });
      expect(await jobs.activeCountForUser(u.id)).toBe(0);
    });

    it('libera job preso quando o worker morre no meio', async () => {
      const u = await usuarios.upsert({ jid: '55f@s.whatsapp.net' });
      const j = await jobs.create({ kind: 'yt_mp4', userId: u.id });
      await jobs.markRunning(j.id);

      await t.pool.query(
        `UPDATE media_jobs SET created_at = now() - interval '2 hours'
                          WHERE id = $1`,
        [j.id],
      );

      const liberados = await jobs.reapStale(60 * 60 * 1000);
      expect(liberados).toBeGreaterThanOrEqual(1);
      expect(await jobs.activeCountForUser(u.id)).toBe(0);
    });

    it('conta o uso do grupo no dia, para a cota diária', async () => {
      const g = await grupos.ensure('140@g.us');
      await jobs.create({ kind: 'sticker', groupId: g.id });
      await jobs.create({ kind: 'to_audio', groupId: g.id });

      const hoje = new Date(Date.now() - 86_400_000);
      expect(await jobs.countForGroupSince(g.id, hoje)).toBe(2);
    });

    it('não aceita tipo de job desconhecido', async () => {
      await expect(
        // @ts-expect-error tipo inválido é barrado pelo tipo e pelo CHECK
        jobs.create({ kind: 'minerar_bitcoin' }),
      ).rejects.toThrow();
    });
  });

  describe('AuditRepository — critério de aceite 19', () => {
    it('registra ação administrativa com quem, o quê e sobre quem', async () => {
      const g = await grupos.ensure('150@g.us');

      await auditoria.record({
        actorJid: 'admin@s.whatsapp.net',
        action: 'settings.update',
        groupId: g.id,
        target: 'prefix',
        payload: { de: '!', para: '/' },
      });

      const [entrada] = await auditoria.recentForGroup(g.id);
      expect(entrada?.actor_jid).toBe('admin@s.whatsapp.net');
      expect(entrada?.action).toBe('settings.update');
      expect(entrada?.payload).toEqual({ de: '!', para: '/' });
    });

    it('registra também a tentativa recusada', async () => {
      const g = await grupos.ensure('151@g.us');
      await auditoria.record({
        actorJid: 'qualquer@s.whatsapp.net',
        action: 'memory.wipe.denied',
        groupId: g.id,
        payload: { motivo: 'not_authorized' },
      });

      const entradas = await auditoria.recentForGroup(g.id);
      expect(entradas.map((e) => e.action)).toContain('memory.wipe.denied');
    });
  });
});
