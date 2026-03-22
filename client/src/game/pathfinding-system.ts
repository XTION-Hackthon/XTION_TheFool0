import type { Room, Doorway, Bot } from '../stores';
import { GridPathfinder, type Point } from './pathfinding/grid-pathfinder';
import { RoomGraphBuilder } from './pathfinding/room-graph-builder';

export type { Point };

/**
 * 寻路系统
 * 支持单房间 A* 寻路和多房间寻路
 */
export class PathfindingSystem {
  private gridPathfinder: GridPathfinder;
  private roomGraphBuilder: RoomGraphBuilder;
  private rooms: Map<string, Room> = new Map();
  private doorways: Map<string, Doorway> = new Map();

  constructor() {
    this.gridPathfinder = new GridPathfinder();
    this.roomGraphBuilder = new RoomGraphBuilder();
  }

  /**
   * 初始化系统
   */
  initialize(rooms: Room[], doorways: Doorway[]): void {
    this.updateRooms(rooms);
    this.updateDoorways(doorways);
  }

  /**
   * 单房间寻路
   */
  findPath(
    start: Point,
    goal: Point,
    roomId: string,
    bots: Bot[] = [],
    botId: string = '',
  ): Point[] {
    const room = this.rooms.get(roomId);
    if (!room) return [start];

    const bounds = room.bounds;
    if (!bounds) return [start];

    const walls = room.walls ?? [];
    const doorwaysArray = Array.from(this.doorways.values()).filter(
      (d) => d.roomAId === roomId || d.roomBId === roomId,
    );

    return this.gridPathfinder.findPath(
      start,
      goal,
      walls,
      doorwaysArray,
      bots,
      botId,
      bounds,
    );
  }

  /**
   * 多房间寻路
   */
  findMultiRoomPath(
    start: Point,
    goal: Point,
    startRoomId: string,
    goalRoomId: string,
    bots: Bot[] = [],
    botId: string = '',
  ): Point[] {
    // 如果在同一房间，直接寻路
    if (startRoomId === goalRoomId) {
      return this.findPath(start, goal, startRoomId, bots, botId);
    }

    // 查找房间路径
    const roomPath = this.roomGraphBuilder.getPath(startRoomId, goalRoomId);
    if (roomPath.length === 0) {
      // 无法到达
      return [start];
    }

    // 构建完整路径
    const fullPath: Point[] = [];

    for (let i = 0; i < roomPath.length; i++) {
      const currentRoomId = roomPath[i];
      const currentRoom = this.rooms.get(currentRoomId);
      if (!currentRoom) continue;

      let pathStart = start;
      let pathGoal = goal;

      // 如果不是起始房间，从门洞中心开始
      if (i > 0) {
        const prevRoomId = roomPath[i - 1];
        const doorway = this.roomGraphBuilder.getDoorway(prevRoomId, currentRoomId);
        if (doorway) {
          pathStart = this.roomGraphBuilder.getDoorwayCenter(doorway);
        }
      }

      // 如果不是目标房间，到门洞中心结束
      if (i < roomPath.length - 1) {
        const nextRoomId = roomPath[i + 1];
        const doorway = this.roomGraphBuilder.getDoorway(currentRoomId, nextRoomId);
        if (doorway) {
          pathGoal = this.roomGraphBuilder.getDoorwayCenter(doorway);
        }
      }

      // 在当前房间寻路
      const currentRoomPath = this.findPath(pathStart, pathGoal, currentRoomId, bots, botId);

      // 添加到完整路径（避免重复）
      if (fullPath.length === 0) {
        fullPath.push(...currentRoomPath);
      } else {
        // 跳过第一个点（与前一个房间的最后一个点相同）
        fullPath.push(...currentRoomPath.slice(1));
      }
    }

    return fullPath.length > 0 ? fullPath : [start];
  }

  /**
   * 更新房间
   */
  updateRooms(rooms: Room[]): void {
    this.rooms.clear();
    for (const room of rooms) {
      this.rooms.set(room.id, room);
    }
    this.roomGraphBuilder.updateRooms(rooms);
  }

  /**
   * 更新门洞
   */
  updateDoorways(doorways: Doorway[]): void {
    this.doorways.clear();
    for (const doorway of doorways) {
      this.doorways.set(doorway.id, doorway);
    }

    const rooms = Array.from(this.rooms.values());
    this.roomGraphBuilder.updateDoorways(rooms, doorways);
  }

  /**
   * 添加房间
   */
  addRoom(room: Room): void {
    this.rooms.set(room.id, room);
    this.roomGraphBuilder.updateRooms(Array.from(this.rooms.values()));
  }

  /**
   * 添加门洞
   */
  addDoorway(doorway: Doorway): void {
    this.doorways.set(doorway.id, doorway);
    const rooms = Array.from(this.rooms.values());
    const doorways = Array.from(this.doorways.values());
    this.roomGraphBuilder.updateDoorways(rooms, doorways);
  }

  /**
   * 移除门洞
   */
  removeDoorway(doorwayId: string): void {
    this.doorways.delete(doorwayId);
    const rooms = Array.from(this.rooms.values());
    const doorways = Array.from(this.doorways.values());
    this.roomGraphBuilder.updateDoorways(rooms, doorways);
  }
}
