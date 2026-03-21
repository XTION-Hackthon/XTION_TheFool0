/**
 * RoomList — Displays all available rooms with join/leave controls.
 *
 * Requirements: 1, 2
 */

import { useRoomStore } from '../stores/roomStore';
import type { Room } from '../stores/roomStore';

interface RoomListProps {
  currentBotId: string;
  onJoinRoom?: (roomId: string) => void;
  onLeaveRoom?: (roomId: string) => void;
}

function isBotInRoom(room: Room, botId: string): boolean {
  return (room.bots ?? []).some((b) => b.id === botId);
}

function isRoomFull(room: Room): boolean {
  if (room.type === 'MainHall') return false;
  return room.currentCount >= room.capacity;
}

export function RoomList({ currentBotId, onJoinRoom, onLeaveRoom }: RoomListProps) {
  const rooms = useRoomStore((s) => s.rooms);
  const roomList = Object.values(rooms);

  if (roomList.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={titleStyle}>房间列表</div>
        <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>暂无房间</div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>房间列表</div>
      {roomList.map((room) => {
        const inRoom = isBotInRoom(room, currentBotId);
        const full = isRoomFull(room);
        const capacityLabel =
          room.type === 'MainHall'
            ? `${room.currentCount} / ∞`
            : `${room.currentCount} / ${room.capacity}`;

        return (
          <div key={room.id} style={rowStyle}>
            <div style={infoStyle}>
              <span style={nameStyle}>{room.name}</span>
              <span style={typeStyle}>{room.type === 'MainHall' ? '主大厅' : '私聊房间'}</span>
              <span style={capacityStyle}>{capacityLabel}</span>
            </div>
            <div style={actionStyle}>
              {full && !inRoom && (
                <span style={fullBadgeStyle}>已满</span>
              )}
              {inRoom ? (
                <button
                  style={leaveButtonStyle}
                  onClick={() => onLeaveRoom?.(room.id)}
                >
                  离开
                </button>
              ) : !full ? (
                <button
                  style={joinButtonStyle}
                  onClick={() => onJoinRoom?.(room.id)}
                >
                  加入
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: 'rgba(20, 20, 40, 0.92)',
  border: '1px solid rgba(120, 180, 255, 0.3)',
  borderRadius: 8,
  padding: '12px 16px',
  minWidth: 260,
  color: '#e8f0ff',
  fontFamily: 'inherit',
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#7ec8ff',
  marginBottom: 10,
  borderBottom: '1px solid rgba(120, 180, 255, 0.2)',
  paddingBottom: 6,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};

const infoStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const nameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#e8f0ff',
};

const typeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
};

const capacityStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#7ec8ff',
};

const actionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const fullBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#ff8888',
  background: 'rgba(255, 80, 80, 0.15)',
  border: '1px solid rgba(255, 80, 80, 0.4)',
  borderRadius: 4,
  padding: '2px 6px',
};

const joinButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 10px',
  background: 'rgba(60, 160, 255, 0.2)',
  border: '1px solid rgba(60, 160, 255, 0.5)',
  borderRadius: 4,
  color: '#7ec8ff',
  cursor: 'pointer',
};

const leaveButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 10px',
  background: 'rgba(255, 120, 60, 0.2)',
  border: '1px solid rgba(255, 120, 60, 0.5)',
  borderRadius: 4,
  color: '#ffaa88',
  cursor: 'pointer',
};

export default RoomList;
