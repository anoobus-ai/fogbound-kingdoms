import type { Point, Rect } from './types';

export type Passable = (x: number, y: number) => boolean;

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2]
];

/** Binary min-heap of node indices keyed by f-score. */
class Heap {
    private items: number[] = [];
    constructor(private readonly score: Float32Array) {}
    get size() {
        return this.items.length;
    }
    push(n: number) {
        const a = this.items;
        a.push(n);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.score[a[p]] <= this.score[a[i]]) break;
            [a[p], a[i]] = [a[i], a[p]];
            i = p;
        }
    }
    pop(): number {
        const a = this.items;
        const top = a[0];
        const last = a.pop()!;
        if (a.length) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
                if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
                if (m === i) break;
                [a[m], a[i]] = [a[i], a[m]];
                i = m;
            }
        }
        return top;
    }
}

export class Pathfinder {
    private g: Float32Array;
    private f: Float32Array;
    private parent: Int32Array;
    private stamp: Uint32Array;
    private closed: Uint32Array;
    private run = 0;

    constructor(private readonly w: number, private readonly h: number) {
        const n = w * h;
        this.g = new Float32Array(n);
        this.f = new Float32Array(n);
        this.parent = new Int32Array(n);
        this.stamp = new Uint32Array(n);
        this.closed = new Uint32Array(n);
    }

    /**
     * Finds a path from a start tile to any tile touching the goal rectangle (or inside it when it is walkable).
     * If the goal can't be reached, returns the path to the closest reachable tile.
     * The start tile itself is never included in the result.
     */
    find(sx: number, sy: number, goal: Rect, passable: Passable, maxNodes = 9000): Point[] {
        const { w, h } = this;
        sx = Math.max(0, Math.min(w - 1, Math.floor(sx)));
        sy = Math.max(0, Math.min(h - 1, Math.floor(sy)));
        const run = ++this.run;
        const start = sy * w + sx;

        const distToGoal = (x: number, y: number) => {
            const dx = Math.max(goal.x - x, 0, x - (goal.x + goal.w - 1));
            const dy = Math.max(goal.y - y, 0, y - (goal.y + goal.h - 1));
            return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
        };
        const reached = (x: number, y: number) => {
            const inside = x >= goal.x && y >= goal.y && x < goal.x + goal.w && y < goal.y + goal.h;
            if (inside) return true;
            const dx = Math.max(goal.x - x, 0, x - (goal.x + goal.w - 1));
            const dy = Math.max(goal.y - y, 0, y - (goal.y + goal.h - 1));
            return dx <= 1 && dy <= 1 && !(goal.w === 1 && goal.h === 1 && passable(goal.x, goal.y));
        };

        this.stamp[start] = run;
        this.g[start] = 0;
        this.f[start] = distToGoal(sx, sy);
        this.parent[start] = -1;
        const open = new Heap(this.f);
        open.push(start);

        let best = start;
        let bestH = this.f[start];
        let expanded = 0;

        while (open.size) {
            const cur = open.pop();
            if (this.closed[cur] === run) continue;
            this.closed[cur] = run;
            const cx = cur % w;
            const cy = (cur - cx) / w;
            if (reached(cx, cy)) return this.build(cur, start);
            const hCur = distToGoal(cx, cy);
            if (hCur < bestH) {
                bestH = hCur;
                best = cur;
            }
            if (++expanded > maxNodes) break;

            for (const [dx, dy, cost] of DIRS) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                if (!passable(nx, ny)) continue;
                if (dx !== 0 && dy !== 0 && (!passable(cx + dx, cy) || !passable(cx, cy + dy))) continue;
                const n = ny * w + nx;
                if (this.closed[n] === run) continue;
                const g = this.g[cur] + cost;
                if (this.stamp[n] === run && g >= this.g[n]) continue;
                this.stamp[n] = run;
                this.g[n] = g;
                this.f[n] = g + distToGoal(nx, ny) * 1.001;
                this.parent[n] = cur;
                open.push(n);
            }
        }
        return best === start ? [] : this.build(best, start);
    }

    private build(end: number, start: number): Point[] {
        const out: Point[] = [];
        let n = end;
        while (n !== start && n !== -1) {
            const x = n % this.w;
            out.push({ x: x + 0.5, y: (n - x) / this.w + 0.5 });
            n = this.parent[n];
        }
        out.reverse();
        return smooth(out);
    }
}

/** Drops waypoints that sit on a straight line so units walk smoothly. */
const smooth = (path: Point[]): Point[] => {
    if (path.length < 3) return path;
    const out = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const a = out[out.length - 1];
        const b = path[i];
        const c = path[i + 1];
        const d1x = Math.sign(b.x - a.x);
        const d1y = Math.sign(b.y - a.y);
        const d2x = Math.sign(c.x - b.x);
        const d2y = Math.sign(c.y - b.y);
        if (d1x !== d2x || d1y !== d2y) out.push(b);
    }
    out.push(path[path.length - 1]);
    return out;
};
