/**
 * SpriteManager — manages Contestant sprites in the Phaser 3 GameScene.
 *
 * Each contestant is represented by a sprite group:
 *   - image (contestant texture)
 *   - name label (text)
 *   - status dot (connection status indicator)
 *   - heartbeat indicator (color-coded circle)
 *   - energy-depleted label ("精力耗尽")
 *
 * Requirements: 6.3, 6.4, 6.9, 1.8, 9.7, 9.11, 11.7
 */

import Phaser from 'phaser';
import { useGameStore } from '../stores/gameStore';
import { useUiStore } from '../stores/uiStore';
import type { Contestant } from '../../../server/src/types/index';
import type { HealthStatus } from '../../../server/src/types/index';

// ── Constants ────────────────────────────────────────────────────────────────

/** Tween duration range for movement (ms) */
const TWEEN_MIN_MS = 400;
const TWEEN_MAX_MS = 1500;
/** Movement speed: pixels per millisecond */
const MOVEMENT_SPEED = 0.3;

/** Sprite dimensions */
const SPRITE_SIZE = 40;

/** Status dot colors (connection status) — Req 1.8 */
const STATUS_DOT_COLORS: Record<Contestant['status'], number> = {
  online: 0x00e676,
  busy: 0xffab40,
  offline: 0x9e9e9e,
  timeout: 0xef5350,
};

/** Heartbeat indicator colors — Req 9.11 */
const HEARTBEAT_COLORS: Record<HealthStatus, number> = {
  healthy: 0x00e676,   // green
  delayed: 0xffeb3b,   // yellow
  timeout: 0xef5350,   // red
  offline: 0x9e9e9e,   // grey
};

/** Timeout state: gray semi-transparent alpha — Req 9.7 */
const TIMEOUT_ALPHA = 0.45;
const NORMAL_ALPHA = 1.0;

// ── Types ────────────────────────────────────────────────────────────────────

interface SpriteGroup {
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
  nameLabel: Phaser.GameObjects.Text;
  statusDot: Phaser.GameObjects.Arc;
  heartbeatDot: Phaser.GameObjects.Arc;
  energyLabel: Phaser.GameObjects.Text;
  // Speech bubble elements
  bubbleBackground: Phaser.GameObjects.Graphics;
  bubbleText: Phaser.GameObjects.Text;
  bubbleTail: Phaser.GameObjects.Graphics;
  healthStatus: HealthStatus;
  tween: Phaser.Tweens.Tween | null;
  bubbleTimer: ReturnType<typeof setTimeout> | null;
}

// ── SpriteManager ────────────────────────────────────────────────────────────

export class SpriteManager {
  private scene: Phaser.Scene;
  private spriteLayer: Phaser.GameObjects.Container;
  private sprites = new Map<string, SpriteGroup>();
  private unsubscribeStore: (() => void) | null = null;

  constructor(scene: Phaser.Scene, spriteLayer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.spriteLayer = spriteLayer;
    this.subscribeToStore();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Add a new contestant sprite. */
  addContestant(contestant: Contestant): void {
    if (this.sprites.has(contestant.id)) {
      this.updateContestant(contestant);
      return;
    }

    const { x, y } = contestant.position;

    // Base image — uses 'contestant' texture loaded in BootScene
    const image = this.scene.add.image(0, 0, 'contestant')
      .setDisplaySize(SPRITE_SIZE, SPRITE_SIZE)
      .setOrigin(0.5, 0.5);

    // Name label — above sprite
    const nameLabel = this.scene.add.text(0, -(SPRITE_SIZE / 2 + 14), contestant.name, {
      fontSize: '12px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 1);

    // Status dot (connection status) — bottom-right of sprite — Req 1.8
    const statusDot = this.scene.add.arc(
      SPRITE_SIZE / 2 - 4,
      SPRITE_SIZE / 2 - 4,
      5,
      0, 360,
      false,
      STATUS_DOT_COLORS[contestant.status] ?? 0x9e9e9e,
      1,
    );

    // Heartbeat indicator — top-right of sprite — Req 9.11
    const heartbeatDot = this.scene.add.arc(
      SPRITE_SIZE / 2 - 4,
      -(SPRITE_SIZE / 2 - 4),
      5,
      0, 360,
      false,
      HEARTBEAT_COLORS.healthy,
      1,
    );

    // Energy-depleted label — Req 11.7
    const energyLabel = this.scene.add.text(0, SPRITE_SIZE / 2 + 4, '精力耗尽', {
      fontSize: '10px',
      color: '#ff5252',
      stroke: '#000000',
      strokeThickness: 2,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 0).setVisible(contestant.energy === 0);

    // Speech bubble (hidden by default)
    const bubbleBackground = this.scene.add.graphics();
    const bubbleTail = this.scene.add.graphics();
    const bubbleText = this.scene.add.text(0, -(SPRITE_SIZE / 2 + 60), '', {
      fontSize: '11px',
      color: '#000000',
      fontFamily: 'Arial, sans-serif',
      wordWrap: { width: 120 },
      align: 'center',
    }).setOrigin(0.5, 1).setVisible(false);

    // Container groups all elements and is positioned at world coords
    const container = this.scene.add.container(x, y, [
      bubbleBackground,
      bubbleTail,
      image,
      nameLabel,
      statusDot,
      heartbeatDot,
      energyLabel,
      bubbleText,
    ]);

    // Make interactive for click → open AttributePanel — Req 6.9
    image.setInteractive({ useHandCursor: true });
    image.on('pointerdown', () => {
      useUiStore.getState().selectContestant(contestant.id);
    });

    this.spriteLayer.add(container);

    const group: SpriteGroup = {
      container,
      image,
      nameLabel,
      statusDot,
      heartbeatDot,
      energyLabel,
      bubbleBackground,
      bubbleText,
      bubbleTail,
      healthStatus: 'healthy',
      tween: null,
      bubbleTimer: null,
    };

    this.sprites.set(contestant.id, group);
    this.applyStatusStyle(group, contestant.status);
  }

  /** Update an existing contestant sprite (position, status, energy). */
  updateContestant(contestant: Contestant): void {
    const group = this.sprites.get(contestant.id);
    if (!group) {
      this.addContestant(contestant);
      return;
    }

    // Update name label
    group.nameLabel.setText(contestant.name);

    // Update status dot color — Req 1.8
    group.statusDot.setFillStyle(STATUS_DOT_COLORS[contestant.status] ?? 0x9e9e9e);

    // Update energy label visibility — Req 11.7
    group.energyLabel.setVisible(contestant.energy === 0);

    // Apply timeout/normal style — Req 9.7
    this.applyStatusStyle(group, contestant.status);

    // Animate to new position — Req 6.4
    const { x, y } = contestant.position;
    const currentX = group.container.x;
    const currentY = group.container.y;

    if (currentX !== x || currentY !== y) {
      this.tweenTo(group, x, y);
    }
  }

  /** Remove a contestant sprite. */
  removeContestant(id: string): void {
    const group = this.sprites.get(id);
    if (!group) return;

    group.tween?.stop();
    group.container.destroy();
    this.sprites.delete(id);
  }

  /** Show a speech bubble above the contestant sprite. */
  showSpeechBubble(id: string, content: string, durationMs: number = 6000): void {
    const group = this.sprites.get(id);
    if (!group) return;

    // Clear existing timer
    if (group.bubbleTimer) {
      clearTimeout(group.bubbleTimer);
      group.bubbleTimer = null;
    }

    const padding = 8;
    const maxWidth = 130;
    const yOffset = -(SPRITE_SIZE / 2 + 16);

    // Set text first to measure bounds
    group.bubbleText
      .setText(content)
      .setWordWrapWidth(maxWidth)
      .setVisible(true);

    const textW = Math.min(group.bubbleText.width, maxWidth);
    const textH = group.bubbleText.height;
    const boxW = textW + padding * 2;
    const boxH = textH + padding * 2;
    const boxX = -boxW / 2;
    const boxY = yOffset - boxH;

    // Reposition text inside box
    group.bubbleText.setPosition(0, yOffset - padding);

    // Draw bubble background
    group.bubbleBackground.clear();
    group.bubbleBackground.fillStyle(0xffffff, 0.95);
    group.bubbleBackground.lineStyle(1.5, 0x333333, 1);
    group.bubbleBackground.fillRoundedRect(boxX, boxY, boxW, boxH, 6);
    group.bubbleBackground.strokeRoundedRect(boxX, boxY, boxW, boxH, 6);
    group.bubbleBackground.setVisible(true);

    // Draw tail (small triangle pointing down toward sprite)
    group.bubbleTail.clear();
    group.bubbleTail.fillStyle(0xffffff, 0.95);
    group.bubbleTail.lineStyle(1.5, 0x333333, 1);
    group.bubbleTail.fillTriangle(-6, yOffset, 6, yOffset, 0, yOffset + 8);
    group.bubbleTail.strokeTriangle(-6, yOffset, 6, yOffset, 0, yOffset + 8);
    group.bubbleTail.setVisible(true);

    // Auto-hide after duration
    group.bubbleTimer = setTimeout(() => {
      this.hideSpeechBubble(id);
    }, durationMs);
  }

  /** Hide the speech bubble for a contestant. */
  hideSpeechBubble(id: string): void {
    const group = this.sprites.get(id);
    if (!group) return;
    group.bubbleBackground.clear().setVisible(false);
    group.bubbleTail.clear().setVisible(false);
    group.bubbleText.setVisible(false);
    if (group.bubbleTimer) {
      clearTimeout(group.bubbleTimer);
      group.bubbleTimer = null;
    }
  }

  /** Update heartbeat health status color — Req 9.11 */
  updateHeartbeatStatus(id: string, healthStatus: HealthStatus): void {    const group = this.sprites.get(id);
    if (!group) return;

    group.healthStatus = healthStatus;
    group.heartbeatDot.setFillStyle(HEARTBEAT_COLORS[healthStatus]);

    // Timeout → gray semi-transparent — Req 9.7
    if (healthStatus === 'timeout') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0xaaaaaa);
    } else if (healthStatus === 'offline') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0x888888);
    } else {
      group.container.setAlpha(NORMAL_ALPHA);
      group.image.clearTint();
    }
  }

  /** Destroy all sprites and unsubscribe from store. */
  destroy(): void {
    this.unsubscribeStore?.();
    this.sprites.forEach((group) => {
      group.tween?.stop();
      if (group.bubbleTimer) clearTimeout(group.bubbleTimer);
      group.container.destroy();
    });
    this.sprites.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Apply visual style based on connection status.
   * Timeout → gray semi-transparent (Req 9.7).
   */
  private applyStatusStyle(group: SpriteGroup, status: Contestant['status']): void {
    if (status === 'timeout') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0xaaaaaa);
    } else if (status === 'offline') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0x888888);
    } else {
      // Only restore if heartbeat isn't already forcing timeout style
      if (group.healthStatus !== 'timeout' && group.healthStatus !== 'offline') {
        group.container.setAlpha(NORMAL_ALPHA);
        group.image.clearTint();
      }
    }
  }

  /**
   * Tween container to (x, y) with duration proportional to distance.
   * Duration clamped to [400ms, 1500ms] — Req 6.4.
   */
  private tweenTo(group: SpriteGroup, x: number, y: number): void {
    // Stop any in-progress tween
    group.tween?.stop();

    const dx = x - group.container.x;
    const dy = y - group.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Calculate duration based on distance and movement speed
    // Longer distances = longer duration, but clamped to reasonable range
    const duration = Phaser.Math.Clamp(dist / MOVEMENT_SPEED, TWEEN_MIN_MS, TWEEN_MAX_MS);

    group.tween = this.scene.tweens.add({
      targets: group.container,
      x,
      y,
      duration,
      ease: 'Quad.easeInOut',
      onComplete: () => {
        group.tween = null;
      },
    });
  }

  // ── Store subscription ──────────────────────────────────────────────────────

  /**
   * Subscribe to gameStore to automatically sync contestant changes.
   * Handles add / update / remove.
   */
  private subscribeToStore(): void {
    // Sync current state immediately
    const currentState = useGameStore.getState();
    currentState.contestants.forEach((c) => this.addContestant(c));

    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      const current = state.contestants;
      const previous = prev.contestants;

      // Added or updated
      current.forEach((contestant, id) => {
        if (!previous.has(id)) {
          this.addContestant(contestant);
        } else if (contestant !== previous.get(id)) {
          this.updateContestant(contestant);
        }
      });

      // Removed
      previous.forEach((_c, id) => {
        if (!current.has(id)) {
          this.removeContestant(id);
        }
      });

      // Speech bubbles
      state.speechBubbles.forEach((bubble, id) => {
        const prevBubble = prev.speechBubbles.get(id);
        if (bubble !== prevBubble) {
          const remaining = bubble.expireAt - Date.now();
          if (remaining > 0) {
            this.showSpeechBubble(id, bubble.content, remaining);
          }
        }
      });
      // Hide removed bubbles
      prev.speechBubbles.forEach((_b, id) => {
        if (!state.speechBubbles.has(id)) {
          this.hideSpeechBubble(id);
        }
      });
    });
  }
}
