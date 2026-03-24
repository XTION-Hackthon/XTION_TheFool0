/**
 * GameScene — Main Phaser 3 game scene
 * Uses background image as base map with a defined "Main Hall" zone.
 * Hall zone: (570,280) to (690,410) — supports broadcast, whisper, auto-move.
 * Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
 */

import Phaser from 'phaser';
import { SpriteManager } from './sprite-manager';
import { useZoneStore } from '../stores/zoneStore';
import { useGameStore } from '../stores/gameStore';

// ── Main Hall zone bounds (pixel coords on the 1800×1000 map) ────────────────
export const HALL_BOUNDS = {
  x: 570,
  y: 280,
  width: 690,   // 1260 - 570
  height: 410,  // 690 - 280
  right: 1260,
  bottom: 690,
} as const;

export class GameScene extends Phaser.Scene {
  private spriteManager: SpriteManager | null = null;
  private spriteLayer: Phaser.GameObjects.Container | null = null;
  private hallZoneGraphics: Phaser.GameObjects.Graphics | null = null;
  private hallLabel: Phaser.GameObjects.Text | null = null;
  private unsubscribeZone: (() => void) | null = null;
  private unsubscribeGame: (() => void) | null = null;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // ── Background image ─────────────────────────────────────────
    const bg = this.add.image(0, 0, 'map_bg');
    bg.setOrigin(0, 0);
    bg.setDepth(0);
    bg.setDisplaySize(1800, 1000);

    // ── Draw hall zone overlay ───────────────────────────────────
    this.drawHallZone();

    // ── Sprite layer ─────────────────────────────────────────────
    this.spriteLayer = this.add.container(0, 0);
    this.spriteLayer.setDepth(10);

    this.spriteManager = new SpriteManager(this, this.spriteLayer);

    // ── Store subscriptions ──────────────────────────────────────
    this.unsubscribeZone = useZoneStore.subscribe((state) => {
      // Zone store still available for future wall/obstacle rendering
      void state;
    });

    this.unsubscribeGame = useGameStore.subscribe((state) => {
      if (!this.spriteManager) return;
      for (const [, contestant] of state.contestants) {
        this.spriteManager.updateContestant(contestant);
      }
    });

    // Initial render of existing contestants
    const gameState = useGameStore.getState();
    if (this.spriteManager) {
      for (const [, contestant] of gameState.contestants) {
        this.spriteManager.addContestant(contestant);
      }
    }

  }

  /**
   * Draw the Main Hall zone as a visible rectangle with label.
   */
  private drawHallZone(): void {
    const { x, y, width, height } = HALL_BOUNDS;

    // Semi-transparent fill + border
    this.hallZoneGraphics = this.add.graphics();
    this.hallZoneGraphics.setDepth(1);

    // Fill
    this.hallZoneGraphics.fillStyle(0x4488ff, 0.12);
    this.hallZoneGraphics.fillRect(x, y, width, height);

    // Border — dashed effect via two strokes
    this.hallZoneGraphics.lineStyle(2, 0x4488ff, 0.6);
    this.hallZoneGraphics.strokeRect(x, y, width, height);

    // Corner markers
    const cornerSize = 8;
    this.hallZoneGraphics.lineStyle(3, 0x66aaff, 0.9);
    // Top-left
    this.hallZoneGraphics.lineBetween(x, y, x + cornerSize, y);
    this.hallZoneGraphics.lineBetween(x, y, x, y + cornerSize);
    // Top-right
    this.hallZoneGraphics.lineBetween(x + width, y, x + width - cornerSize, y);
    this.hallZoneGraphics.lineBetween(x + width, y, x + width, y + cornerSize);
    // Bottom-left
    this.hallZoneGraphics.lineBetween(x, y + height, x + cornerSize, y + height);
    this.hallZoneGraphics.lineBetween(x, y + height, x, y + height - cornerSize);
    // Bottom-right
    this.hallZoneGraphics.lineBetween(x + width, y + height, x + width - cornerSize, y + height);
    this.hallZoneGraphics.lineBetween(x + width, y + height, x + width, y + height - cornerSize);

    // Label
    this.hallLabel = this.add.text(x + width / 2, y - 8, '🏛 大厅', {
      fontSize: '14px',
      color: '#88bbff',
      stroke: '#000000',
      strokeThickness: 3,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 1).setDepth(1);
  }

  shutdown(): void {
    this.cleanup();
  }

  sleep(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.unsubscribeZone?.();
    this.unsubscribeZone = null;
    this.unsubscribeGame?.();
    this.unsubscribeGame = null;
    this.spriteManager?.destroy();
    this.spriteManager = null;
    this.spriteLayer?.destroy();
    this.spriteLayer = null;
    this.hallZoneGraphics?.destroy();
    this.hallZoneGraphics = null;
    this.hallLabel?.destroy();
    this.hallLabel = null;
  }
}
