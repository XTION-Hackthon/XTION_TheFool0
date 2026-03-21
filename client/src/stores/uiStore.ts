/**
 * uiStore — UI state (selected contestant, panel visibility, zoom level)
 * Requirements: 6 (前端状态管理)
 */

import { create } from 'zustand';

export interface HeartbeatAlert {
  contestantId: string;
  status: 'timeout' | 'offline';
  timestamp: number;
}

export interface DocUpdateNotification {
  docName: string;
  timestamp: number;
}

export interface NotificationToast {
  id: string;
  type: 'error' | 'info';
  message: string;
  timestamp: number;
}

export interface UiState {
  selectedContestantId: string | null;
  showAdminPanel: boolean;
  showHeartbeatOverview: boolean;
  zoomLevel: number;

  // Heartbeat alerts (alert.heartbeat events)
  heartbeatAlerts: HeartbeatAlert[];

  // doc.update notifications
  docUpdateNotifications: DocUpdateNotification[];

  // generic UI notifications
  notifications: NotificationToast[];

  // Actions
  selectContestant: (id: string | null) => void;
  setShowAdminPanel: (show: boolean) => void;
  setShowHeartbeatOverview: (show: boolean) => void;
  setZoomLevel: (zoom: number) => void;
  addHeartbeatAlert: (alert: HeartbeatAlert) => void;
  dismissHeartbeatAlert: (contestantId: string) => void;
  addDocUpdateNotification: (notification: DocUpdateNotification) => void;
  addNotification: (notification: Omit<NotificationToast, 'id' | 'timestamp'>) => void;
  dismissNotification: (id: string) => void;

  reset: () => void;
}

const initialState = {
  selectedContestantId: null,
  showAdminPanel: false,
  showHeartbeatOverview: false,
  zoomLevel: 1,
  heartbeatAlerts: [] as HeartbeatAlert[],
  docUpdateNotifications: [] as DocUpdateNotification[],
  notifications: [] as NotificationToast[],
};

export const useUiStore = create<UiState>((set) => ({
  ...initialState,

  selectContestant: (id) => set({ selectedContestantId: id }),
  setShowAdminPanel: (show) => set({ showAdminPanel: show }),
  setShowHeartbeatOverview: (show) => set({ showHeartbeatOverview: show }),
  setZoomLevel: (zoom) => set({ zoomLevel: zoom }),

  addHeartbeatAlert: (alert) =>
    set((state) => ({
      heartbeatAlerts: [
        ...state.heartbeatAlerts.filter((a) => a.contestantId !== alert.contestantId),
        alert,
      ],
    })),

  dismissHeartbeatAlert: (contestantId) =>
    set((state) => ({
      heartbeatAlerts: state.heartbeatAlerts.filter((a) => a.contestantId !== contestantId),
    })),

  addDocUpdateNotification: (notification) =>
    set((state) => ({
      docUpdateNotifications: [...state.docUpdateNotifications, notification].slice(-20),
    })),

  addNotification: (notification) =>
    set((state) => ({
      notifications: [
        ...state.notifications,
        {
          id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: Date.now(),
          ...notification,
        },
      ].slice(-10),
    })),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),

  reset: () => set(initialState),
}));
