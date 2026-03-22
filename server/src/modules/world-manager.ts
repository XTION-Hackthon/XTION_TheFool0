// =============================================================================
// XTION_TheFool0 — WorldManager 模块
// Requirements: 2.1, 2.6, 2.7, 2.8, 11.4, 11.5, 11.6
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import type {
  IWorldManager,
  Position,
  Zone,
  ZoneBounds,
  ZoneStyle,
  ZoneType,
  ZoneRule,
  AttributeEffect,
} from '../types';

// =============================================================================
// DB Row Types
// =============================================================================

interface ZoneRow {
  id: string;
  name: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  zone_type_id: string;
  fill_color: string;
  border_color: string;
  opacity: number;
  icon: string | null;
  access_restriction: string | null;
}

interface ZoneTypeRow {
  id: string;
  name: string;
  description: string;
  is_builtin: number;
}

interface ZoneRuleRow {
  id: string;
  zone_type_id: string;
  allowed_apis: string;
  forbidden_apis: string;
  rate_limits: string;
  attribute_effects: string;
  custom_params: string;
}

interface ContestantEnergyRow {
  energy: number;
}

// =============================================================================
// Helpers
// =============================================================================

function rowToZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    name: row.name,
    bounds: { x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2 },
    zoneTypeId: row.zone_type_id,
    style: {
      fillColor: row.fill_color,
      borderColor: row.border_color,
      opacity: row.opacity,
      ...(row.icon ? { icon: row.icon } : {}),
    },
    ...(row.access_restriction
      ? { accessRestriction: JSON.parse(row.access_restriction) as string[] }
      : {}),
  };
}

function rowToZoneRule(row: ZoneRuleRow): ZoneRule {
  return {
    allowedAPIs: JSON.parse(row.allowed_apis) as string[],
    forbiddenAPIs: JSON.parse(row.forbidden_apis) as string[],
    rateLimits: JSON.parse(row.rate_limits) as Record<string, number>,
    attributeEffects: JSON.parse(row.attribute_effects) as AttributeEffect[],
    customParams: JSON.parse(row.custom_params) as Record<string, unknown>,
  };
}

/** 默认 ZoneRule（当找不到规则时使用） */
const DEFAULT_ZONE_RULE: ZoneRule = {
  allowedAPIs: ['*'],
  forbiddenAPIs: [],
  rateLimits: {},
  attributeEffects: [],
  customParams: {},
};

// =============================================================================
// WorldManager Implementation
// =============================================================================

class WorldManager implements IWorldManager {
  /** Position 热数据缓存：contestantId → Position */
  private positionCache = new Map<string, Position>();

  /** Energy 热数据缓存：contestantId → energy */
  private energyCache = new Map<string, number>();

  // ---------------------------------------------------------------------------
  // Position 管理
  // ---------------------------------------------------------------------------

  /**
   * 设置 Contestant 的 Position（内存缓存 + 数据库持久化）
   * Requirements: 2.6
   */
  async setPosition(contestantId: string, position: Position): Promise<void> {
    this.positionCache.set(contestantId, position);

    // 计算所在 Zone
    const zone = this.getZoneAt(position);

    db.prepare(`
      UPDATE contestants
      SET position_x = ?, position_y = ?, current_zone_id = ?
      WHERE id = ?
    `).run(position.x, position.y, zone?.id ?? null, contestantId);
  }

  /**
   * 获取 Contestant 的 Position（优先从内存缓存读取）
   * Requirements: 2.6
   */
  async getPosition(contestantId: string): Promise<Position> {
    const cached = this.positionCache.get(contestantId);
    if (cached) return cached;

    const row = db.prepare(`
      SELECT position_x, position_y FROM contestants WHERE id = ?
    `).get(contestantId) as { position_x: number; position_y: number } | undefined;

    if (!row) {
      throw new Error(`Contestant not found: ${contestantId}`);
    }

    const position: Position = { x: row.position_x, y: row.position_y };
    this.positionCache.set(contestantId, position);
    return position;
  }

  // ---------------------------------------------------------------------------
  // Zone 查询
  // ---------------------------------------------------------------------------

  /**
   * 根据坐标查找所在 Zone（x1 <= x <= x2 && y1 <= y <= y2）
   * Requirements: 2.7
   */
  getZoneAt(position: Position): Zone | null {
    const rows = db.prepare(`
      SELECT * FROM zones
    `).all() as ZoneRow[];

    for (const row of rows) {
      if (
        position.x >= row.x1 &&
        position.x <= row.x2 &&
        position.y >= row.y1 &&
        position.y <= row.y2
      ) {
        return rowToZone(row);
      }
    }

    return null;
  }

  /**
   * 获取指定 Zone 内的所有 Contestant ID 列表
   * Requirements: 2.7
   */
  getContestantsInZone(zoneId: string): string[] {
    const rows = db.prepare(`
      SELECT id FROM contestants WHERE current_zone_id = ? AND status != 'offline'
    `).all(zoneId) as { id: string }[];

    return rows.map((r) => r.id);
  }

  // ---------------------------------------------------------------------------
  // Zone_Rule 应用
  // ---------------------------------------------------------------------------

  /**
   * 获取 Contestant 当前适用的 ZoneRule
   * Requirements: 11.4, 11.5, 11.6
   */
  getApplicableRules(contestantId: string): ZoneRule {
    const contestant = db.prepare(`
      SELECT current_zone_id FROM contestants WHERE id = ?
    `).get(contestantId) as { current_zone_id: string | null } | undefined;

    if (!contestant?.current_zone_id) {
      return DEFAULT_ZONE_RULE;
    }

    const zone = db.prepare(`
      SELECT zone_type_id FROM zones WHERE id = ?
    `).get(contestant.current_zone_id) as { zone_type_id: string } | undefined;

    if (!zone) {
      return DEFAULT_ZONE_RULE;
    }

    const ruleRow = db.prepare(`
      SELECT * FROM zone_rules WHERE zone_type_id = ?
    `).get(zone.zone_type_id) as ZoneRuleRow | undefined;

    if (!ruleRow) {
      return DEFAULT_ZONE_RULE;
    }

    return rowToZoneRule(ruleRow);
  }

  /**
   * 检查 Contestant 是否允许调用指定 API
   * - allowedAPIs 包含 '*' 表示全部允许
   * - forbiddenAPIs 优先级高于 allowedAPIs
   * Requirements: 11.4, 11.5, 11.6
   */
  isAPIAllowed(contestantId: string, apiName: string): boolean {
    const rule = this.getApplicableRules(contestantId);

    // forbiddenAPIs 优先
    if (rule.forbiddenAPIs.includes(apiName)) {
      return false;
    }

    // allowedAPIs 包含 '*' 或具体 API 名称
    if (rule.allowedAPIs.includes('*') || rule.allowedAPIs.includes(apiName)) {
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Energy 管理
  // ---------------------------------------------------------------------------

  /**
   * 获取 Contestant 的 Energy（优先从内存缓存读取，初始值 100）
   * Requirements: 11.4, 11.5, 11.6
   */
  getEnergy(contestantId: string): number {
    const cached = this.energyCache.get(contestantId);
    if (cached !== undefined) return cached;

    const row = db.prepare(`
      SELECT energy FROM contestants WHERE id = ?
    `).get(contestantId) as ContestantEnergyRow | undefined;

    const energy = row?.energy ?? 100;
    this.energyCache.set(contestantId, energy);
    return energy;
  }

  /**
   * 修改 Contestant 的 Energy（内存缓存 + 数据库持久化），返回新值
   * Energy 最小值为 0，最大值为 100
   * Requirements: 11.4, 11.5, 11.6
   */
  async modifyEnergy(contestantId: string, delta: number): Promise<number> {
      // Atomic database-level update: clamp energy to [0, 100] in a single SQL statement
      db.prepare(`
        UPDATE contestants SET energy = MAX(0, MIN(100, energy + ?)) WHERE id = ?
      `).run(delta, contestantId);

      // Re-read the actual value from the database and refresh the cache
      const row = db.prepare(`
        SELECT energy FROM contestants WHERE id = ?
      `).get(contestantId) as ContestantEnergyRow | undefined;

      const newEnergy = row?.energy ?? 100;
      this.energyCache.set(contestantId, newEnergy);

      return newEnergy;
    }

  // ---------------------------------------------------------------------------
  // Zone CRUD（管理员，任务 4.3 完整实现，此处提供基础骨架）
  // ---------------------------------------------------------------------------

  async createZone(zone: Omit<Zone, 'id'>): Promise<Zone> {
    const id = uuidv4();
    const { bounds, style, zoneTypeId, name, accessRestriction } = zone;

    db.prepare(`
      INSERT INTO zones (id, name, x1, y1, x2, y2, zone_type_id, fill_color, border_color, opacity, icon, access_restriction)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      bounds.x1,
      bounds.y1,
      bounds.x2,
      bounds.y2,
      zoneTypeId,
      style.fillColor,
      style.borderColor,
      style.opacity,
      style.icon ?? null,
      accessRestriction ? JSON.stringify(accessRestriction) : null,
    );

    return { id, ...zone };
  }

  async updateZone(zoneId: string, updates: Partial<Zone>): Promise<Zone> {
    const existing = db.prepare('SELECT * FROM zones WHERE id = ?').get(zoneId) as ZoneRow | undefined;
    if (!existing) throw new Error(`Zone not found: ${zoneId}`);

    const merged = rowToZone(existing);

    if (updates.name !== undefined) merged.name = updates.name;
    if (updates.bounds !== undefined) merged.bounds = updates.bounds;
    if (updates.zoneTypeId !== undefined) merged.zoneTypeId = updates.zoneTypeId;
    if (updates.style !== undefined) merged.style = updates.style;
    if (updates.accessRestriction !== undefined) merged.accessRestriction = updates.accessRestriction;

    db.prepare(`
      UPDATE zones
      SET name = ?, x1 = ?, y1 = ?, x2 = ?, y2 = ?, zone_type_id = ?,
          fill_color = ?, border_color = ?, opacity = ?, icon = ?, access_restriction = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.bounds.x1,
      merged.bounds.y1,
      merged.bounds.x2,
      merged.bounds.y2,
      merged.zoneTypeId,
      merged.style.fillColor,
      merged.style.borderColor,
      merged.style.opacity,
      merged.style.icon ?? null,
      merged.accessRestriction ? JSON.stringify(merged.accessRestriction) : null,
      zoneId,
    );

    return merged;
  }

  async deleteZone(zoneId: string): Promise<void> {
    const result = db.prepare('DELETE FROM zones WHERE id = ?').run(zoneId);
    if (result.changes === 0) throw new Error(`Zone not found: ${zoneId}`);
  }

  // ---------------------------------------------------------------------------
  // Zone_Type CRUD（管理员，任务 4.3 完整实现，此处提供基础骨架）
  // ---------------------------------------------------------------------------

  async createZoneType(zoneType: Omit<ZoneType, 'id'>): Promise<ZoneType> {
    const id = uuidv4();
    const { name, description, isBuiltin, rule } = zoneType;

    db.prepare(`
      INSERT INTO zone_types (id, name, description, is_builtin)
      VALUES (?, ?, ?, ?)
    `).run(id, name, description, isBuiltin ? 1 : 0);

    db.prepare(`
      INSERT INTO zone_rules (id, zone_type_id, allowed_apis, forbidden_apis, rate_limits, attribute_effects, custom_params)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      id,
      JSON.stringify(rule.allowedAPIs),
      JSON.stringify(rule.forbiddenAPIs),
      JSON.stringify(rule.rateLimits),
      JSON.stringify(rule.attributeEffects),
      JSON.stringify(rule.customParams),
    );

    return { id, ...zoneType };
  }

  async updateZoneRule(zoneTypeId: string, rule: ZoneRule): Promise<void> {
    if (rule.allowedAPIs?.length && rule.forbiddenAPIs?.length) {
      const conflicting = rule.allowedAPIs.filter(api => rule.forbiddenAPIs.includes(api));
      if (conflicting.length > 0) {
        throw new Error(`Zone rule conflict: APIs [${conflicting.join(', ')}] appear in both allowedAPIs and forbiddenAPIs`);
      }
    }

    const result = db.prepare(`
      UPDATE zone_rules
      SET allowed_apis = ?, forbidden_apis = ?, rate_limits = ?, attribute_effects = ?, custom_params = ?
      WHERE zone_type_id = ?
    `).run(
      JSON.stringify(rule.allowedAPIs),
      JSON.stringify(rule.forbiddenAPIs),
      JSON.stringify(rule.rateLimits),
      JSON.stringify(rule.attributeEffects),
      JSON.stringify(rule.customParams),
      zoneTypeId,
    );

    if (result.changes === 0) throw new Error(`ZoneType not found: ${zoneTypeId}`);
  }

  // ---------------------------------------------------------------------------
  // 辅助方法（供其他模块使用）
  // ---------------------------------------------------------------------------

  /**
   * 获取 Map 尺寸（从所有 Zone 的边界框推导）
   */
  getMapDimensions(): { width: number; height: number } {
    const result = db.prepare(`
      SELECT MAX(x2) as width, MAX(y2) as height FROM zones
    `).get() as { width: number | null; height: number | null };

    return {
      width: result.width ?? 1000,
      height: result.height ?? 800,
    };
  }

  /**
   * 获取默认 Zone（数据库中第一个 Zone，用于 Contestant 初始放置）
   * Requirements: 2.8
   */
  getDefaultZone(): Zone | null {
    const row = db.prepare('SELECT * FROM zones LIMIT 1').get() as ZoneRow | undefined;
    return row ? rowToZone(row) : null;
  }

  /**
   * 计算 Zone 的中心坐标
   * Requirements: 2.8
   */
  getZoneCenter(zone: Zone): Position {
    return {
      x: (zone.bounds.x1 + zone.bounds.x2) / 2,
      y: (zone.bounds.y1 + zone.bounds.y2) / 2,
    };
  }

  /**
   * 初始化 Contestant 的 Energy 缓存（接入时调用）
   */
  initContestantEnergy(contestantId: string, energy = 100): void {
    this.energyCache.set(contestantId, energy);
  }

  /**
   * 初始化 Contestant 的 Position 缓存（接入时调用）
   */
  initContestantPosition(contestantId: string, position: Position): void {
    this.positionCache.set(contestantId, position);
  }

  /**
   * 清除 Contestant 的内存缓存（离线时调用，但保留 Position 以满足需求 1.7）
   */
  clearContestantEnergyCache(contestantId: string): void {
    this.energyCache.delete(contestantId);
  }

  /**
   * 获取所有 Zone 列表
   */
  getAllZones(): Zone[] {
    const rows = db.prepare('SELECT * FROM zones').all() as ZoneRow[];
    return rows.map(rowToZone);
  }

  /**
   * 根据 ID 获取 Zone
   */
  getZoneById(zoneId: string): Zone | null {
    const row = db.prepare('SELECT * FROM zones WHERE id = ?').get(zoneId) as ZoneRow | undefined;
    return row ? rowToZone(row) : null;
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const worldManager = new WorldManager();
