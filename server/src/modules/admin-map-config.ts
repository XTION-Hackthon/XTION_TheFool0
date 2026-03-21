// =============================================================================
// XTION_TheFool0 — Admin map config persistence
// =============================================================================

import { db } from '../db';

export interface AdminMapConfig {
  backgroundImage: string | null;
  updatedAt: number;
}

const CONFIG_ROW_ID = 1;

function ensureConfigRow(): void {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_map_config (
      id INTEGER PRIMARY KEY,
      background_image TEXT,
      updated_at INTEGER NOT NULL
    )
  `).run();
  db.prepare(
    'INSERT OR IGNORE INTO admin_map_config (id, background_image, updated_at) VALUES (?, NULL, ?)',
  ).run(CONFIG_ROW_ID, Date.now());
}

class AdminMapConfigStore {
  getConfig(): AdminMapConfig {
    ensureConfigRow();
    const row = db.prepare(
      'SELECT background_image, updated_at FROM admin_map_config WHERE id = ?',
    ).get(CONFIG_ROW_ID) as { background_image: string | null; updated_at: number } | undefined;

    return {
      backgroundImage: row?.background_image ?? null,
      updatedAt: row?.updated_at ?? Date.now(),
    };
  }

  updateBackgroundImage(backgroundImage: string | null): AdminMapConfig {
    ensureConfigRow();
    const updatedAt = Date.now();
    db.prepare(
      'UPDATE admin_map_config SET background_image = ?, updated_at = ? WHERE id = ?',
    ).run(backgroundImage, updatedAt, CONFIG_ROW_ID);

    return {
      backgroundImage,
      updatedAt,
    };
  }
}

export const adminMapConfigStore = new AdminMapConfigStore();
