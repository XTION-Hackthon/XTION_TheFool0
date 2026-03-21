/**
 * messageStore — Message lists (Talk, Broadcast, Barrage)
 * Requirements: 6 (前端状态管理)
 */

import { create } from 'zustand';
import type { TalkMessage, BroadcastMessage, BarrageMessage } from '../../../server/src/types/index';

const MAX_MESSAGES = 100;

function appendCapped<T>(list: T[], item: T): T[] {
  const next = [...list, item];
  return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
}

export interface MessageState {
  talkMessages: TalkMessage[];
  broadcastMessages: BroadcastMessage[];
  barrageMessages: BarrageMessage[];

  addTalkMessage: (msg: TalkMessage) => void;
  addBroadcastMessage: (msg: BroadcastMessage) => void;
  addBarrageMessage: (msg: BarrageMessage) => void;
  setBroadcastMessages: (messages: BroadcastMessage[]) => void;
  setBarrageMessages: (messages: BarrageMessage[]) => void;

  reset: () => void;
}

const initialState = {
  talkMessages: [] as TalkMessage[],
  broadcastMessages: [] as BroadcastMessage[],
  barrageMessages: [] as BarrageMessage[],
};

export const useMessageStore = create<MessageState>((set) => ({
  ...initialState,

  addTalkMessage: (msg) =>
    set((state) => ({ talkMessages: appendCapped(state.talkMessages, msg) })),

  addBroadcastMessage: (msg) =>
    set((state) => ({ broadcastMessages: appendCapped(state.broadcastMessages, msg) })),

  addBarrageMessage: (msg) =>
    set((state) => ({ barrageMessages: appendCapped(state.barrageMessages, msg) })),

  setBroadcastMessages: (messages) =>
    set({
      broadcastMessages: messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages,
    }),

  setBarrageMessages: (messages) =>
    set({
      barrageMessages: messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages,
    }),

  reset: () => set(initialState),
}));
