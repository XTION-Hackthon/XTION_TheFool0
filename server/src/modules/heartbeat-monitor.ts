// =============================================================================
// XTION_TheFool0 — HeartbeatMonitor 模块
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.14
// =============================================================================

import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { connections, sendEvent, broadcast } from '../ws';
import { worldManager } from './world-manager';
import type {
  IHeartbeatMonitor,
  HeartbeatPayload,
  HeartbeatRecord,
  HeartbeatConfig,
  HealthStatus,
} from '../types/index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL = 10; // seconds
const DEFAULT_TIMEOUT = 30;  // seconds
const MAX_HISTORY = 100;

const MIN_INTERVAL = 1;
const MAX_INTERVAL = 30;
const MIN_TIMEOUT = 3;
const MAX_TIMEOUT = 120;

// ---------------------------------------------------------------------------
// Internal state per contestant
// ---------------------------------------------------------------------------

interface ContestantState {
  lastHeartbeat: number;       // ms timestamp
  status: HealthStatus;
  timeoutEnteredAt: number | null; // ms timestamp when 'timeout' state was entered
  history: HeartbeatRecord[];
}
// ---------------------------------------------------------------------------
// HeartbeatMonitor
// ---------------------------------------------------------------------------

class HeartbeatMonitor implements IHeartbeatMonitor {
  private config: HeartbeatConfig = {
    interval: DEFAULT_INTERVAL,
    timeout: DEFAULT_TIMEOUT,
  };

  private contestants = new Map<string, ContestantState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingEnergyRetries = new Set<string>();

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  register(contestantId: string): void {
    if (this.contestants.has(contestantId)) return;

    this.contestants.set(contestantId, {
      lastHeartbeat: Date.now(),
      status: 'healthy',
      timeoutEnteredAt: null,
      history: [],
    });

    this.ensureTimer();
  }

  unregister(contestantId: string): void {
    this.contestants.delete(contestantId);

    if (this.contestants.size === 0) {
      this.stopTimer();
    }
  }

  onHeartbeat(contestantId: string, payload: HeartbeatPayload): void {
    const state = this.contestants.get(contestantId);
    if (!state) return;

    const now = Date.now();

    // Update in-memory state
    state.lastHeartbeat = now;
    state.status = 'healthy';
    state.timeoutEnteredAt = null;

    // Append to history (cap at MAX_HISTORY)
    const record: HeartbeatRecord = {
      contestantId,
      timestamp: now,
      payload,
    };
    state.history.push(record);
    if (state.history.length > MAX_HISTORY) {
      state.history.shift();
    }

    // Persist to SQLite
    db.prepare(`
      INSERT INTO heartbeat_records (id, contestant_id, timestamp, cpu_load, memory_usage, response_latency)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      contestantId,
      now,
      payload.cpuLoad,
      payload.memoryUsage,
      payload.responseLatency,
    );
  }

  getHealthStatus(contestantId: string): HealthStatus {
    return this.contestants.get(contestantId)?.status ?? 'offline';
  }

  getHistory(contestantId: string, limit = 100): HeartbeatRecord[] {
    const state = this.contestants.get(contestantId);
    if (!state) return [];

    const cap = Math.min(limit, MAX_HISTORY);
    const history = state.history;
    return history.slice(Math.max(0, history.length - cap));
  }

  updateConfig(config: HeartbeatConfig): void {
    if (config.interval < MIN_INTERVAL || config.interval > MAX_INTERVAL) {
      throw new Error(
        `interval must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} seconds, got ${config.interval}`,
      );
    }
    if (config.timeout < MIN_TIMEOUT || config.timeout > MAX_TIMEOUT) {
      throw new Error(
        `timeout must be between ${MIN_TIMEOUT} and ${MAX_TIMEOUT} seconds, got ${config.timeout}`,
      );
    }

    this.config = { ...config };

    // Restart timer with new interval
    if (this.timer !== null) {
      this.stopTimer();
      this.ensureTimer();
    }
  }

  // -------------------------------------------------------------------------
  // Timer management
  // -------------------------------------------------------------------------

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.config.interval * 1000);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // -------------------------------------------------------------------------
  // State machine tick
  // -------------------------------------------------------------------------

  private tick(): void {
    const now = Date.now();
    const intervalMs = this.config.interval * 1000;
    const timeoutMs = this.config.timeout * 1000;

    for (const [contestantId, state] of this.contestants) {
      const elapsed = now - state.lastHeartbeat;
      const prevStatus = state.status;

      // Evaluate transitions
      if (elapsed > 2 * timeoutMs) {
        // timeout → offline
        if (prevStatus !== 'offline') {
          state.status = 'offline';
          this.handleOffline(contestantId);
        }
      } else if (elapsed > timeoutMs) {
        // delayed → timeout
        if (prevStatus !== 'timeout' && prevStatus !== 'offline') {
          state.status = 'timeout';
          state.timeoutEnteredAt = now;
          this.handleTimeout(contestantId);
        }
      } else if (elapsed > intervalMs) {
        // healthy → delayed
        if (prevStatus === 'healthy') {
          state.status = 'delayed';
        }
      }
      // If elapsed <= intervalMs, stay healthy (heartbeat keeps it healthy)

      // Rest 区被动回血（每个 tick 检查一次）
      // Requirements: 11.6
      if (prevStatus !== 'offline') {
        this.applyRestZoneEnergyRegen(contestantId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rest 区被动回血
  // -------------------------------------------------------------------------

  private applyRestZoneEnergyRegen(contestantId: string): void {
      const rule = worldManager.getApplicableRules(contestantId);
      const regenEffect = rule.attributeEffects.find(
        (e) => e.attribute === 'energy' && e.type === 'regen' && (e.trigger === 'on_tick' || e.trigger === 'passive'),
      );
      if (!regenEffect && !this.pendingEnergyRetries.has(contestantId)) return;

      // If this is a retry but no regen effect applies anymore, clear the retry flag
      if (!regenEffect) {
        this.pendingEnergyRetries.delete(contestantId);
        return;
      }

      const current = worldManager.getEnergy(contestantId);
      if (current >= 100) {
        this.pendingEnergyRetries.delete(contestantId);
        return; // 已满，无需回血
      }

      try {
        // modifyEnergy is async by interface but backed by synchronous SQLite.
        // Wrap in try/catch so synchronous errors are not silently swallowed.
        worldManager.modifyEnergy(contestantId, regenEffect.rate).then((newEnergy) => {
          this.pendingEnergyRetries.delete(contestantId);
          const ws = connections.get(contestantId);
          if (ws) {
            sendEvent(ws, {
              type: 'energy.update',
              payload: {
                contestantId,
                energy: newEnergy,
                delta: regenEffect.rate,
                reason: 'rest_zone_regen',
              },
              timestamp: Date.now(),
            });
          }
        }).catch((err: unknown) => {
          console.error('[HeartbeatMonitor] energy regen error, will retry next tick:', err);
          this.pendingEnergyRetries.add(contestantId);
        });
      } catch (err: unknown) {
        console.error('[HeartbeatMonitor] energy regen error, will retry next tick:', err);
        this.pendingEnergyRetries.add(contestantId);
      }
    }

  // -------------------------------------------------------------------------
  // Side effects
  // -------------------------------------------------------------------------

  private handleTimeout(contestantId: string): void {
    // Update DB status
    db.prepare(`UPDATE contestants SET status = 'timeout' WHERE id = ?`).run(contestantId);

    // Push contestant.status WebSocket event to the contestant
    const ws = connections.get(contestantId);
    if (ws) {
      sendEvent(ws, {
        type: 'contestant.status',
        payload: { id: contestantId, status: 'timeout' },
        timestamp: Date.now(),
      });
    }

    // Push alert.heartbeat event to the contestant
    if (ws) {
      sendEvent(ws, {
        type: 'alert.heartbeat',
        payload: { id: contestantId, status: 'timeout' },
        timestamp: Date.now(),
      });
    }
  }

  private handleOffline(contestantId: string): void {
    // Disconnect WebSocket
    const ws = connections.get(contestantId);
    if (ws) {
      ws.close(1001, 'heartbeat_timeout');
      connections.delete(contestantId);
    }

    // Update DB status
    db.prepare(`UPDATE contestants SET status = 'offline', disconnected_at = ? WHERE id = ?`)
      .run(Date.now(), contestantId);

    // Push contestant.status event to all online contestants
    broadcast(
      {
        type: 'contestant.status',
        payload: { id: contestantId, status: 'offline' },
        timestamp: Date.now(),
      },
    );

    // Log event via EventLogger (lazy import to avoid circular deps)
    this.logOfflineEvent(contestantId);
  }

  private logOfflineEvent(contestantId: string): void {
    // Use a runtime-only dynamic import string to avoid circular deps and
    // to gracefully handle the case where event-logger doesn't exist yet.
    const modulePath = './event-logger';
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('path', 'return import(path)') as (
      path: string,
    ) => Promise<{ eventLogger?: { log: (e: unknown) => Promise<void> } }>;

    dynamicImport(modulePath)
      .then((mod) => {
        mod.eventLogger?.log({
          type: 'heartbeat.offline',
          contestantId,
          data: { contestantId, reason: 'heartbeat_timeout' },
        })?.catch((err: unknown) => {
          console.error('[HeartbeatMonitor] failed to log offline event:', err);
        });
      })
      .catch(() => {
        // event-logger not available — silently skip
      });
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const heartbeatMonitor = new HeartbeatMonitor();
