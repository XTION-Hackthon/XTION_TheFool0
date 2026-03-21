// =============================================================================
// XTION_TheFool0 — InteractionManager & EventLogger 属性测试
// Property 29: 投票计数正确性
// Property 30: 观众互动数据查询
// Property 40: 事件历史查询与过滤
// =============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { InteractionManagerClass } from '../../modules/interaction-manager';
import { EventLoggerClass } from '../../modules/event-logger';
import type { ServerEvent } from '../../types';

// ---------------------------------------------------------------------------
// In-memory DB factory
// ---------------------------------------------------------------------------

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE barrage_messages (
      id TEXT PRIMARY KEY, viewer_id TEXT NOT NULL,
      content TEXT NOT NULL, timestamp INTEGER NOT NULL
    );
    CREATE TABLE broadcast_messages (
      id TEXT PRIMARY KEY, sender_id TEXT NOT NULL,
      content TEXT NOT NULL, timestamp INTEGER NOT NULL
    );
    CREATE TABLE vote_records (
      id TEXT PRIMARY KEY, contestant_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL, type TEXT NOT NULL, timestamp INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, type TEXT NOT NULL,
      contestant_id TEXT, data TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL
    );
  `);
  return db;
}

type TestDb = ReturnType<typeof makeDb>;

function makeInteraction(db: TestDb) {
  const sent: ServerEvent[] = [];
  const broadcastFn = (event: ServerEvent) => { sent.push(event); };
  const mgr = new InteractionManagerClass(db, new Map(), broadcastFn);
  return { mgr, sent };
}

// ---------------------------------------------------------------------------
// Property 29: 投票计数正确性
// ---------------------------------------------------------------------------

describe('Property 29: 投票计数正确性', () => {
  it('点赞后 likes 计数增加 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (numLikes) => {
          const db = makeDb();
          const { mgr } = makeInteraction(db);
          const contestantId = 'contestant-1';

          for (let i = 0; i < numLikes; i++) {
            await mgr.vote(`viewer-${i}`, contestantId, 'like');
          }

          const votes = await mgr.getVotes(contestantId);
          expect(votes.likes).toBe(numLikes);
          expect(votes.dislikes).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('踩后 dislikes 计数增加 1', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (numDislikes) => {
          const db = makeDb();
          const { mgr } = makeInteraction(db);
          const contestantId = 'contestant-2';

          for (let i = 0; i < numDislikes; i++) {
            await mgr.vote(`viewer-${i}`, contestantId, 'dislike');
          }

          const votes = await mgr.getVotes(contestantId);
          expect(votes.dislikes).toBe(numDislikes);
          expect(votes.likes).toBe(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('点赞和踩分别计数，互不影响', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        async (likes, dislikes) => {
          const db = makeDb();
          const { mgr } = makeInteraction(db);
          const contestantId = 'contestant-3';

          for (let i = 0; i < likes; i++) {
            await mgr.vote(`liker-${i}`, contestantId, 'like');
          }
          for (let i = 0; i < dislikes; i++) {
            await mgr.vote(`disliker-${i}`, contestantId, 'dislike');
          }

          const votes = await mgr.getVotes(contestantId);
          expect(votes.likes).toBe(likes);
          expect(votes.dislikes).toBe(dislikes);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('vote.update 事件包含正确的计数', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (numVotes) => {
          const db = makeDb();
          const { mgr, sent } = makeInteraction(db);
          const contestantId = 'contestant-4';

          for (let i = 0; i < numVotes; i++) {
            await mgr.vote(`viewer-${i}`, contestantId, 'like');
          }

          const voteEvents = sent.filter(e => e.type === 'vote.update');
          expect(voteEvents.length).toBe(numVotes);

          // Last event should have correct total
          const lastEvent = voteEvents[voteEvents.length - 1];
          expect((lastEvent.payload as { likes: number }).likes).toBe(numVotes);
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 30: 观众互动数据查询
// ---------------------------------------------------------------------------

describe('Property 30: 观众互动数据查询', () => {
  it('getAudienceFeedback 返回正确的弹幕总数', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.stringOf(
            fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
            { minLength: 1, maxLength: 50 },
          ),
          { minLength: 1, maxLength: 10 },
        ),
        async (messages) => {
          const db = makeDb();
          const { mgr } = makeInteraction(db);

          for (const msg of messages) {
            await mgr.sendBarrage('viewer-1', msg);
          }

          const feedback = await mgr.getAudienceFeedback();
          expect(feedback.barrageCount).toBe(messages.length);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('getAudienceFeedback 针对特定 Contestant 返回正确投票数', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        async (likes, dislikes) => {
          const db = makeDb();
          const { mgr } = makeInteraction(db);
          const contestantId = 'c-target';

          for (let i = 0; i < likes; i++) {
            await mgr.vote(`liker-${i}`, contestantId, 'like');
          }
          for (let i = 0; i < dislikes; i++) {
            await mgr.vote(`disliker-${i}`, contestantId, 'dislike');
          }

          const feedback = await mgr.getAudienceFeedback(contestantId);
          expect(feedback.likeCount).toBe(likes);
          expect(feedback.dislikeCount).toBe(dislikes);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('recentBarrages 最多返回 10 条最新弹幕', async () => {
    const db = makeDb();
    const { mgr } = makeInteraction(db);

    for (let i = 0; i < 15; i++) {
      await mgr.sendBarrage('viewer-1', `message ${i}`);
    }

    const feedback = await mgr.getAudienceFeedback();
    expect(feedback.recentBarrages.length).toBeLessThanOrEqual(10);
    expect(feedback.barrageCount).toBe(15);
  });

  it('弹幕广播给所有在线 Contestant', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringOf(
          fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
          { minLength: 1, maxLength: 50 },
        ),
        async (content) => {
          const db = makeDb();
          const { mgr, sent } = makeInteraction(db);

          await mgr.sendBarrage('viewer-1', content);

          const barrageEvents = sent.filter(e => e.type === 'barrage');
          expect(barrageEvents.length).toBe(1);
          expect((barrageEvents[0].payload as { content: string }).content).toBe(content);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 40: 事件历史查询与过滤
// ---------------------------------------------------------------------------

describe('Property 40: 事件历史查询与过滤', () => {
  it('查询返回的事件匹配类型过滤条件', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (onlineCount, moveCount) => {
          const db = makeDb();
          const logger = new EventLoggerClass(db);

          for (let i = 0; i < onlineCount; i++) {
            await logger.log({ type: 'contestant.online', data: { id: `c-${i}` } });
          }
          for (let i = 0; i < moveCount; i++) {
            await logger.log({ type: 'contestant.move', data: { id: `c-${i}` } });
          }

          const onlineResult = await logger.query({ type: 'contestant.online' });
          expect(onlineResult.events.length).toBe(onlineCount);
          expect(onlineResult.total).toBe(onlineCount);
          for (const e of onlineResult.events) {
            expect(e.type).toBe('contestant.online');
          }

          const moveResult = await logger.query({ type: 'contestant.move' });
          expect(moveResult.events.length).toBe(moveCount);
          for (const e of moveResult.events) {
            expect(e.type).toBe('contestant.move');
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('分页正确返回对应数量的事件', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 1, max: 5 }),
        async (total, pageSize) => {
          const db = makeDb();
          const logger = new EventLoggerClass(db);

          for (let i = 0; i < total; i++) {
            await logger.log({ type: 'system', data: { index: i } });
          }

          const page1 = await logger.query({ page: 1, pageSize });
          expect(page1.total).toBe(total);
          expect(page1.events.length).toBe(Math.min(pageSize, total));
        },
      ),
      { numRuns: 30 },
    );
  });

  it('按 contestantId 过滤只返回该 Contestant 的事件', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 5 }),
        async (c1Count, c2Count) => {
          const db = makeDb();
          const logger = new EventLoggerClass(db);

          for (let i = 0; i < c1Count; i++) {
            await logger.log({ type: 'contestant.move', contestantId: 'c1', data: {} });
          }
          for (let i = 0; i < c2Count; i++) {
            await logger.log({ type: 'contestant.move', contestantId: 'c2', data: {} });
          }

          const result = await logger.query({ contestantId: 'c1' });
          expect(result.total).toBe(c1Count);
          for (const e of result.events) {
            expect(e.contestantId).toBe('c1');
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
