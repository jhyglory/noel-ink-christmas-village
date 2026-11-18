// Local, side-effect-free pathfinding. Coordinates remain the server's 0–1
// coordinate system; this module never sends or alters positions itself.
const MIN_X = .03, MAX_X = .97, MIN_Y = .15, MAX_Y = .95;
const X_STEPS = 38, Y_STEPS = 32, COLS = X_STEPS + 1, ROWS = Y_STEPS + 1;
const DX = (MAX_X - MIN_X) / X_STEPS, DY = (MAX_Y - MIN_Y) / Y_STEPS;
const COUNT = COLS * ROWS;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const point = (ix, iy) => ({ x: MIN_X + ix * DX, y: MIN_Y + iy * DY });
const inside = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= MIN_X && p.x <= MAX_X && p.y >= MIN_Y && p.y <= MAX_Y;

class MinHeap {
  constructor() { this.items = []; }
  push(value) { const a = this.items; a.push(value); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].score <= value.score) break; a[i] = a[p]; i = p; } a[i] = value; }
  pop() { const a = this.items; if (!a.length) return null; const first = a[0], last = a.pop(); if (a.length) { let i = 0; while (true) { let child = i * 2 + 1; if (child >= a.length) break; if (child + 1 < a.length && a[child + 1].score < a[child].score) child++; if (a[child].score >= last.score) break; a[i] = a[child]; i = child; } a[i] = last; } return first; }
}

/**
 * Find a sequence of walkable waypoints from start to goal, or null if blocked.
 * Both endpoints are continuous {x,y}; isWalkable(x,y) must reject blocked
 * positions. Eight-direction grid movement checks both side cells on diagonal
 * steps, and all returned segments are sampled to prevent cutting corners.
 */
export function findWalkPath(start, goal, isWalkable) {
  if (!inside(start) || !inside(goal) || typeof isWalkable !== 'function') return null;
  const walkable = (x, y) => x >= MIN_X - 1e-9 && x <= MAX_X + 1e-9 && y >= MIN_Y - 1e-9 && y <= MAX_Y + 1e-9 && !!isWalkable(x, y);
  if (!walkable(start.x, start.y) || !walkable(goal.x, goal.y)) return null;
  const clear = (a, b) => {
    const n = Math.max(1, Math.ceil(distance(a, b) / .00025));
    for (let i = 1; i <= n; i++) { const t = i / n; if (!walkable(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false; }
    return true;
  };
  if (clear(start, goal)) return [{ x: goal.x, y: goal.y }];

  // The virtual start and end connect to nearby valid grid nodes so endpoint
  // snapping never teleports through a wall or discards the requested point.
  const nearby = p => {
    const cx = Math.round((p.x - MIN_X) / DX), cy = Math.round((p.y - MIN_Y) / DY), list = [];
    for (let iy = Math.max(0, cy - 2); iy <= Math.min(Y_STEPS, cy + 2); iy++) {
      for (let ix = Math.max(0, cx - 2); ix <= Math.min(X_STEPS, cx + 2); ix++) {
        const v = point(ix, iy); if (walkable(v.x, v.y) && clear(p, v)) list.push({ id: iy * COLS + ix, p: v });
      }
    }
    return list;
  };
  const starts = nearby(start), goals = nearby(goal);
  if (!starts.length || !goals.length) return null;
  const goalNodes = new Set(goals.map(v => v.id));
  const g = new Float64Array(COUNT + 1).fill(Infinity), previous = new Int32Array(COUNT + 1).fill(-1), closed = new Uint8Array(COUNT + 1);
  const heap = new MinHeap(), terminal = COUNT;
  for (const node of starts) { const d = distance(start, node.p); if (d < g[node.id]) { g[node.id] = d; heap.push({ id: node.id, score: d + distance(node.p, goal) }); } }
  while (heap.items.length) {
    const next = heap.pop(), id = next.id;
    if (closed[id]) continue;
    if (id === terminal) {
      const chain = []; let cursor = previous[terminal];
      while (cursor !== -1) { chain.push(point(cursor % COLS, Math.floor(cursor / COLS))); cursor = previous[cursor]; }
      chain.reverse(); chain.push({ x: goal.x, y: goal.y });
      // Preserve graph edges: a long visually straight shortcut can skim a
      // blocked corner even when its endpoints are clear.
      return chain;
    }
    closed[id] = 1;
    const ix = id % COLS, iy = Math.floor(id / COLS), current = point(ix, iy);
    if (goalNodes.has(id)) { const candidate = g[id] + distance(current, goal); if (candidate < g[terminal]) { g[terminal] = candidate; previous[terminal] = id; heap.push({ id: terminal, score: candidate }); } }
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = ix + ox, ny = iy + oy;
      if (nx < 0 || nx > X_STEPS || ny < 0 || ny > Y_STEPS) continue;
      const nId = ny * COLS + nx; if (closed[nId]) continue;
      const target = point(nx, ny);
      if (!walkable(target.x, target.y)) continue;
      if (ox && oy && (!walkable(point(nx, iy).x, point(nx, iy).y) || !walkable(point(ix, ny).x, point(ix, ny).y))) continue;
      if (!clear(current, target)) continue;
      const candidate = g[id] + distance(current, target);
      if (candidate < g[nId]) { g[nId] = candidate; previous[nId] = id; heap.push({ id: nId, score: candidate + distance(target, goal) }); }
    }
  }
  return null;
}
