/**
 * Phaser game factory — creates and returns a Phaser.Game instance.
 * Requirements: 6.1, 6.2, 6.10
 */

import Phaser from 'phaser';
import { BootScene } from './BootScene';
import { GameScene } from './GameScene';

export { BootScene } from './BootScene';
export { GameScene } from './GameScene';

export function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 1800,
    height: 1000,
    backgroundColor: '#1a1a2e',
    render: {
      pixelArt: true,
      antialias: false,
    },
    // Loader config — increase timeout for large assets
    loader: {
      timeout: 30000,       // 30s timeout (default ~varies by browser)
      maxRetries: 2,        // Phaser built-in retry
    },
    // Target ≥30 FPS (Phaser default is 60; setting min to 30)
    fps: {
      target: 60,
      min: 30,
      forceSetTimeOut: false,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BootScene, GameScene],
    // Disable Phaser banner in console
    banner: false,
  });
}
