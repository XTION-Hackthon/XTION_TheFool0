/**
 * BootScene — Phaser 3 preload scene
 * Loads background image and sprite assets before starting GameScene.
 * Requirements: 6.1
 */

import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  private mapLoadFailed = false;
  private failedTextures = new Set<string>();

  preload(): void {
    const { width, height } = this.scale;
    const bar = this.add.graphics();
    const bg = this.add.graphics();

    bg.fillStyle(0x222222);
    bg.fillRect(width / 2 - 160, height / 2 - 15, 320, 30);

    this.load.on('progress', (value: number) => {
      bar.clear();
      bar.fillStyle(0x4caf50);
      bar.fillRect(width / 2 - 158, height / 2 - 13, 316 * value, 26);
    });

    // Increase timeout for large assets (default is often too short for 4MB PNG)
    this.load.maxParallelDownloads = 2;

    // Character sprites
    this.load.image('ghost', '/maps/ghost.png');
    this.load.image('leftmove', '/maps/leftmove.png');
    this.load.image('rightmove', '/maps/rightmove.png');

    // Map background
    this.load.image('map_bg', `/maps/MainHall1800x1000.png?t=${Date.now()}`);

    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.warn(`[BootScene] Failed to load: ${file.key} (${file.url})`);
      this.failedTextures.add(file.key as string);
      if (file.key === 'map_bg') {
        this.mapLoadFailed = true;
      }
    });
  }

  create(): void {
    if (this.mapLoadFailed || !this.textures.exists('map_bg')) {
      console.warn('[BootScene] map_bg not available, retrying load once...');
      this.retryMapLoad();
      return; // retryMapLoad will call finishCreate when done
    }

    this.finishCreate();
  }

  /**
   * Retry loading the map image once. If it fails again, use fallback.
   */
  private retryMapLoad(): void {
    // Remove failed texture entry if it exists
    if (this.textures.exists('map_bg')) {
      this.textures.remove('map_bg');
    }

    this.load.once('filecomplete-image-map_bg', () => {
      console.log('[BootScene] map_bg loaded on retry');
      this.finishCreate();
    });

    this.load.once('loaderror', () => {
      console.warn('[BootScene] map_bg retry failed, using fallback');
      this.createFallbackBackground();
      this.finishCreate();
    });

    this.load.image('map_bg', `/maps/MainHall1800x1000.png?retry=${Date.now()}`);
    this.load.start();
  }

  private finishCreate(): void {
    if (!this.textures.exists('map_bg')) {
      this.createFallbackBackground();
    }

    // Generate fallback textures for any sprite images that failed to load
    if (!this.textures.exists('ghost') || this.failedTextures.has('ghost')) {
      this.createFallbackGhost();
    }
    if (!this.textures.exists('leftmove') || this.failedTextures.has('leftmove')) {
      this.createFallbackGhost('leftmove');
    }
    if (!this.textures.exists('rightmove') || this.failedTextures.has('rightmove')) {
      this.createFallbackGhost('rightmove');
    }

    this.createZoneTypeTextures();
    this.createContestantTexture();
    this.scene.start('GameScene');
  }

  /** Fallback ghost sprite — simple colored circle with eyes */
  private createFallbackGhost(key = 'ghost'): void {
    const S = 48;
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    // Body
    gfx.fillStyle(0x7c4dff);
    gfx.fillCircle(S / 2, S * 0.4, S * 0.38);
    gfx.fillRect(S * 0.12, S * 0.4, S * 0.76, S * 0.45);
    // Wavy bottom
    gfx.fillStyle(0x7c4dff);
    for (let i = 0; i < 3; i++) {
      gfx.fillCircle(S * (0.2 + i * 0.3), S * 0.85, S * 0.13);
    }
    // Eyes
    gfx.fillStyle(0xffffff);
    gfx.fillCircle(S * 0.35, S * 0.38, S * 0.1);
    gfx.fillCircle(S * 0.65, S * 0.38, S * 0.1);
    gfx.fillStyle(0x000000);
    gfx.fillCircle(S * 0.37, S * 0.39, S * 0.05);
    gfx.fillCircle(S * 0.67, S * 0.39, S * 0.05);
    gfx.generateTexture(key, S, S);
    gfx.destroy();
  }

  private createFallbackBackground(): void {
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    const w = 1800;
    const h = 1000;

    // Simple stone floor
    gfx.fillStyle(0x8b8b7a);
    gfx.fillRect(0, 0, w, h);

    // Checkerboard pattern
    for (let y = 0; y < h; y += 40) {
      for (let x = 0; x < w; x += 40) {
        if ((Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0) {
          gfx.fillStyle(0x9a9a89);
          gfx.fillRect(x, y, 40, 40);
        }
      }
    }

    // Grid lines
    gfx.lineStyle(1, 0x6b6b5a, 0.4);
    for (let y = 0; y <= h; y += 40) gfx.lineBetween(0, y, w, y);
    for (let x = 0; x <= w; x += 40) gfx.lineBetween(x, 0, x, h);

    gfx.generateTexture('map_bg', w, h);
    gfx.destroy();
  }

  private createZoneTypeTextures(): void {
    const icons: Array<{ key: string; color: number; detail: (g: Phaser.GameObjects.Graphics) => void }> = [
      { key: 'icon_rest', color: 0x2196f3, detail: (g) => { g.fillStyle(0xffffff); g.fillRect(10, 12, 12, 3); } },
      { key: 'icon_work', color: 0xff9800, detail: (g) => { g.fillStyle(0xffffff); g.fillRect(10, 10, 12, 12); } },
      { key: 'icon_social', color: 0x4caf50, detail: (g) => { g.fillStyle(0xffffff); g.fillCircle(16, 14, 7); } },
      { key: 'icon_default', color: 0x9e9e9e, detail: () => {} },
    ];

    for (const icon of icons) {
      const gfx = this.make.graphics({ x: 0, y: 0 }, false);
      gfx.fillStyle(icon.color);
      gfx.fillCircle(16, 16, 14);
      icon.detail(gfx);
      gfx.generateTexture(icon.key, 32, 32);
      gfx.destroy();
    }
  }

  private createContestantTexture(): void {
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    const S = 32;
    gfx.fillStyle(0xc62828);
    gfx.fillEllipse(S / 2, S * 0.6, S * 0.7, S * 0.55);
    gfx.fillStyle(0xb71c1c);
    gfx.fillRect(S * 0.2, S * 0.45, S * 0.6, 3);
    gfx.fillRect(S * 0.2, S * 0.6, S * 0.6, 3);
    gfx.fillStyle(0xe53935);
    gfx.fillCircle(S / 2, S * 0.3, S * 0.25);
    gfx.fillStyle(0x000000);
    gfx.fillCircle(S * 0.38, S * 0.25, 2);
    gfx.fillCircle(S * 0.62, S * 0.25, 2);
    gfx.fillStyle(0xc62828);
    gfx.fillEllipse(S * 0.12, S * 0.55, S * 0.2, S * 0.15);
    gfx.fillEllipse(S * 0.88, S * 0.55, S * 0.2, S * 0.15);
    gfx.lineStyle(1, 0xff8a80);
    gfx.lineBetween(S * 0.38, S * 0.1, S * 0.2, 0);
    gfx.lineBetween(S * 0.62, S * 0.1, S * 0.8, 0);
    gfx.generateTexture('contestant', S, S);
    gfx.destroy();
  }
}
