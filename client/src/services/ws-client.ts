/**
 * WebSocket Client — XTION_TheFool0
 *
 * Manages the WebSocket connection to the server, handles reconnection with
 * exponential backoff, and dispatches incoming events to registered listeners.
 *
 * Requirements: 8.4
 */

// ---------------------------------------------------------------------------
// Message types (mirrors server/src/types/index.ts)
// ---------------------------------------------------------------------------

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

export type ServerMessage = ServerEvent | ServerResponse;

// ---------------------------------------------------------------------------
// Event type constants
// ---------------------------------------------------------------------------

export type WsEventType =
  | 'world.state'
  | 'contestant.join'
  | 'contestant.leave'
  | 'contestant.move'
  | 'contestant.status'
  | 'talk.message'
  | 'broadcast.message'
  | 'zone.rule.update'
  | 'energy.update'
  | 'doc.update'
  | 'barrage'
  | 'vote.update'
  | 'heartbeat.config'
  | 'alert.heartbeat';

// ---------------------------------------------------------------------------
// Listener types
// ---------------------------------------------------------------------------

export type EventListener<T = unknown> = (payload: T, timestamp: number) => void;
export type ResponseListener = (response: ServerResponse) => void;
export type ConnectionListener = () => void;

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// ---------------------------------------------------------------------------
// WSClient
// ---------------------------------------------------------------------------

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

class WSClient {
  private ws: WebSocket | null = null;
  private url: string = '';
  private key: string = '';

  private state: ConnectionState = 'disconnected';
  private reconnectDelay: number = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect: boolean = false;

  // Event listeners: eventType → Set of listeners
  private eventListeners: Map<string, Set<EventListener>> = new Map();

  // Response listeners: requestId → listener (one-shot)
  private responseListeners: Map<string, ResponseListener> = new Map();

  // Connection lifecycle listeners
  private onConnectListeners: Set<ConnectionListener> = new Set();
  private onDisconnectListeners: Set<ConnectionListener> = new Set();
  private onReconnectingListeners: Set<ConnectionListener> = new Set();

  // ---------------------------------------------------------------------------
  // Connection management
  // ---------------------------------------------------------------------------

  connect(url: string, key: string): void {
    this.url = url;
    this.key = key.trim();
    this.shouldReconnect = true;
    this._openConnection();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this._clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnected');
      this.ws = null;
    }
    this._setState('disconnected');
  }

  getState(): ConnectionState {
    return this.state;
  }

  // ---------------------------------------------------------------------------
  // Sending messages
  // ---------------------------------------------------------------------------

  send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WSClient] Cannot send — not connected', message.type);
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send a message and wait for the matching response (by requestId).
   * Returns a Promise that resolves/rejects when the response arrives or times out.
   */
  sendRequest(
    type: string,
    payload: unknown,
    timeoutMs: number = 10_000,
  ): Promise<ServerResponse> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseListeners.delete(requestId);
        reject(new Error(`[WSClient] Request timed out: ${type} (${requestId})`));
      }, timeoutMs);

      this.responseListeners.set(requestId, (response) => {
        clearTimeout(timer);
        resolve(response);
      });

      this.send({ type, payload, requestId });
    });
  }

  // ---------------------------------------------------------------------------
  // Event subscription
  // ---------------------------------------------------------------------------

  /** Subscribe to a specific server event type. Returns an unsubscribe function. */
  on<T = unknown>(eventType: WsEventType | string, listener: EventListener<T>): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener as EventListener);
    return () => this.off(eventType, listener as EventListener);
  }

  off(eventType: string, listener: EventListener): void {
    this.eventListeners.get(eventType)?.delete(listener);
  }

  /** Subscribe to all server events (wildcard). Returns an unsubscribe function. */
  onAny(listener: (event: ServerEvent) => void): () => void {
    return this.on('*', listener as EventListener);
  }

  onConnect(listener: ConnectionListener): () => void {
    this.onConnectListeners.add(listener);
    return () => this.onConnectListeners.delete(listener);
  }

  onDisconnect(listener: ConnectionListener): () => void {
    this.onDisconnectListeners.add(listener);
    return () => this.onDisconnectListeners.delete(listener);
  }

  onReconnecting(listener: ConnectionListener): () => void {
    this.onReconnectingListeners.add(listener);
    return () => this.onReconnectingListeners.delete(listener);
  }

  // ---------------------------------------------------------------------------
  // Internal — WebSocket lifecycle
  // ---------------------------------------------------------------------------

  private _openConnection(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this._setState('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('[WSClient] Failed to create WebSocket:', err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[WSClient] Connected to', this.url);
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this._setState('connected');
      this._notifyListeners(this.onConnectListeners);

      // Authenticate immediately after connecting
      if (this.key) {
        this.send({ type: 'auth', payload: { key: this.key } });
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this._handleMessage(event.data);
    };

    this.ws.onerror = (event) => {
      console.error('[WSClient] WebSocket error:', event);
    };

    this.ws.onclose = (event) => {
      console.log(`[WSClient] Connection closed (code=${event.code}, reason=${event.reason})`);
      this.ws = null;
      this._notifyListeners(this.onDisconnectListeners);

      if (this.shouldReconnect) {
        this._scheduleReconnect();
      } else {
        this._setState('disconnected');
      }
    };
  }

  private _handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      console.warn('[WSClient] Failed to parse message:', raw);
      return;
    }

    if (msg.type === 'response') {
      // Route to response listener
      const response = msg as ServerResponse;
      const listener = this.responseListeners.get(response.requestId);
      if (listener) {
        this.responseListeners.delete(response.requestId);
        listener(response);
      }
      return;
    }

    // It's a ServerEvent
    const serverEvent = msg as ServerEvent;
    this._dispatchEvent(serverEvent);
  }

  private _dispatchEvent(event: ServerEvent): void {
    // Dispatch to type-specific listeners
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event.payload, event.timestamp);
        } catch (err) {
          console.error(`[WSClient] Listener error for event "${event.type}":`, err);
        }
      }
    }

    // Dispatch to wildcard listeners
    const wildcardListeners = this.eventListeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          listener(event, event.timestamp);
        } catch (err) {
          console.error('[WSClient] Wildcard listener error:', err);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal — Reconnection (exponential backoff)
  // ---------------------------------------------------------------------------

  private _scheduleReconnect(): void {
    this._setState('reconnecting');
    this._notifyListeners(this.onReconnectingListeners);

    console.log(`[WSClient] Reconnecting in ${this.reconnectDelay}ms…`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this._openConnection();
      }
    }, this.reconnectDelay);

    // Exponential backoff: double the delay, cap at MAX
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal — Helpers
  // ---------------------------------------------------------------------------

  private _setState(state: ConnectionState): void {
    this.state = state;
  }

  private _notifyListeners(listeners: Set<ConnectionListener>): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[WSClient] Connection listener error:', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const wsClient = new WSClient();
export default wsClient;
