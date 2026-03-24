/**
 * Admin dashboard types — mirrored from server types for client-side use.
 */

export interface Key {
  id: string;
  key: string;
  contestantName: string;
  role: string;
  status: 'active' | 'revoked';
  createdAt: number;
  revokedAt?: number;
}

export interface ZoneBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ZoneStyle {
  fillColor: string;
  borderColor: string;
  opacity: number;
  icon?: string;
}

export interface Zone {
  id: string;
  name: string;
  bounds: ZoneBounds;
  zoneTypeId: string;
  style: ZoneStyle;
  accessRestriction?: string[];
}

export interface ZoneRule {
  allowedAPIs: string[];
  forbiddenAPIs: string[];
  rateLimits: Record<string, number>;
  attributeEffects: unknown[];
  customParams: Record<string, unknown>;
}

export interface ZoneType {
  id: string;
  name: string;
  description: string;
  isBuiltin: boolean;
  rule: ZoneRule;
}

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  author?: string;
  tags?: string[];
}

export interface SkillDocument {
  id: string;
  metadata: SkillMetadata;
  markdownContent: string;
  currentVersion: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HeartbeatConfig {
  interval: number;
  timeout: number;
}
