import type { Room, Doorway } from '../../stores';
import type { Point } from './grid-pathfinder';

interface RoomNode {
  roomId: string;
  neighbors: Array<{
    roomId: string;
    doorway: Doorway;
  }>;
}

/**
 * 房间图构建器
 * 用于多房间寻路的房间级别图构建
 */
export class RoomGraphBuilder {
  private graph: Map<string, RoomNode> = new Map();
  private rooms: Map<string, Room> = new Map();

  /**
   * 构建房间图
   */
  buildGraph(rooms: Room[], doorways: Doorway[]): void {
    this.rooms.clear();
    this.graph.clear();

    // 初始化房间节点
    for (const room of rooms) {
      this.rooms.set(room.id, room);
      this.graph.set(room.id, {
        roomId: room.id,
        neighbors: [],
      });
    }

    // 添加门洞连接
    for (const doorway of doorways) {
      const nodeA = this.graph.get(doorway.roomAId);
      const nodeB = this.graph.get(doorway.roomBId);

      if (nodeA && nodeB) {
        nodeA.neighbors.push({
          roomId: doorway.roomBId,
          doorway,
        });
        nodeB.neighbors.push({
          roomId: doorway.roomAId,
          doorway,
        });
      }
    }
  }

  /**
   * 使用 BFS 查找两个房间之间的路径
   */
  getPath(startRoomId: string, endRoomId: string): string[] {
    if (startRoomId === endRoomId) {
      return [startRoomId];
    }

    const queue: string[] = [startRoomId];
    const visited = new Set<string>([startRoomId]);
    const parent = new Map<string, string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.graph.get(current);

      if (!node) continue;

      for (const neighbor of node.neighbors) {
        if (visited.has(neighbor.roomId)) continue;

        visited.add(neighbor.roomId);
        parent.set(neighbor.roomId, current);
        queue.push(neighbor.roomId);

        if (neighbor.roomId === endRoomId) {
          // 回溯路径
          const path: string[] = [endRoomId];
          let current = endRoomId;

          while (parent.has(current)) {
            current = parent.get(current)!;
            path.unshift(current);
          }

          return path;
        }
      }
    }

    // 无法到达
    return [];
  }

  /**
   * 获取两个房间之间的门洞
   */
  getDoorway(roomAId: string, roomBId: string): Doorway | null {
    const nodeA = this.graph.get(roomAId);
    if (!nodeA) return null;

    for (const neighbor of nodeA.neighbors) {
      if (neighbor.roomId === roomBId) {
        return neighbor.doorway;
      }
    }

    return null;
  }

  /**
   * 获取门洞中心点
   */
  getDoorwayCenter(doorway: Doorway): Point {
    return {
      x: doorway.x + doorway.width / 2,
      y: doorway.y + doorway.height / 2,
    };
  }

  /**
   * 更新房间
   */
  updateRooms(rooms: Room[]): void {
    this.rooms.clear();
    for (const room of rooms) {
      this.rooms.set(room.id, room);
    }
  }

  /**
   * 更新门洞（重新构建图）
   */
  updateDoorways(rooms: Room[], doorways: Doorway[]): void {
    this.buildGraph(rooms, doorways);
  }

  /**
   * 获取房间
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }
}
