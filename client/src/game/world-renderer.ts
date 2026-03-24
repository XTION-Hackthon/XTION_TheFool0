import Phaser from 'phaser';
import type { Wall, Obstacle } from '../stores/collisionStore';

/**
 * WorldRenderer — Renders zone walls and obstacles in a single Phaser Scene.
 * Requirements: 1.2, 1.3, 2.4, 3.4, 6.3, 9.1, 9.6
 */
export class WorldRenderer {
  private scene: Phaser.Scene;
  private wallGraphics: Phaser.GameObjects.Graphics | null = null;
  private obstacleGraphics: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Render walls as solid rectangles.
   */
  renderWalls(walls: Wall[]): void {
    if (this.wallGraphics) {
      this.wallGraphics.destroy();
    }
    this.wallGraphics = this.scene.add.graphics();
    this.wallGraphics.setDepth(2);

    for (const wall of walls) {
      if (!wall) continue;
      this.wallGraphics.fillStyle(0x4466aa, 0.8);
      this.wallGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
      this.wallGraphics.lineStyle(1, 0x6688cc, 1);
      this.wallGraphics.strokeRect(wall.x, wall.y, wall.width, wall.height);
    }
  }

  /**
   * Render obstacles (rocks, trees, boxes, etc.) as distinct colored rectangles.
   */
  renderObstacles(obstacles: Obstacle[]): void {
    if (this.obstacleGraphics) {
      this.obstacleGraphics.destroy();
    }
    this.obstacleGraphics = this.scene.add.graphics();
    this.obstacleGraphics.setDepth(2);

    for (const obs of obstacles) {
      if (!obs) continue;
      this.obstacleGraphics.fillStyle(0x886644, 0.85);
      this.obstacleGraphics.fillRect(obs.x, obs.y, obs.width, obs.height);
      this.obstacleGraphics.lineStyle(1, 0xaa8855, 1);
      this.obstacleGraphics.strokeRect(obs.x, obs.y, obs.width, obs.height);
    }
  }

  /**
   * Destroy all rendered objects.
   */
  destroy(): void {
    this.wallGraphics?.destroy();
    this.wallGraphics = null;
    this.obstacleGraphics?.destroy();
    this.obstacleGraphics = null;
  }
}
