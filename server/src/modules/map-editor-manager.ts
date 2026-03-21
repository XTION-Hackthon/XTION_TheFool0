// =============================================================================
// XTION_TheFool0 — MapEditorManager 模块
// Requirements: 6, 7
// =============================================================================

import { randomUUID } from 'crypto';
import { db } from '../db';
import type { Wall, SpawnPoint, ValidationResult } from '../types';

// =============================================================================
// Local Types
// =============================================================================

interface RoomConfiguration {
  roomId: string;
  walls: Wall[];
  spawnPoints: SpawnPoint[];
  bounds?: { x1: number; y1: number; x2: number; y2: number };
  capacity?: number;
}

interface ConfigurationVersion {
  id: string;
  roomId: string;
  version: number;
  configJson: string;
  createdAt: string;
}

// =============================================================================
// DB Row Types
// =============================================================================

interface RoomConfigRow {
  id: string;
  room_id: string;
  config_json: string;
  version: number;
  created_at: string;
}

interface MaxVersionRow {
  max_version: number | null;
}

// =============================================================================
// MapEditorManager Implementation
// =============================================================================

class MapEditorManager {
  // ---------------------------------------------------------------------------
  // Configuration Management
  // ---------------------------------------------------------------------------

  /**
   * Save a room configuration as a new version.
   * - Increments version number
   * - Persists config JSON to room_configs
   * - Replaces walls and spawn_points for the room
   * - Updates room bounds/capacity if provided
   * Requirements: 6, 7
   */
  saveRoomConfiguration(roomId: string, config: RoomConfiguration): void {
    const now = new Date().toISOString();

    // Get current max version for the room
    const row = db
      .prepare('SELECT MAX(version) as max_version FROM room_configs WHERE room_id = ?')
      .get(roomId) as MaxVersionRow;

    const nextVersion = (row.max_version ?? 0) + 1;

    const saveAll = db.transaction(() => {
      // Insert new config version
      db.prepare(
        'INSERT INTO room_configs (id, room_id, config_json, version, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(randomUUID(), roomId, JSON.stringify(config), nextVersion, now);

      // Replace walls
      db.prepare('DELETE FROM walls WHERE room_id = ?').run(roomId);
      const insertWall = db.prepare(
        'INSERT INTO walls (id, room_id, x, y, width, height, rotation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const wall of config.walls) {
        insertWall.run(
          wall.id ?? randomUUID(),
          roomId,
          wall.x,
          wall.y,
          wall.width,
          wall.height,
          wall.rotation ?? 0,
          wall.createdAt ?? now,
        );
      }

      // Replace spawn points
      db.prepare('DELETE FROM spawn_points WHERE room_id = ?').run(roomId);
      const insertSpawn = db.prepare(
        'INSERT INTO spawn_points (id, room_id, x, y, is_available, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const sp of config.spawnPoints) {
        insertSpawn.run(
          sp.id ?? randomUUID(),
          roomId,
          sp.x,
          sp.y,
          sp.isAvailable ? 1 : 0,
          sp.createdAt ?? now,
        );
      }

      // Update room bounds and capacity if provided
      if (config.bounds || config.capacity !== undefined) {
        const updates: string[] = [];
        const params: unknown[] = [];

        if (config.bounds) {
          updates.push('bounds_x1 = ?', 'bounds_y1 = ?', 'bounds_x2 = ?', 'bounds_y2 = ?');
          params.push(config.bounds.x1, config.bounds.y1, config.bounds.x2, config.bounds.y2);
        }
        if (config.capacity !== undefined) {
          updates.push('capacity = ?');
          params.push(config.capacity);
        }
        updates.push('updated_at = ?');
        params.push(now);
        params.push(roomId);

        db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      }
    });

    saveAll();
  }

  /**
   * Load the latest configuration for a room.
   * Requirements: 6, 7
   */
  loadRoomConfiguration(roomId: string): RoomConfiguration {
    const row = db
      .prepare(
        'SELECT * FROM room_configs WHERE room_id = ? ORDER BY version DESC LIMIT 1',
      )
      .get(roomId) as RoomConfigRow | undefined;

    if (!row) {
      throw new Error(`No configuration found for room: ${roomId}`);
    }

    return JSON.parse(row.config_json) as RoomConfiguration;
  }

  /**
   * Delete all configurations for a room.
   * Requirements: 6, 7
   */
  deleteRoomConfiguration(roomId: string): void {
    db.prepare('DELETE FROM room_configs WHERE room_id = ?').run(roomId);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  /**
   * Validate a full room configuration.
   * Requirements: 6 (AC8), 7 (AC5)
   */
  validateConfiguration(config: RoomConfiguration): ValidationResult {
    const errors: string[] = [];

    // Validate bounds if provided
    if (config.bounds) {
      const { x1, y1, x2, y2 } = config.bounds;
      if (x2 <= x1) {
        errors.push('Bounds x2 must be greater than x1');
      }
      if (y2 <= y1) {
        errors.push('Bounds y2 must be greater than y1');
      }
    }

    // Validate walls
    const wallsResult = this.validateWalls(config.walls);
    if (!wallsResult.valid) {
      errors.push(...wallsResult.errors);
    }

    // Validate spawn points
    const spawnResult = this.validateSpawnPoints(config.spawnPoints);
    if (!spawnResult.valid) {
      errors.push(...spawnResult.errors);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a list of walls.
   * Requirements: 7 (AC5)
   */
  validateWalls(walls: Wall[]): ValidationResult {
    const errors: string[] = [];

    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const prefix = `Wall[${i}]`;

      if (wall.width <= 0) {
        errors.push(`${prefix}: width must be positive (got ${wall.width})`);
      }
      if (wall.height <= 0) {
        errors.push(`${prefix}: height must be positive (got ${wall.height})`);
      }
      if (!Number.isFinite(wall.x)) {
        errors.push(`${prefix}: x must be a finite number`);
      }
      if (!Number.isFinite(wall.y)) {
        errors.push(`${prefix}: y must be a finite number`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a list of spawn points.
   * Requirements: 7 (AC5)
   */
  validateSpawnPoints(points: SpawnPoint[]): ValidationResult {
    const errors: string[] = [];

    for (let i = 0; i < points.length; i++) {
      const sp = points[i];
      const prefix = `SpawnPoint[${i}]`;

      if (!Number.isFinite(sp.x)) {
        errors.push(`${prefix}: x must be a finite number`);
      }
      if (!Number.isFinite(sp.y)) {
        errors.push(`${prefix}: y must be a finite number`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // Version Management
  // ---------------------------------------------------------------------------

  /**
   * Return all configuration versions for a room, newest first.
   * Requirements: 7 (AC4)
   */
  getConfigurationHistory(roomId: string): ConfigurationVersion[] {
    const rows = db
      .prepare(
        'SELECT * FROM room_configs WHERE room_id = ? ORDER BY version DESC',
      )
      .all(roomId) as RoomConfigRow[];

    return rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      version: row.version,
      configJson: row.config_json,
      createdAt: row.created_at,
    }));
  }

  /**
   * Roll back to a specific version by re-saving it as a new version.
   * Requirements: 7 (AC4)
   */
  rollbackConfiguration(roomId: string, versionId: string): void {
    const row = db
      .prepare('SELECT * FROM room_configs WHERE id = ? AND room_id = ?')
      .get(versionId, roomId) as RoomConfigRow | undefined;

    if (!row) {
      throw new Error(`Configuration version not found: ${versionId} for room ${roomId}`);
    }

    const config = JSON.parse(row.config_json) as RoomConfiguration;
    this.saveRoomConfiguration(roomId, config);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const mapEditorManager = new MapEditorManager();
