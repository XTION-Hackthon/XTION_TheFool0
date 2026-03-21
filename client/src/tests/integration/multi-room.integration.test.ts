// =============================================================================
// XTION_TheFool0 — 前端多房间集成测试
// Feature: multi-room-collision-system
// Requirements: 1, 2, 3, 4, 5
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';

// Import stores directly — test store logic without rendering components
// This avoids Phaser dependency issues in jsdom environment
import { useRoomStore } from '../../stores/roomStore';
import { useCollisionStore } from '../../stores/collisionStore';
import type { Bot, Wall } from '../../stores/roomStore';

// =============================================================================
// Helpers
// =============================================================================

function resetStores() {
  useRoomStore.setState({ rooms: {}, currentRoomId: null });
  useCollisionStore.setState({ collisions: [], spatialGrids: {} });
}

function makeBot(id: string, x: number, y: number): Bot {
  return { id, name: `Bot-${id}`, position: { x, y }, collisionBox: { width: 32, height: 32 } };
}

function makeWall(id: string, roomId: string, x: number, y: number, w = 64, h = 32): Wall {
  return { id, roomId, x, y, width: w, height: h, rotation: 0 };
}

// =============================================================================
// Tests
// =============================================================================

describe('前端多房间集成测试', () => {
  beforeEach(() => {
    resetStores();
  });

  // -------------------------------------------------------------------------
  // Requirement 1 & 2: 房间列表显示
  // -------------------------------------------------------------------------

  describe('需求1&2: 房间列表显示', () => {
    it('初始状态下房间列表为空', () => {
      const { rooms } = useRoomStore.getState();
      expect(Object.keys(rooms)).toHaveLength(0);
    });

    it('创建主大厅后房间列表包含该房间', () => {
      const { createRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Main Hall', type: 'MainHall' });

      const { rooms } = useRoomStore.getState();
      expect(rooms[id]).toBeDefined();
      expect(rooms[id].name).toBe('Main Hall');
      expect(rooms[id].type).toBe('MainHall');
    });

    it('创建私聊房间默认容量为2', () => {
      const { createRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Private', type: 'PrivateRoom' });

      const { rooms } = useRoomStore.getState();
      expect(rooms[id].capacity).toBe(2);
    });

    it('主大厅容量为Infinity', () => {
      const { createRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });

      const { rooms } = useRoomStore.getState();
      expect(rooms[id].capacity).toBe(Infinity);
    });

    it('可以创建多个房间', () => {
      const { createRoom } = useRoomStore.getState();
      createRoom({ name: 'Hall', type: 'MainHall' });
      createRoom({ name: 'Private 1', type: 'PrivateRoom' });
      createRoom({ name: 'Private 2', type: 'PrivateRoom' });

      const { rooms } = useRoomStore.getState();
      expect(Object.keys(rooms)).toHaveLength(3);
    });

    it('删除房间后从列表中移除', () => {
      const { createRoom, deleteRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Temp', type: 'PrivateRoom' });

      deleteRoom(id);

      const { rooms } = useRoomStore.getState();
      expect(rooms[id]).toBeUndefined();
    });

    it('setRooms 批量设置房间列表', () => {
      const { setRooms } = useRoomStore.getState();
      setRooms([
        { id: 'r1', name: 'Hall', type: 'MainHall', capacity: 999999, currentCount: 5, bots: [], walls: [], spawnPoints: [] },
        { id: 'r2', name: 'Private', type: 'PrivateRoom', capacity: 2, currentCount: 1, bots: [], walls: [], spawnPoints: [] },
      ]);

      const { rooms } = useRoomStore.getState();
      expect(Object.keys(rooms)).toHaveLength(2);
      expect(rooms['r1'].currentCount).toBe(5);
    });

    it('房间显示currentCount', () => {
      const { createRoom, addBotToRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });

      addBotToRoom(id, makeBot('bot-1', 100, 100));
      addBotToRoom(id, makeBot('bot-2', 200, 200));

      const { rooms } = useRoomStore.getState();
      expect(rooms[id].currentCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 9: 房间切换
  // -------------------------------------------------------------------------

  describe('需求9: 房间切换', () => {
    it('初始currentRoomId为null', () => {
      const { currentRoomId } = useRoomStore.getState();
      expect(currentRoomId).toBeNull();
    });

    it('switchRoom 切换到指定房间', () => {
      const { createRoom, switchRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });

      switchRoom(id);

      const { currentRoomId } = useRoomStore.getState();
      expect(currentRoomId).toBe(id);
    });

    it('switchRoom 切换到不存在的房间不改变currentRoomId', () => {
      const { createRoom, switchRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });
      switchRoom(id);

      switchRoom('nonexistent-room');

      const { currentRoomId } = useRoomStore.getState();
      expect(currentRoomId).toBe(id);
    });

    it('删除当前房间后currentRoomId变为null', () => {
      const { createRoom, switchRoom, deleteRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });
      switchRoom(id);

      deleteRoom(id);

      const { currentRoomId } = useRoomStore.getState();
      expect(currentRoomId).toBeNull();
    });

    it('bot可以从一个房间移到另一个房间', () => {
      const { createRoom, addBotToRoom, removeBotFromRoom } = useRoomStore.getState();
      const hallId = createRoom({ name: 'Hall', type: 'MainHall' });
      const privId = createRoom({ name: 'Private', type: 'PrivateRoom' });

      const bot = makeBot('bot-switch', 100, 100);
      addBotToRoom(hallId, bot);

      expect(useRoomStore.getState().rooms[hallId].bots).toHaveLength(1);

      removeBotFromRoom(hallId, 'bot-switch');
      addBotToRoom(privId, bot);

      const state = useRoomStore.getState();
      expect(state.rooms[hallId].bots).toHaveLength(0);
      expect(state.rooms[privId].bots).toHaveLength(1);
      expect(state.rooms[hallId].currentCount).toBe(0);
      expect(state.rooms[privId].currentCount).toBe(1);
    });

    it('setCurrentRoom 直接设置当前房间', () => {
      const { setCurrentRoom } = useRoomStore.getState();
      setCurrentRoom('some-room-id');

      const { currentRoomId } = useRoomStore.getState();
      expect(currentRoomId).toBe('some-room-id');
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 2: 容量管理
  // -------------------------------------------------------------------------

  describe('需求2: 容量管理', () => {
    it('私聊房间满员后currentCount等于capacity', () => {
      const { createRoom, addBotToRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Private', type: 'PrivateRoom' });

      addBotToRoom(id, makeBot('bot-1', 100, 100));
      addBotToRoom(id, makeBot('bot-2', 200, 200));

      const { rooms } = useRoomStore.getState();
      const room = rooms[id];
      expect(room.currentCount).toBe(2);
      expect(room.currentCount >= room.capacity).toBe(true);
    });

    it('bot离开后currentCount减少', () => {
      const { createRoom, addBotToRoom, removeBotFromRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Private', type: 'PrivateRoom' });

      addBotToRoom(id, makeBot('bot-1', 100, 100));
      addBotToRoom(id, makeBot('bot-2', 200, 200));
      removeBotFromRoom(id, 'bot-1');

      const { rooms } = useRoomStore.getState();
      expect(rooms[id].currentCount).toBe(1);
    });

    it('重复添加同一bot不增加currentCount', () => {
      const { createRoom, addBotToRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });
      const bot = makeBot('bot-dup', 100, 100);

      addBotToRoom(id, bot);
      addBotToRoom(id, bot); // duplicate

      const { rooms } = useRoomStore.getState();
      expect(rooms[id].currentCount).toBe(1);
      expect(rooms[id].bots).toHaveLength(1);
    });

    it('updateRoom 可以更新房间属性', () => {
      const { createRoom, updateRoom } = useRoomStore.getState();
      const id = createRoom({ name: 'Old Name', type: 'MainHall' });

      updateRoom(id, { name: 'New Name' });

      const { rooms } = useRoomStore.getState();
      expect(rooms[id].name).toBe('New Name');
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 3, 4, 5: 碰撞可视化 (CollisionStore)
  // -------------------------------------------------------------------------

  describe('需求3&4&5: 碰撞检测 (CollisionStore)', () => {
    it('初始状态下无碰撞事件', () => {
      const { collisions } = useCollisionStore.getState();
      expect(collisions).toHaveLength(0);
    });

    it('updateSpatialIndex 构建空间索引', () => {
      const { updateSpatialIndex } = useCollisionStore.getState();
      const bots = [makeBot('bot-1', 100, 100), makeBot('bot-2', 200, 200)];

      updateSpatialIndex('room-1', bots);

      const { spatialGrids } = useCollisionStore.getState();
      expect(spatialGrids['room-1']).toBeDefined();
      expect(spatialGrids['room-1'].cellSize).toBe(64);
    });

    it('checkCollision — 两个bot重叠时检测到bot-bot碰撞', () => {
      const { checkCollision, updateSpatialIndex } = useCollisionStore.getState();
      const bots = [makeBot('bot-a', 100, 100)];
      updateSpatialIndex('room-1', bots);

      const result = checkCollision(
        'room-1',
        { x: 100, y: 100 },
        { width: 32, height: 32 },
        'bot-b',
        [],
        bots,
      );

      expect(result).not.toBeNull();
      expect(result?.type).toBe('bot-bot');
      expect(result?.targetId).toBe('bot-a');
    });

    it('checkCollision — bot不重叠时无碰撞', () => {
      const { checkCollision, updateSpatialIndex } = useCollisionStore.getState();
      const bots = [makeBot('bot-a', 100, 100)];
      updateSpatialIndex('room-1', bots);

      const result = checkCollision(
        'room-1',
        { x: 300, y: 300 },
        { width: 32, height: 32 },
        'bot-b',
        [],
        bots,
      );

      expect(result).toBeNull();
    });

    it('checkCollision — bot与墙体重叠时检测到bot-wall碰撞', () => {
      const { checkCollision } = useCollisionStore.getState();
      const walls = [makeWall('wall-1', 'room-1', 200, 200, 64, 64)];

      // Wall top-left at (200,200), size 64x64 → center at (232,232)
      // Bot center at (232,232) with size 32x32 → fully overlaps wall center
      const result = checkCollision(
        'room-1',
        { x: 232, y: 232 },
        { width: 32, height: 32 },
        'bot-a',
        walls,
        [],
      );

      expect(result).not.toBeNull();
      expect(result?.type).toBe('bot-wall');
      expect(result?.targetId).toBe('wall-1');
    });

    it('checkCollision — bot不与墙体重叠时无碰撞', () => {
      const { checkCollision } = useCollisionStore.getState();
      const walls = [makeWall('wall-1', 'room-1', 200, 200, 64, 64)];

      const result = checkCollision(
        'room-1',
        { x: 500, y: 500 },
        { width: 32, height: 32 },
        'bot-a',
        walls,
        [],
      );

      expect(result).toBeNull();
    });

    it('checkCollision — bot不与自身碰撞', () => {
      const { checkCollision, updateSpatialIndex } = useCollisionStore.getState();
      const bots = [makeBot('bot-self', 100, 100)];
      updateSpatialIndex('room-1', bots);

      const result = checkCollision(
        'room-1',
        { x: 100, y: 100 },
        { width: 32, height: 32 },
        'bot-self',
        [],
        bots,
      );

      expect(result).toBeNull();
    });

    it('addCollisionEvent 添加碰撞事件', () => {
      const { addCollisionEvent } = useCollisionStore.getState();

      addCollisionEvent({
        type: 'bot-bot',
        botId: 'bot-a',
        targetId: 'bot-b',
        position: { x: 100, y: 100 },
        timestamp: Date.now(),
      });

      const { collisions } = useCollisionStore.getState();
      expect(collisions).toHaveLength(1);
      expect(collisions[0].type).toBe('bot-bot');
    });

    it('clearCollisions 清空碰撞事件', () => {
      const { addCollisionEvent, clearCollisions } = useCollisionStore.getState();

      addCollisionEvent({
        type: 'bot-wall',
        botId: 'bot-a',
        targetId: 'wall-1',
        position: { x: 200, y: 200 },
        timestamp: Date.now(),
      });

      clearCollisions();

      const { collisions } = useCollisionStore.getState();
      expect(collisions).toHaveLength(0);
    });

    it('getNearbyBots — 返回附近bot', () => {
      const { updateSpatialIndex, getNearbyBots } = useCollisionStore.getState();
      const bots = [
        makeBot('bot-near', 100, 100),
        makeBot('bot-far', 1000, 1000),
      ];
      updateSpatialIndex('room-1', bots);

      const nearby = getNearbyBots('room-1', { x: 100, y: 100 }, 200);
      expect(nearby).toContain('bot-near');
      expect(nearby).not.toContain('bot-far');
    });

    it('getWallsInArea — 返回区域内的墙体', () => {
      const { getWallsInArea } = useCollisionStore.getState();
      const walls = [
        makeWall('wall-in', 'room-1', 100, 100, 64, 64),
        makeWall('wall-out', 'room-1', 900, 900, 64, 64),
      ];

      const result = getWallsInArea(walls, { x1: 0, y1: 0, x2: 300, y2: 300 });
      expect(result.map((w) => w.id)).toContain('wall-in');
      expect(result.map((w) => w.id)).not.toContain('wall-out');
    });

    it('updateBotPosition 更新bot位置', () => {
      const { createRoom, addBotToRoom, updateBotPosition } = useRoomStore.getState();
      const id = createRoom({ name: 'Hall', type: 'MainHall' });
      addBotToRoom(id, makeBot('bot-move', 100, 100));

      updateBotPosition(id, 'bot-move', { x: 300, y: 400 });

      const { rooms } = useRoomStore.getState();
      const bot = rooms[id].bots.find((b) => b.id === 'bot-move');
      expect(bot?.position.x).toBe(300);
      expect(bot?.position.y).toBe(400);
    });

    it('碰撞事件最多保留100条', () => {
      const { addCollisionEvent } = useCollisionStore.getState();

      for (let i = 0; i < 110; i++) {
        addCollisionEvent({
          type: 'bot-bot',
          botId: `bot-${i}`,
          position: { x: i, y: i },
          timestamp: Date.now() + i,
        });
      }

      const { collisions } = useCollisionStore.getState();
      expect(collisions.length).toBeLessThanOrEqual(100);
    });
  });

  // -------------------------------------------------------------------------
  // Requirement 1: 房间隔离
  // -------------------------------------------------------------------------

  describe('需求1: 房间隔离', () => {
    it('不同房间的bot列表相互独立', () => {
      const { createRoom, addBotToRoom } = useRoomStore.getState();
      const hallId = createRoom({ name: 'Hall', type: 'MainHall' });
      const privId = createRoom({ name: 'Private', type: 'PrivateRoom' });

      addBotToRoom(hallId, makeBot('bot-hall', 100, 100));
      addBotToRoom(privId, makeBot('bot-priv', 200, 200));

      const { rooms } = useRoomStore.getState();
      expect(rooms[hallId].bots.map((b) => b.id)).toContain('bot-hall');
      expect(rooms[hallId].bots.map((b) => b.id)).not.toContain('bot-priv');
      expect(rooms[privId].bots.map((b) => b.id)).toContain('bot-priv');
      expect(rooms[privId].bots.map((b) => b.id)).not.toContain('bot-hall');
    });

    it('不同房间的碰撞检测相互独立', () => {
      const { checkCollision, updateSpatialIndex } = useCollisionStore.getState();

      const botsRoom1 = [makeBot('bot-r1', 100, 100)];
      const botsRoom2 = [makeBot('bot-r2', 100, 100)];

      updateSpatialIndex('room-1', botsRoom1);
      updateSpatialIndex('room-2', botsRoom2);

      // bot-new in room-2 should collide with bot-r2 (same position), not bot-r1
      const result = checkCollision(
        'room-2',
        { x: 100, y: 100 },
        { width: 32, height: 32 },
        'bot-new',
        [],
        botsRoom2,
      );

      expect(result).not.toBeNull();
      expect(result?.targetId).toBe('bot-r2');
    });
  });
});
