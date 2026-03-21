// =============================================================================
// XTION_TheFool0 — Core Data Models & TypeScript Interfaces
// =============================================================================

// -----------------------------------------------------------------------------
// Auth & Contestant
// -----------------------------------------------------------------------------

export type Role = 'Admin' | 'Agent_Player' | 'Human_Viewer' | 'Agent_Viewer';

export interface Key {
  id: string;
  key: string;
  contestantName: string;
  role: Role;
  status: 'active' | 'revoked';
  createdAt: number;
  revokedAt?: number;
}

export type ConnectionStatus = 'online' | 'offline' | 'busy' | 'timeout';

export interface Contestant {
  id: string;
  keyId: string;
  name: string;
  status: ConnectionStatus;
  position: Position;
  currentZoneId: string | null;
  energy: number;
  installedSkills: string[];
  attributes: Record<string, unknown>;
  connectedAt?: number;
  disconnectedAt?: number;
}

export interface Position {
  x: number;
  y: number;
}

// -----------------------------------------------------------------------------
// World & Zone
// -----------------------------------------------------------------------------

export interface World {
  id: string;
  map: GameMap;
  contestants: Map<string, Contestant>;
}

export interface GameMap {
  width: number;
  height: number;
  backgroundImage?: string;
  defaultZoneId: string;
  zones: Zone[];
}

export interface Zone {
  id: string;
  name: string;
  bounds: ZoneBounds;
  zoneTypeId: string;
  style: ZoneStyle;
  accessRestriction?: string[];
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

// -----------------------------------------------------------------------------
// Zone Type & Rule
// -----------------------------------------------------------------------------

export type BuiltinZoneType = 'rest' | 'work' | 'social';

export interface ZoneType {
  id: string;
  name: string;
  description: string;
  isBuiltin: boolean;
  rule: ZoneRule;
}

export interface ZoneRule {
  allowedAPIs: string[];
  forbiddenAPIs: string[];
  rateLimits: Record<string, number>;
  attributeEffects: AttributeEffect[];
  customParams: Record<string, unknown>;
}

export interface AttributeEffect {
  attribute: string;
  type: 'regen' | 'consume' | 'static';
  rate: number;
  trigger: 'passive' | 'on_api_call' | 'on_tick';
}

// -----------------------------------------------------------------------------
// Skill Documents
// -----------------------------------------------------------------------------

export interface SkillDocument {
  id: string;
  metadata: SkillMetadata;
  markdownContent: string;
  currentVersion: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillMetadata {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  author?: string;
  tags?: string[];
}

export interface DocumentVersion {
  version: string;
  markdownContent: string;
  createdAt: number;
  changelog?: string;
}

// -----------------------------------------------------------------------------
// Platform Documents
// -----------------------------------------------------------------------------

export interface PlatformDocument {
  id: string;
  name: string;
  markdownContent: string;
  isMandatory: boolean;
  updatedAt: number;
}

// -----------------------------------------------------------------------------
// Heartbeat
// -----------------------------------------------------------------------------

export interface HeartbeatPayload {
  cpuLoad: number;
  memoryUsage: number;
  responseLatency: number;
}

export interface HeartbeatRecord {
  contestantId: string;
  timestamp: number;
  payload: HeartbeatPayload;
}

export interface HeartbeatConfig {
  interval: number;
  timeout: number;
}

export type HealthStatus = 'healthy' | 'delayed' | 'timeout' | 'offline';

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

export interface TalkMessage {
  id: string;
  senderId: string;
  receiverIds: string[];
  content: string;
  zoneId: string;
  timestamp: number;
}

export interface BroadcastMessage {
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Viewer Interaction
// -----------------------------------------------------------------------------

export interface BarrageMessage {
  id: string;
  viewerId: string;
  content: string;
  timestamp: number;
}

export interface VoteRecord {
  contestantId: string;
  viewerId: string;
  type: 'like' | 'dislike';
  timestamp: number;
}

export interface ViewerInteractionSummary {
  barrageCount: number;
  likeCount: number;
  dislikeCount: number;
  recentBarrages: BarrageMessage[];
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

export type EventType =
  | 'contestant.online'
  | 'contestant.offline'
  | 'contestant.move'
  | 'message.talk'
  | 'message.broadcast'
  | 'zone.change'
  | 'heartbeat.timeout'
  | 'heartbeat.offline'
  | 'doc.update'
  | 'system';

export interface PlatformEvent {
  id: string;
  type: EventType;
  contestantId?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// -----------------------------------------------------------------------------
// Error
// -----------------------------------------------------------------------------

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// -----------------------------------------------------------------------------
// WebSocket Messages
// -----------------------------------------------------------------------------

export interface ClientMessage {
  type: string;
  payload: unknown;
  requestId?: string;
}

export interface ServerEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface ServerResponse {
  type: 'response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

// -----------------------------------------------------------------------------
// Module Interfaces
// -----------------------------------------------------------------------------

// --- AuthManager ---

export interface IAuthManager {
  generateKey(contestantName: string, role: Role): Promise<Key>;
  validateKey(key: string): Promise<{ valid: boolean; contestantId?: string; keyId?: string; role?: Role }>;
  updateKeyRole(keyId: string, role: Role): Promise<Key>;
  revokeKey(keyId: string): Promise<void>;
  regenerateKey(keyId: string): Promise<Key>;
  listKeys(): Promise<Key[]>;
}

// --- WorldManager ---

export interface IWorldManager {
  setPosition(contestantId: string, position: Position): Promise<void>;
  getPosition(contestantId: string): Promise<Position>;
  getZoneAt(position: Position): Zone | null;
  getContestantsInZone(zoneId: string): string[];
  getApplicableRules(contestantId: string): ZoneRule;
  isAPIAllowed(contestantId: string, apiName: string): boolean;
  getEnergy(contestantId: string): number;
  modifyEnergy(contestantId: string, delta: number): Promise<number>;
  createZone(zone: Omit<Zone, 'id'>): Promise<Zone>;
  updateZone(zoneId: string, updates: Partial<Zone>): Promise<Zone>;
  deleteZone(zoneId: string): Promise<void>;
  createZoneType(zoneType: Omit<ZoneType, 'id'>): Promise<ZoneType>;
  updateZoneRule(zoneTypeId: string, rule: ZoneRule): Promise<void>;
}

// --- CoreAPIHandler ---

export interface TalkParams {
  senderId: string;
  targetIds: string[];
  message: string;
}

export interface TalkResult {
  messageId: string;
  timestamp: number;
}

export interface BroadcastParams {
  senderId: string;
  message: string;
}

export interface BroadcastResult {
  messageId: string;
  recipientCount: number;
  timestamp: number;
}

export interface MoveParams {
  contestantId: string;
  target: Position | { zoneId: string };
}

export interface MoveResult {
  newPosition: Position;
  newZoneId: string | null;
  timestamp: number;
}

export interface ICoreAPIHandler {
  handleTalk(params: TalkParams): Promise<TalkResult>;
  handleBroadcast(params: BroadcastParams): Promise<BroadcastResult>;
  handleMove(params: MoveParams): Promise<MoveResult>;
}

// --- HeartbeatMonitor ---

export interface IHeartbeatMonitor {
  register(contestantId: string): void;
  onHeartbeat(contestantId: string, payload: HeartbeatPayload): void;
  unregister(contestantId: string): void;
  getHealthStatus(contestantId: string): HealthStatus;
  getHistory(contestantId: string, limit?: number): HeartbeatRecord[];
  updateConfig(config: HeartbeatConfig): void;
}

// --- SkillDocManager ---

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ISkillDocManager {
  uploadDocument(markdownContent: string): Promise<SkillDocument>;
  validateMetadata(content: string): ValidationResult;
  getDocument(docId: string): Promise<SkillDocument>;
  updateDocument(docId: string, markdownContent: string): Promise<SkillDocument>;
  deleteDocument(docId: string): Promise<void>;
  listSkillDocuments(): Promise<SkillDocument[]>;
  listDocuments(): Promise<SkillMetadata[]>;
  getVersionHistory(docId: string): Promise<DocumentVersion[]>;
  rollbackToVersion(docId: string, version: string): Promise<SkillDocument>;
}

// --- DocDistributor ---

export interface IDocDistributor {
  listAvailableSkills(contestantId: string): Promise<SkillMetadata[]>;
  installSkill(contestantId: string, skillDocId: string): Promise<string>;
  getMandatoryDocuments(): Promise<PlatformDocument[]>;
  getPlatformDocument(docName: string): Promise<PlatformDocument>;
  notifyDocumentUpdate(docName: string): Promise<void>;
}

// --- InteractionManager ---

export interface IInteractionManager {
  sendBarrage(viewerId: string, content: string): Promise<BarrageMessage>;
  vote(viewerId: string, contestantId: string, type: 'like' | 'dislike'): Promise<void>;
  getVotes(contestantId: string): Promise<{ likes: number; dislikes: number }>;
  getAudienceFeedback(contestantId?: string): Promise<ViewerInteractionSummary>;
}

// --- EventLogger ---

export interface EventFilter {
  type?: EventType;
  contestantId?: string;
  page?: number;
  pageSize?: number;
}

export interface IEventLogger {
  log(event: Omit<PlatformEvent, 'id' | 'timestamp'>): Promise<void>;
  query(filter: EventFilter): Promise<{ events: PlatformEvent[]; total: number }>;
}
