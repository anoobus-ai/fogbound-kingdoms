import { BUILDINGS } from '../data/buildings';
import { NIGHT_VISION_MULT } from '../data/balance';
import { UNITS } from '../data/units';
import { idx } from './map';
import type { Sim } from './sim';
import { KINGDOM } from './types';

const reveal = (sim: Sim, cx: number, cy: number, r: number) => {
    const { map, explored } = sim.state;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(map.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(map.h - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
            const dx = x + 0.5 - cx;
            const dy = y + 0.5 - cy;
            if (dx * dx + dy * dy > r2) continue;
            const i = idx(map, x, y);
            sim.visible[i]++;
            explored[i] = 1;
        }
    }
};

/** Recomputes what the player can see right now and permanently reveals it. */
export const updateFog = (sim: Sim) => {
    sim.visible.fill(0);
    const night = sim.isNight ? NIGHT_VISION_MULT : 1;
    for (const u of sim.state.units) {
        if (u.faction !== KINGDOM) continue;
        reveal(sim, u.x, u.y, UNITS[u.kind].vision * night);
    }
    for (const b of sim.state.buildings) {
        if (b.faction !== KINGDOM) continue;
        reveal(sim, b.x + b.w / 2, b.y + b.h / 2, BUILDINGS[b.kind].vision + Math.max(b.w, b.h) / 2);
    }
    const { map, explored } = sim.state;
    for (const v of sim.state.villages) {
        if (!v.discovered && explored[idx(map, v.cx, v.cy)]) {
            v.discovered = true;
            if (v.faction !== KINGDOM) {
                sim.log(
                    v.stage === 'camp' ? `You discovered a small camp: ${v.name}. Go talk to them!` : `You discovered the village of ${v.name}.`,
                    'good',
                    { x: v.cx, y: v.cy }
                );
                sim.emit({ type: 'sound', id: 'bell' });
            }
        }
    }
};

export const isVisible = (sim: Sim, x: number, y: number): boolean => {
    const { map } = sim.state;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    return sim.visible[idx(map, tx, ty)] > 0;
};

export const isExplored = (sim: Sim, x: number, y: number): boolean => {
    const { map } = sim.state;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
    return sim.state.explored[idx(map, tx, ty)] === 1;
};
