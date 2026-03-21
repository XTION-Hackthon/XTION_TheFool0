/**
 * GameScene — Phaser 3 main scene
 * Manages rendering layers: MapLayer → ZoneLayer → SpriteLayer → EffectLayer → UILayer
 * Handles zoom (mouse wheel), pan (drag), and responsive resize.
 * Requirements: 6.1, 6.2, 6.7, 6.8, 6.10, 2.9, 2.10
 */

import Phaser from 'phaser';
import { useGameStore } from '../stores/gameStore';
import { useRoomStore } from '../stores/roomStore';
import type { Wall, SpawnPoint, Bot } from '../stores/roomStore';
import { useCollisionStore } from '../stores/collisionStore';
import type { CollisionEvent } from '../stores/collisionStore';
import { useDoorwayStore } from '../stores/doorwayStore';
import { SpriteManager } from './sprite-manager';
import type { Zone, GameMap } from '../../../server/src/types/index';
import { collisionSystem } from './collision-system';
import type { CollisionResult } from './collision-system';
import { WorldRenderer } from './world-renderer';
import { apiClient } from '../services/api-client';
import { PathfindingSystem, type Point } from './pathfinding-system';

// Zoom limits
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;

// Zone type → icon texture key mapping
const ZONE_TYPE_ICONS: Record<string, string> = {
  rest: 'icon_rest',
  work: 'icon_work',
  social: 'icon_social',
};

interface ZoneGraphics {
  fill: Phaser.GameObjects.Graphics;
  border: Phaser.GameObjects.Graphics;
  nameLabel: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
}

export class GameScene extends Phaser.Scene {
  // Rendering containers (layers)
  private mapLayer!: Phaser.GameObjects.Container;
  private zoneLayer!: Phaser.GameObjects.Container;
  private spriteLayer!: Phaser.GameObjects.Container;
  private effectLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  // Camera / pan state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camScrollX = 0;
  private camScrollY = 0;

  // Zone graphics cache
  private zoneGraphics = new Map<string, ZoneGraphics>();

  // Sprite manager (task 17.2)
  private spriteManager!: SpriteManager;

  // Zustand unsubscribe handle
  private unsubscribeStore: (() => void) | null = null;

  // WorldRenderer for rooms, walls, and doorways (Requirements: 1.2, 1.3, 6.1, 6.2)
  private worldRenderer: WorldRenderer | null = null;

  // Pathfinding system (Requirements: 3.1, 3.2, 4.3)
  private pathfindingSystem: PathfindingSystem | null = null;
  private currentPath: Point[] = [];
  private pathIndex = 0;

  // Multi-room support (Requirements: 1, 4, 6)
  private currentRoomId: string | null = null;
  private wallGraphics: Phaser.GameObjects.Graphics | null = null;
  private spawnPointGraphics: Phaser.GameObjects.Graphics | null = null;
  private roomBotSprites: Map<string, Phaser.GameObjects.Container> = new Map();

  // Performance: object pool for bot sprite containers (task 9.3)
  private _botSpritePool: Phaser.GameObjects.Container[] = [];

  // Performance: dirty flag — only re-render room when something changed (task 9.3)
  private _roomDirty = false;

  // Current map dimensions
  private mapWidth = 1600;
  private mapHeight = 900;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.createLayers();
    this.setupInputHandlers();
    this.setupResizeHandler();
    this.subscribeToStore();

    // Instantiate SpriteManager — Req 6.3, 6.4, 6.9, 1.8, 9.7, 9.11, 11.7
    this.spriteManager = new SpriteManager(this, this.spriteLayer);

    // Instantiate WorldRenderer — Req 1.2, 1.3, 6.1, 6.2
    this.worldRenderer = new WorldRenderer(this);

    // Instantiate PathfindingSystem — Req 3.1, 3.2, 4.3
    this.pathfindingSystem = new PathfindingSystem();

    // Initial render from current store state
    const state = useGameStore.getState();
    if (state.map) {
      this.renderMap(state.map);
    }
    state.zones.forEach((zone) => this.renderZone(zone));

    // Load and render world data (rooms, walls, doorways) — Req 1.2, 1.3, 7.5
    this.loadAndRenderWorld();
  }

  // ── Layer setup ─────────────────────────────────────────────────────────────

  private createLayers(): void {
    this.mapLayer = this.add.container(0, 0);
    this.zoneLayer = this.add.container(0, 0);
    this.spriteLayer = this.add.container(0, 0);
    this.effectLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    // Depth order (bottom → top)
    this.mapLayer.setDepth(0);
    this.zoneLayer.setDepth(1);
    this.spriteLayer.setDepth(2);
    this.effectLayer.setDepth(3);
    this.uiLayer.setDepth(4);
  }

  // ── Map rendering ───────────────────────────────────────────────────────────

  /**
   * Fetch rooms, walls, and doorways from the API and render the world.
   * Requirements: 1.2, 1.3, 7.5
   */
  private async loadAndRenderWorld(): Promise<void> {
    if (!this.worldRenderer) return;

    try {
      // Fetch rooms
      const rooms = await apiClient.get<{ rooms?: unknown[] } | unknown[]>('/api/rooms');
      const roomList = Array.isArray(rooms) ? rooms : (rooms as { rooms?: unknown[] }).rooms ?? [];

      // Update roomStore with fetched rooms
      useRoomStore.getState().setRooms(roomList as import('../stores/roomStore').Room[]);

      // Fetch doorways
      const doorwaysResp = await apiClient.get<{ doorways?: unknown[] } | unknown[]>('/api/doorways');
      const doorwayList = Array.isArray(doorwaysResp)
        ? doorwaysResp
        : (doorwaysResp as { doorways?: unknown[] }).doorways ?? [];

      // Update doorwayStore
      useDoorwayStore.getState().setDoorways(doorwayList as import('../stores/doorwayStore').Doorway[]);

      // Collect all walls from all rooms
      const allRooms = Object.values(useRoomStore.getState().rooms);
      const allWalls = allRooms.flatMap((r) => r.walls);
      const allDoorways = Object.values(useDoorwayStore.getState().doorways);

      // Initialize pathfinding system — Req 3.1, 3.2
      if (this.pathfindingSystem) {
        this.pathfindingSystem.initialize(allRooms, allDoorways);
      }

      // Render world
      this.worldRenderer.renderRooms(allRooms);
      this.worldRenderer.renderWalls(allWalls, allDoorways);
      this.worldRenderer.renderDoorways(allDoorways);
    } catch (err) {
      // Non-fatal: world rendering is best-effort; game still functions
      console.warn('[GameScene] Failed to load world data:', err);
    }
  }

  private renderMap(map: GameMap): void {
    this.mapWidth = map.width;
    this.mapHeight = map.height;

    // Clear existing map layer children
    this.mapLayer.removeAll(true);

    if (map.backgroundImage) {
      // If a background image key is loaded, use it
      if (this.textures.exists(map.backgroundImage)) {
        const bg = this.add.image(0, 0, map.backgroundImage).setOrigin(0, 0);
        this.mapLayer.add(bg);
        return;
      }
    }

    // Fallback: procedural background
    const bg = this.add.image(0, 0, 'map_bg').setOrigin(0, 0);
    // Scale to match map dimensions
    bg.setDisplaySize(map.width, map.height);
    this.mapLayer.add(bg);
  }

  // ── Zone rendering ──────────────────────────────────────────────────────────

  private renderZone(zone: Zone): void {
    // Remove old graphics if re-rendering
    this.removeZoneGraphics(zone.id);

    const { x1, y1, x2, y2 } = zone.bounds;
    const w = x2 - x1;
    const h = y2 - y1;
    const cx = x1 + w / 2;

    // Parse fill color (hex string like '#3a3a6e' or number)
    const fillColor = this.parseColor(zone.style.fillColor, 0x3a3a6e);
    const borderColor = this.parseColor(zone.style.borderColor, 0x7986cb);
    const alpha = zone.style.opacity ?? 0.4;

    // Fill rectangle
    const fill = this.add.graphics();
    fill.fillStyle(fillColor, alpha);
    fill.fillRect(x1, y1, w, h);

    // Border rectangle
    const border = this.add.graphics();
    border.lineStyle(2, borderColor, 1);
    border.strokeRect(x1, y1, w, h);

    // Zone type icon
    const iconKey = this.getZoneIconKey(zone.zoneTypeId);
    const icon = this.add.image(x1 + 20, y1 + 20, iconKey).setDisplaySize(24, 24);

    // Zone name label
    const nameLabel = this.add.text(cx, y1 + 8, zone.name, {
      fontSize: '14px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 0);

    this.zoneLayer.add([fill, border, icon, nameLabel]);

    this.zoneGraphics.set(zone.id, { fill, border, nameLabel, icon });
  }

  private removeZoneGraphics(zoneId: string): void {
    const existing = this.zoneGraphics.get(zoneId);
    if (!existing) return;
    existing.fill.destroy();
    existing.border.destroy();
    existing.nameLabel.destroy();
    existing.icon.destroy();
    this.zoneGraphics.delete(zoneId);
  }

  private getZoneIconKey(zoneTypeId: string): string {
    // zoneTypeId may be 'rest', 'work', 'social' or a UUID for custom types
    const lower = zoneTypeId.toLowerCase();
    for (const [key, texture] of Object.entries(ZONE_TYPE_ICONS)) {
      if (lower.includes(key)) return texture;
    }
    return 'icon_default';
  }

  private parseColor(colorStr: string | undefined, fallback: number): number {
    if (!colorStr) return fallback;
    if (typeof colorStr === 'number') return colorStr;
    const hex = colorStr.replace('#', '');
    const parsed = parseInt(hex, 16);
    return isNaN(parsed) ? fallback : parsed;
  }

  // ── Input: zoom & pan ───────────────────────────────────────────────────────

  private setupInputHandlers(): void {
    // Mouse wheel zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const newZoom = Phaser.Math.Clamp(
        cam.zoom + (dy < 0 ? ZOOM_STEP : -ZOOM_STEP),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      cam.setZoom(newZoom);
    });

    // Drag pan
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.camScrollX = this.cameras.main.scrollX;
      this.camScrollY = this.cameras.main.scrollY;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const cam = this.cameras.main;
      const dx = (pointer.x - this.dragStartX) / cam.zoom;
      const dy = (pointer.y - this.dragStartY) / cam.zoom;
      cam.setScroll(this.camScrollX - dx, this.camScrollY - dy);
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });

    this.input.on('pointerupoutside', () => {
      this.isDragging = false;
    });
  }

  // ── Responsive resize ───────────────────────────────────────────────────────

  private setupResizeHandler(): void {
    this.scale.on('resize', this.onResize, this);
    // Initial fit
    this.fitCameraToMap();
  }

  private onResize(): void {
    this.fitCameraToMap();
  }

  private fitCameraToMap(): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    // Fit map into viewport while maintaining aspect ratio
    const scaleX = width / this.mapWidth;
    const scaleY = height / this.mapHeight;
    const fitZoom = Math.min(scaleX, scaleY, MAX_ZOOM);
    cam.setZoom(Math.max(fitZoom, MIN_ZOOM));
    cam.centerOn(this.mapWidth / 2, this.mapHeight / 2);
  }

  // ── Zustand store subscription ──────────────────────────────────────────────

  private subscribeToStore(): void {
    // Subscribe to map changes
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      if (state.map !== prev.map && state.map) {
        this.renderMap(state.map);
        this.fitCameraToMap();
      }

      // Re-render zones that changed
      state.zones.forEach((zone, id) => {
        if (zone !== prev.zones.get(id)) {
          this.renderZone(zone);
        }
      });

      // Remove zones that were deleted
      prev.zones.forEach((_zone, id) => {
        if (!state.zones.has(id)) {
          this.removeZoneGraphics(id);
        }
      });
    });

    // Subscribe to room store changes — mark dirty when bot positions change (task 9.3)
    useRoomStore.subscribe((state) => {
      this._roomDirty = true;
      // Update pathfinding system with new rooms
      if (this.pathfindingSystem) {
        const rooms = Object.values(state.rooms);
        this.pathfindingSystem.updateRooms(rooms);
      }
    });

    // Subscribe to doorway store changes
    useDoorwayStore.subscribe((state) => {
      // Update pathfinding system with new doorways
      if (this.pathfindingSystem) {
        const doorways = Object.values(state.doorways);
        this.pathfindingSystem.updateDoorways(doorways);
      }
    });
  }

  // ── Multi-room support ──────────────────────────────────────────────────────

  // ── Multi-room support ──────────────────────────────────────────────────────

  /**
   * 公开 API：通过寻路系统移动 bot 到目标位置
   * 由 agent 通过 API 调用
   */
  public async moveToTarget(
    botId: string,
    targetPos: { x: number; y: number },
    targetRoomId: string,
    apiBaseUrl: string,
    authToken: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.pathfindingSystem) {
      return { success: false, error: 'Pathfinding system not initialized' };
    }

    const roomState = useRoomStore.getState();
    const currentRoomId = roomState.currentRoomId;

    if (!currentRoomId) {
      return { success: false, error: 'No active room' };
    }

    const currentRoom = roomState.rooms[currentRoomId];
    if (!currentRoom || !currentRoom.bounds) {
      return { success: false, error: 'Current room not found' };
    }

    const currentBot = currentRoom.bots?.find((b) => b.id === botId);
    if (!currentBot) {
      return { success: false, error: 'Bot not found' };
    }

    // Find path using pathfinding system
    const path = this.pathfindingSystem.findMultiRoomPath(
      currentBot.position,
      targetPos,
      currentRoomId,
      targetRoomId,
      currentRoom.bots ?? [],
      botId,
    );

    if (path.length === 0) {
      return { success: false, error: 'No path found to target' };
    }

    // Execute path
    this.currentPath = path;
    this.pathIndex = 0;

    return new Promise((resolve) => {
      const executeStep = () => {
        if (this.pathIndex >= this.currentPath.length) {
          this.currentPath = [];
          this.pathIndex = 0;
          resolve({ success: true });
          return;
        }

        const targetStep = this.currentPath[this.pathIndex];
        this.pathIndex++;

        this.handleBotMovement(botId, targetStep, apiBaseUrl, authToken)
          .then((result) => {
            if (result.success) {
              // Continue to next step with small delay
              this.time.delayedCall(50, executeStep);
            } else {
              // Path blocked
              this.currentPath = [];
              this.pathIndex = 0;
              resolve({ success: false, error: result.error });
            }
          })
          .catch((err) => {
            this.currentPath = [];
            this.pathIndex = 0;
            resolve({ success: false, error: String(err) });
          });
      };

      executeStep();
    });
  }

  /** Load a room by ID: renders walls, spawn points, and bots. Req 1, 4, 6 */
  public loadRoom(roomId: string): void {
    const room = useRoomStore.getState().rooms[roomId];
    if (!room) return;

    this.currentRoomId = roomId;
    this._roomDirty = true;
  }

  /**
   * Phaser update loop — only re-renders room content when dirty flag is set.
   * Requirement 9: room switch latency < 100ms
   */
  public override update(): void {
    if (!this._roomDirty || !this.currentRoomId) return;
    this._roomDirty = false;

    const room = useRoomStore.getState().rooms[this.currentRoomId];
    if (!room) return;

    this.renderWalls(room.walls);
    this.renderSpawnPoints(room.spawnPoints);
    this.renderBots(room.bots);
  }

  /** Render walls as filled rectangles with border. Req 4 */
  private renderWalls(walls: Wall[]): void {
    if (this.wallGraphics) {
      this.wallGraphics.clear();
    } else {
      this.wallGraphics = this.add.graphics();
      this.spriteLayer.add(this.wallGraphics);
    }

    for (const wall of walls) {
      this.wallGraphics.fillStyle(0x4466aa, 0.6);
      this.wallGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
      this.wallGraphics.lineStyle(2, 0x6688cc, 1);
      this.wallGraphics.strokeRect(wall.x, wall.y, wall.width, wall.height);
    }
  }

  /** Render spawn points as circles. Available = green, unavailable = gray. Req 1, 6, 11 */
  private renderSpawnPoints(points: SpawnPoint[]): void {
    if (this.spawnPointGraphics) {
      this.spawnPointGraphics.clear();
    } else {
      this.spawnPointGraphics = this.add.graphics();
      this.spriteLayer.add(this.spawnPointGraphics);
    }

    for (const point of points) {
      if (point.isAvailable) {
        this.spawnPointGraphics.fillStyle(0x44cc66, 0.7);
      } else {
        this.spawnPointGraphics.fillStyle(0x888888, 0.4);
      }
      this.spawnPointGraphics.fillCircle(point.x, point.y, 8);
    }
  }

  /**
   * Allocate a spawn point for a new bot entering a room.
   * Tries up to 3 random available spawn points and returns the first
   * that doesn't collide with existing bots. Req 11
   */
  public allocateSpawnPoint(roomId: string, botId: string): { x: number; y: number } | null {
    const room = useRoomStore.getState().rooms[roomId];
    if (!room) return null;

    // Get available spawn points
    const available = room.spawnPoints.filter((p) => p.isAvailable);
    if (available.length === 0) return null;

    const { bots, walls } = room;

    // Build spatial index for collision checks
    collisionSystem.buildIndex(bots);

    // Try up to 3 random spawn points
    const maxAttempts = Math.min(3, available.length);
    const candidates = [...available];

    for (let i = 0; i < maxAttempts; i++) {
      // Pick a random candidate
      const idx = Math.floor(Math.random() * candidates.length);
      const point = candidates[idx];
      candidates.splice(idx, 1);

      const result = collisionSystem.validateMove(
        { x: point.x, y: point.y },
        bots,
        walls,
        botId,
      );

      if (!result.hasCollision) {
        return { x: point.x, y: point.y };
      }
    }

    return null;
  }

  /** Render bots in the current room with object pooling and viewport culling. Req 1, 4 */
  private renderBots(bots: Bot[]): void {
    const SPRITE_SIZE = 48;
    const VIEWPORT_MARGIN = 64;

    // Get visible world rect for viewport culling
    const worldView = this.cameras.main.worldView;
    const visLeft = worldView.x - VIEWPORT_MARGIN;
    const visRight = worldView.right + VIEWPORT_MARGIN;
    const visTop = worldView.y - VIEWPORT_MARGIN;
    const visBottom = worldView.bottom + VIEWPORT_MARGIN;

    for (const bot of bots) {
      const { x, y } = bot.position;
      const inView = x >= visLeft && x <= visRight && y >= visTop && y <= visBottom;

      if (this.roomBotSprites.has(bot.id)) {
        // Update existing sprite position and visibility
        const container = this.roomBotSprites.get(bot.id)!;
        container.setPosition(x, y);
        container.setVisible(inView);
      } else {
        // Reuse a pooled container or create a new one
        let container: Phaser.GameObjects.Container;

        if (this._botSpritePool.length > 0) {
          container = this._botSpritePool.pop()!;
          container.setPosition(x, y);
          container.setVisible(inView);
          // Update name label (second child)
          const nameLabel = container.getAt(1) as Phaser.GameObjects.Text;
          nameLabel.setText(bot.name);
        } else {
          const image = this.add.image(0, 0, 'contestant')
            .setDisplaySize(SPRITE_SIZE, SPRITE_SIZE)
            .setOrigin(0.5, 0.5);

          const nameLabel = this.add.text(0, -(SPRITE_SIZE / 2 + 14), bot.name, {
            fontSize: '12px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 3,
            fontFamily: 'Arial, sans-serif',
          }).setOrigin(0.5, 1);

          container = this.add.container(x, y, [image, nameLabel]);
          container.setVisible(inView);
          this.spriteLayer.add(container);
        }

        this.roomBotSprites.set(bot.id, container);
      }
    }

    // Return sprites for bots no longer in the room to the pool
    const botIds = new Set(bots.map((b) => b.id));
    for (const [id, container] of this.roomBotSprites) {
      if (!botIds.has(id)) {
        container.setVisible(false);
        this._botSpritePool.push(container);
        this.roomBotSprites.delete(id);
      }
    }
  }

  // ── Movement validation ─────────────────────────────────────────────────────

  /**
   * Configure camera to follow a bot sprite.
   * Requirements: 6.1, 6.2, 7.5
   */
  public followBot(botId: string): void {
    const sprite = this.roomBotSprites.get(botId);
    if (sprite) {
      this.cameras.main.startFollow(sprite, true);
    }
  }

  /**
   * Validate and apply a bot movement.
   * 1. Client-side collision check via collisionSystem
   * 2. Backend validation via POST /api/collision/validate-move
   * 3. On success, update bot position in roomStore
   * Requirements: 3, 4, 5, 10
   */
  public async handleBotMovement(
    botId: string,
    targetPos: { x: number; y: number },
    apiBaseUrl: string,
    authToken: string,
  ): Promise<{ success: boolean; error?: string; collisionType?: 'bot' | 'wall' }> {
    // 1. Get current room
    const roomState = useRoomStore.getState();
    const currentRoomId = roomState.currentRoomId;
    if (!currentRoomId) {
      return { success: false, error: 'No active room' };
    }

    const room = roomState.rooms[currentRoomId];
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // 2. Get bots and walls from room store
    const { bots, walls } = room;

    // 3. Build spatial index
    collisionSystem.buildIndex(bots);

    // 4. Client-side validation (doorway-aware wall collision — Req 5.1, 5.2)
    const doorways = Object.values(useDoorwayStore.getState().doorways);
    const wallResult: CollisionResult = collisionSystem.checkWallCollisionWithDoorways(targetPos, walls, doorways);
    if (wallResult.hasCollision) {
      this.recordCollisionEvent(botId, wallResult);
      return { success: false, error: 'Blocked by wall', collisionType: 'wall' };
    }

    const clientResult: CollisionResult = collisionSystem.checkBotCollision(targetPos, bots, botId);

    // 5. Client-side collision detected — record and return error
    if (clientResult.hasCollision) {
      this.recordCollisionEvent(botId, clientResult);
      return {
        success: false,
        error: clientResult.type === 'bot' ? 'Blocked by another bot' : 'Blocked by wall',
        collisionType: clientResult.type,
      };
    }

    // 6. Backend validation
    let backendValid = true;
    let backendError: string | undefined;
    let backendCollisionType: 'bot' | 'wall' | undefined;

    try {
      const response = await fetch(`${apiBaseUrl}/api/collision/validate-move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ roomId: currentRoomId, botId, targetPos }),
      });

      const data = await response.json() as {
        valid?: boolean;
        collision?: { type?: 'bot' | 'wall' };
        error?: string;
      };

      if (!response.ok || data.valid === false) {
        backendValid = false;
        backendError = data.error ?? 'Movement blocked by server';
        backendCollisionType = data.collision?.type;
      }
    } catch (err) {
      backendValid = false;
      backendError = 'Failed to reach validation server';
    }

    // 7. Backend returned invalid — record collision event and return error
    if (!backendValid) {
      if (backendCollisionType) {
        const syntheticResult: CollisionResult = {
          hasCollision: true,
          type: backendCollisionType,
        };
        this.recordCollisionEvent(botId, syntheticResult);
      }
      return {
        success: false,
        error: backendError,
        collisionType: backendCollisionType,
      };
    }

    // 8. Valid — update bot position in roomStore
    useRoomStore.getState().updateBotPosition(currentRoomId, botId, targetPos);

    // 9. Return success
    return { success: true };
  }

  /**
   * Record a collision event in the collisionStore.
   * Requirements: 3, 4, 5
   */
  private recordCollisionEvent(botId: string, result: CollisionResult): void {
    const event: CollisionEvent = {
      type: result.type === 'wall' ? 'bot-wall' : 'bot-bot',
      botId,
      targetId: result.targetId,
      position: result.targetPosition ?? { x: 0, y: 0 },
      timestamp: Date.now(),
    };
    useCollisionStore.getState().addCollisionEvent(event);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  shutdown(): void {
    this.spriteManager?.destroy();
    this.unsubscribeStore?.();
    this.scale.off('resize', this.onResize, this);
    this.wallGraphics?.destroy();
    this.spawnPointGraphics?.destroy();
    this.worldRenderer?.destroy();
    this.worldRenderer = null;
    for (const container of this.roomBotSprites.values()) {
      container.destroy();
    }
    this.roomBotSprites.clear();
    for (const container of this._botSpritePool) {
      container.destroy();
    }
    this._botSpritePool.length = 0;
  }

  // Expose layers for SpriteManager (task 17.2)
  getSpriteLayer(): Phaser.GameObjects.Container {
    return this.spriteLayer;
  }

  getEffectLayer(): Phaser.GameObjects.Container {
    return this.effectLayer;
  }

  getUILayer(): Phaser.GameObjects.Container {
    return this.uiLayer;
  }
}
