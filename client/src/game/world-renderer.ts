import Phaser from 'phaser';
import { Room, Wall } from '../stores/roomStore';
import { Doorway } from '../stores/doorwayStore';

/**
 * WorldRenderer — Renders all rooms, walls, and doorways in a single Phaser Scene.
 * Requirements: 1.2, 1.3, 2.4, 3.4, 6.3, 9.1, 9.6
 */
export class WorldRenderer {
  private scene: Phaser.Scene;
  private roomGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private wallGraphics: Phaser.GameObjects.Graphics | null = null;
  private doorwayGraphics: Phaser.GameObjects.Graphics | null = null;
  private roomLabels: Map<string, Phaser.GameObjects.Text> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Render all room boundary rectangles.
   * Each room gets a semi-transparent fill with a border.
   */
  renderRooms(rooms: Room[]): void {
    // Clear existing room graphics
    for (const [, gfx] of this.roomGraphics) {
      gfx.destroy();
    }
    this.roomGraphics.clear();
    for (const [, label] of this.roomLabels) {
      label.destroy();
    }
    this.roomLabels.clear();

    for (const room of rooms) {
      if (!room.bounds) continue;
      const { x1, y1, x2, y2 } = room.bounds;
      const w = x2 - x1;
      const h = y2 - y1;

      const gfx = this.scene.add.graphics();
      // Semi-transparent room fill
      gfx.fillStyle(0xe8f4f8, 0.15);
      gfx.fillRect(x1, y1, w, h);
      // Room border
      gfx.lineStyle(2, 0x4a9eca, 0.6);
      gfx.strokeRect(x1, y1, w, h);
      gfx.setDepth(0);

      this.roomGraphics.set(room.id, gfx);

      // Room name label
      const label = this.scene.add.text(x1 + 8, y1 + 8, room.name, {
        fontSize: '14px',
        color: '#4a9eca',
        stroke: '#000000',
        strokeThickness: 2,
        fontFamily: 'Arial, sans-serif',
      });
      label.setDepth(1);
      this.roomLabels.set(room.id, label);
    }
  }

  /**
   * Render walls, leaving gaps at doorway positions.
   * Walls are rendered as solid rectangles; doorway areas are skipped.
   */
  renderWalls(walls: Wall[], doorways: Doorway[]): void {
    if (this.wallGraphics) {
      this.wallGraphics.destroy();
    }
    this.wallGraphics = this.scene.add.graphics();
    this.wallGraphics.setDepth(2);

    for (const wall of walls) {
      if (!wall) continue; // Skip undefined walls
      // Check if this wall is fully covered by a doorway
      // If the wall overlaps a doorway, we render the wall in segments
      // For simplicity: render the wall, but doorway areas will be rendered on top
      this.wallGraphics.fillStyle(0x4466aa, 0.8);
      this.wallGraphics.fillRect(wall.x, wall.y, wall.width, wall.height);
      this.wallGraphics.lineStyle(1, 0x6688cc, 1);
      this.wallGraphics.strokeRect(wall.x, wall.y, wall.width, wall.height);
    }

    // Erase doorway areas by drawing the background color over them
    // This creates the visual "gap" in the wall
    for (const dw of doorways) {
      if (!dw) continue; // Skip undefined doorways
      const halfW = dw.width / 2;
      const halfH = dw.height / 2;
      // Draw a clear rectangle over the doorway area to create the gap
      this.wallGraphics.fillStyle(0x1a1a2e, 1.0); // Match background color
      this.wallGraphics.fillRect(dw.x - halfW, dw.y - halfH, dw.width, dw.height);
    }
  }

  /**
   * Render doorway markers with dashed/highlighted style.
   */
  renderDoorways(doorways: Doorway[]): void {
    if (this.doorwayGraphics) {
      this.doorwayGraphics.destroy();
    }
    this.doorwayGraphics = this.scene.add.graphics();
    this.doorwayGraphics.setDepth(3);

    for (const dw of doorways) {
      const halfW = dw.width / 2;
      const halfH = dw.height / 2;
      const x = dw.x - halfW;
      const y = dw.y - halfH;

      // Highlight doorway opening with a colored border
      this.doorwayGraphics.lineStyle(2, 0x44cc88, 0.9);
      this.doorwayGraphics.strokeRect(x, y, dw.width, dw.height);

      // Small arrow/indicator in the center
      this.doorwayGraphics.fillStyle(0x44cc88, 0.4);
      this.doorwayGraphics.fillRect(x, y, dw.width, dw.height);
    }
  }

  /**
   * Update a single room's rendering.
   */
  updateRoom(room: Room): void {
    const existing = this.roomGraphics.get(room.id);
    if (existing) {
      existing.destroy();
      this.roomGraphics.delete(room.id);
    }
    const existingLabel = this.roomLabels.get(room.id);
    if (existingLabel) {
      existingLabel.destroy();
      this.roomLabels.delete(room.id);
    }

    if (!room.bounds) return;
    const { x1, y1, x2, y2 } = room.bounds;
    const w = x2 - x1;
    const h = y2 - y1;

    const gfx = this.scene.add.graphics();
    gfx.fillStyle(0xe8f4f8, 0.15);
    gfx.fillRect(x1, y1, w, h);
    gfx.lineStyle(2, 0x4a9eca, 0.6);
    gfx.strokeRect(x1, y1, w, h);
    gfx.setDepth(0);
    this.roomGraphics.set(room.id, gfx);

    const label = this.scene.add.text(x1 + 8, y1 + 8, room.name, {
      fontSize: '14px',
      color: '#4a9eca',
      stroke: '#000000',
      strokeThickness: 2,
      fontFamily: 'Arial, sans-serif',
    });
    label.setDepth(1);
    this.roomLabels.set(room.id, label);
  }

  /**
   * Destroy all rendered objects.
   */
  destroy(): void {
    for (const [, gfx] of this.roomGraphics) {
      gfx.destroy();
    }
    this.roomGraphics.clear();
    for (const [, label] of this.roomLabels) {
      label.destroy();
    }
    this.roomLabels.clear();
    this.wallGraphics?.destroy();
    this.wallGraphics = null;
    this.doorwayGraphics?.destroy();
    this.doorwayGraphics = null;
  }
}
