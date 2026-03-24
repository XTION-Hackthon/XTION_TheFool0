/**
 * PathfindingSystem — Zone-level A* pathfinding
 * Supports Wall and Obstacle as combined obstacles
 * Requirements: 5.1–5.6
 */

import type { Wall, Obstacle, Bot } from '../stores/collisionStore';
import { GridPathfinder, type Point } from './pathfinding/grid-pathfinder';

export type { Point };

export interface ZoneBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export class PathfindingSystem {
  private gridPathfinder: GridPathfinder;
  private zoneBounds: ZoneBounds | null = null;
  private zoneObstacles: Wall[] = []; // walls + obstacles merged as Wall shape

  constructor() {
    this.gridPathfinder = new GridPathfinder();
  }

  /**
   * Update zone bounds and obstacles (walls + obstacles merged).
   * Requirements: 5.6
   */
  updateZone(bounds: ZoneBounds, walls: Wall[], obstacles: Obstacle[]): void {
    this.zoneBounds = bounds;
    // Merge obstacles into wall format for the pathfinder
    const obstaclesAsWalls: Wall[] = obstacles.map((obs) => ({
      id: obs.id,
      zoneId: obs.zoneId,
      x: obs.x,
      y: obs.y,
      width: obs.width,
      height: obs.height,
      rotation: obs.rotation,
      createdAt: obs.createdAt,
    }));
    this.zoneObstacles = [...walls, ...obstaclesAsWalls];
  }

  /**
   * Find path within the zone, treating walls and obstacles as combined obstacles.
   * Requirements: 5.3, 5.4
   */
  findPath(
    start: Point,
    goal: Point,
    bounds: ZoneBounds,
    walls: Wall[],
    obstacles: Obstacle[],
    bots: Bot[] = [],
    botId: string = '',
  ): Point[] {
    const obstaclesAsWalls: Wall[] = obstacles.map((obs) => ({
      id: obs.id,
      zoneId: obs.zoneId,
      x: obs.x,
      y: obs.y,
      width: obs.width,
      height: obs.height,
      rotation: obs.rotation,
      createdAt: obs.createdAt,
    }));
    const allObstacles = [...walls, ...obstaclesAsWalls];

    return this.gridPathfinder.findPath(
      start,
      goal,
      allObstacles,
      bots,
      botId,
      bounds,
    );
  }

  /**
   * Convenience: find path using stored zone state.
   */
  findPathInZone(
    start: Point,
    goal: Point,
    bots: Bot[] = [],
    botId: string = '',
  ): Point[] {
    if (!this.zoneBounds) return [start];

    return this.gridPathfinder.findPath(
      start,
      goal,
      this.zoneObstacles,
      bots,
      botId,
      this.zoneBounds,
    );
  }
}
