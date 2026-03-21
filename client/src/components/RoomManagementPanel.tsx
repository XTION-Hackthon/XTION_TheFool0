/**
 * RoomManagementPanel — Shows current room info, bots in room, and room switching.
 *
 * Requirements: 1, 9
 */

import { useRoomStore } from '../stores/roomStore';
import { useGameStore } from '../stores/gameStore';
import type { Room } from '../stores/roomStore';

interface RoomManagementPanelProps {
  currentBotId: string;
  onSwitchRoom?: (roomId: string) => void;
}

function isRoomFull(room: Room): boolean {
  if (room.type === 'MainHall') return false;
  return room.currentCount >= room.capacity;
}

export function RoomManagementPanel({ currentBotId, onSwitchRoom }: RoomManagementPanelProps) {
  const rooms = useRoomStore((s) => s.rooms);
  const currentRoomId = useGameStore((s) => s.currentRoomId);

  const currentRoom = currentRoomId ? rooms[currentRoomId] : null;
  const otherRooms = Object.values(rooms).filter((r) => r.id !== currentRoomId);

  return (
    <div style={containerStyle}>
      {/* Current Room Info */}
      <div style={titleStyle}>当前房间</div>
      {currentRoom ? (
        <div style={currentRoomBoxStyle}>
          <div style={roomNameStyle}>{currentRoom.name}</div>
          <div style={roomMetaStyle}>
            <span style={typeTagStyle}>
              {currentRoom.type === 'MainHall' ? '主大厅' : '私聊房间'}
            </span>
            <span style={countStyle}>
              {currentRoom.currentCount} / {currentRoom.type === 'MainHall' ? '∞' : currentRoom.capacity}
            </span>
          </div>

          {/* Bot list */}
          <div style={botSectionTitleStyle}>房间内的Bot</div>
          {(currentRoom.bots ?? []).length === 0 ? (
            <div style={emptyStyle}>暂无Bot</div>
          ) : (
            <div style={botListStyle}>
              {(currentRoom.bots ?? []).map((bot) => (
                <div key={bot.id} style={botRowStyle}>
                  <span style={bot.id === currentBotId ? selfBotNameStyle : botNameStyle}>
                    {bot.name || bot.id.slice(0, 8)}
                    {bot.id === currentBotId && ' (你)'}
                  </span>
                  <span style={botPosStyle}>
                    ({Math.round(bot.position.x)}, {Math.round(bot.position.y)})
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={emptyStyle}>未加入任何房间</div>
      )}

      {/* Other rooms to switch to */}
      {otherRooms.length > 0 && (
        <>
          <div style={{ ...titleStyle, marginTop: 14 }}>切换房间</div>
          {otherRooms.map((room) => {
            const full = isRoomFull(room);
            const capacityLabel =
              room.type === 'MainHall'
                ? `${room.currentCount} / ∞`
                : `${room.currentCount} / ${room.capacity}`;

            return (
              <div key={room.id} style={switchRowStyle}>
                <div style={switchInfoStyle}>
                  <span style={switchNameStyle}>{room.name}</span>
                  <span style={switchMetaStyle}>
                    {room.type === 'MainHall' ? '主大厅' : '私聊房间'} · {capacityLabel}
                  </span>
                </div>
                {full ? (
                  <span style={fullBadgeStyle}>已满</span>
                ) : (
                  <button
                    style={switchButtonStyle}
                    onClick={() => onSwitchRoom?.(room.id)}
                  >
                    切换
                  </button>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  background: 'rgba(20, 20, 40, 0.92)',
  border: '1px solid rgba(120, 180, 255, 0.3)',
  borderRadius: 8,
  padding: '12px 16px',
  minWidth: 240,
  color: '#e8f0ff',
  fontFamily: 'inherit',
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#7ec8ff',
  marginBottom: 8,
  borderBottom: '1px solid rgba(120, 180, 255, 0.2)',
  paddingBottom: 5,
};

const currentRoomBoxStyle: React.CSSProperties = {
  background: 'rgba(60, 100, 180, 0.1)',
  border: '1px solid rgba(120, 180, 255, 0.15)',
  borderRadius: 6,
  padding: '8px 10px',
};

const roomNameStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#e8f0ff',
  marginBottom: 4,
};

const roomMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 8,
};

const typeTagStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
  background: 'rgba(255,255,255,0.07)',
  borderRadius: 3,
  padding: '1px 5px',
};

const countStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#7ec8ff',
};

const botSectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
  marginBottom: 4,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
};

const botListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const botRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
};

const botNameStyle: React.CSSProperties = {
  color: '#c8d8f0',
};

const selfBotNameStyle: React.CSSProperties = {
  color: '#7ec8ff',
  fontWeight: 600,
};

const botPosStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 11,
};

const emptyStyle: React.CSSProperties = {
  color: '#666',
  fontSize: 12,
  padding: '4px 0',
};

const switchRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
};

const switchInfoStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const switchNameStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#e8f0ff',
};

const switchMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
};

const fullBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#ff8888',
  background: 'rgba(255, 80, 80, 0.15)',
  border: '1px solid rgba(255, 80, 80, 0.4)',
  borderRadius: 4,
  padding: '2px 6px',
};

const switchButtonStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 10px',
  background: 'rgba(60, 160, 255, 0.2)',
  border: '1px solid rgba(60, 160, 255, 0.5)',
  borderRadius: 4,
  color: '#7ec8ff',
  cursor: 'pointer',
};

export default RoomManagementPanel;
