// Path-finding over a scene's waypoint graph. Villagers walk from waypoint to
// waypoint along the edges, so they follow the roads instead of cutting
// across buildings. Pure functions: no React, no DOM.

export interface Waypoint {
  id: string;
  x: number;
  y: number;
}

export type Edge = readonly [string, string];

function distance(a: Waypoint, b: Waypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Dijkstra over an undirected graph with straight-line edge lengths. Returns
// the waypoint ids from `from` to `to` inclusive, or null if unreachable.
export function shortestPath(nodes: Waypoint[], edges: readonly Edge[], from: string, to: string): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) return null;
  const neighbors = new Map<string, string[]>();
  for (const [a, b] of edges) {
    if (!byId.has(a) || !byId.has(b)) continue;
    neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    neighbors.set(b, [...(neighbors.get(b) ?? []), a]);
  }

  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set([from]);
  while (open.size) {
    let current = "";
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best) {
        best = d;
        current = id;
      }
    }
    open.delete(current);
    if (current === to) break;
    for (const next of neighbors.get(current) ?? []) {
      const d = best + distance(byId.get(current)!, byId.get(next)!);
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        prev.set(next, current);
        open.add(next);
      }
    }
  }

  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

export function nearestWaypoint(nodes: Waypoint[], x: number, y: number): Waypoint {
  let best = nodes[0];
  for (const n of nodes) {
    if (Math.hypot(n.x - x, n.y - y) < Math.hypot(best.x - x, best.y - y)) best = n;
  }
  return best;
}
