import type { Wall, Doorway, Bot } from '../../stores';

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface GridNode {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent?: GridNode;
}

/**
 * A* 网格寻路器
 * 基于 32px 网格，支持 8 方向移动
 */
export class GridPathfinder {
  private readonly gridSize = 32;
  private readonly directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];

  /**
   * 查找从起点到目标点的路径
   */
  findPath(
    start: Point,
    goal: Point,
    walls: Wall[],
    doorways: Doorway[],
    _bots: Bot[],
    _botId: string,
    bounds: Bounds,
  ): Point[] {
    const startGrid = this.worldToGrid(start);
    const goalGrid = this.worldToGrid(goal);

    // 检查起点和目标是否可通行
    if (!this.isWalkable(startGrid, walls, doorways, bounds)) {
      return [start];
    }
    if (!this.isWalkable(goalGrid, walls, doorways, bounds)) {
      return [start];
    }

    const openSet = new Map<string, GridNode>();
    const closedSet = new Set<string>();
    const startNode: GridNode = {
      x: startGrid.x,
      y: startGrid.y,
      g: 0,
      h: this.heuristic(startGrid, goalGrid),
      f: this.heuristic(startGrid, goalGrid),
    };

    const key = `${startNode.x},${startNode.y}`;
    openSet.set(key, startNode);

    while (openSet.size > 0) {
      // 找到 f 值最小的节点
      let current: GridNode | null = null;
      let currentKey = '';
      let minF = Infinity;

      for (const [k, node] of openSet) {
        if (node.f < minF) {
          minF = node.f;
          current = node;
          currentKey = k;
        }
      }

      if (!current) break;

      // 到达目标
      if (current.x === goalGrid.x && current.y === goalGrid.y) {
        return this.reconstructPath(current, start, goal);
      }

      openSet.delete(currentKey);
      closedSet.add(currentKey);

      // 扩展邻居
      const neighbors = this.getNeighbors(current, bounds);
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;

        if (closedSet.has(neighborKey)) continue;
        if (!this.isWalkable(neighbor, walls, doorways, bounds)) continue;

        const tentativeG = current.g + this.distance(current, neighbor);
        const existingNode = openSet.get(neighborKey);

        if (existingNode && tentativeG >= existingNode.g) continue;

        const h = this.heuristic(neighbor, goalGrid);
        const node: GridNode = {
          x: neighbor.x,
          y: neighbor.y,
          g: tentativeG,
          h,
          f: tentativeG + h,
          parent: current,
        };

        openSet.set(neighborKey, node);
      }
    }

    // 无法到达，返回起点
    return [start];
  }

  /**
   * 获取网格邻居（8 方向）
   */
  private getNeighbors(node: GridNode, bounds: Bounds): Point[] {
    const neighbors: Point[] = [];

    for (const dir of this.directions) {
      const x = node.x + dir.x;
      const y = node.y + dir.y;

      // 检查边界
      if (x < bounds.x1 || x > bounds.x2 || y < bounds.y1 || y > bounds.y2) {
        continue;
      }

      neighbors.push({ x, y });
    }

    return neighbors;
  }

  /**
   * 欧几里得距离启发式函数
   */
  private heuristic(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 两点间距离
   */
  private distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 检查网格点是否可通行
   */
  private isWalkable(
    point: Point,
    walls: Wall[],
    doorways: Doorway[],
    bounds: Bounds,
  ): boolean {
    // 检查边界
    if (point.x < bounds.x1 || point.x > bounds.x2 || point.y < bounds.y1 || point.y > bounds.y2) {
      return false;
    }

    const worldPoint = this.gridToWorld(point);

    // 检查是否在门洞内
    for (const doorway of doorways) {
      if (this.isPointInDoorway(worldPoint, doorway)) {
        return true;
      }
    }

    // 检查是否在墙体内
    for (const wall of walls) {
      if (this.isPointInWall(worldPoint, wall)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 检查点是否在墙体内
   */
  private isPointInWall(point: Point, wall: Wall): boolean {
    return (
      point.x >= wall.x &&
      point.x <= wall.x + wall.width &&
      point.y >= wall.y &&
      point.y <= wall.y + wall.height
    );
  }

  /**
   * 检查点是否在门洞内
   */
  private isPointInDoorway(point: Point, doorway: Doorway): boolean {
    return (
      point.x >= doorway.x &&
      point.x <= doorway.x + doorway.width &&
      point.y >= doorway.y &&
      point.y <= doorway.y + doorway.height
    );
  }

  /**
   * 世界坐标转网格坐标
   */
  private worldToGrid(point: Point): Point {
    return {
      x: Math.floor(point.x / this.gridSize) * this.gridSize,
      y: Math.floor(point.y / this.gridSize) * this.gridSize,
    };
  }

  /**
   * 网格坐标转世界坐标
   */
  private gridToWorld(point: Point): Point {
    return {
      x: point.x + this.gridSize / 2,
      y: point.y + this.gridSize / 2,
    };
  }

  /**
   * 回溯路径
   */
  private reconstructPath(node: GridNode, start: Point, goal: Point): Point[] {
    const path: Point[] = [];
    let current: GridNode | undefined = node;

    while (current) {
      path.unshift(this.gridToWorld(current));
      current = current.parent;
    }

    // 确保起点和目标点在路径中
    if (path.length === 0 || (path[0].x !== start.x || path[0].y !== start.y)) {
      path.unshift(start);
    }
    if (path[path.length - 1].x !== goal.x || path[path.length - 1].y !== goal.y) {
      path.push(goal);
    }

    return this.smoothPath(path);
  }

  /**
   * 路径平滑：移除不必要的中间点
   */
  private smoothPath(path: Point[]): Point[] {
    if (path.length <= 2) return path;

    const smoothed: Point[] = [path[0]];

    for (let i = 1; i < path.length - 1; i++) {
      const prev = smoothed[smoothed.length - 1];
      const curr = path[i];
      const next = path[i + 1];

      // 检查是否可以直接从 prev 到 next
      if (!this.isLineClear(prev, next)) {
        smoothed.push(curr);
      }
    }

    smoothed.push(path[path.length - 1]);
    return smoothed;
  }

  /**
   * 检查两点间的直线是否清晰（简化版）
   */
  private isLineClear(_from: Point, _to: Point): boolean {
    // 简单实现：检查中点
    // 这里可以扩展为更复杂的线段碰撞检测
    return true;
  }
}
