import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { idx } from './map';
import type { Sim } from './sim';
import { BANDIT, KINGDOM, WILD, type Building, type Rect, type Unit, type UnitKind } from './types';
import { attackRange, buildingCenter, distToBuilding, performAttack } from './combat';
import {
    RESOURCE_OF,
    carryCapacity,
    completeBuilding,
    farmRate,
    findDropoff,
    gatherRate,
    nearestResource,
    workSpeed
} from './economy';
import { receiveMessenger } from './politics';
import { caravanArrive } from './trade';

const ENGAGE_LEASH = 14;

export const updateUnits = (sim: Sim, dt: number) => {
    const now = sim.state.time;
    for (const u of [...sim.state.units]) {
        if (u.hp <= 0 || !sim.unitById.has(u.id)) continue;
        u.cooldown = Math.max(0, u.cooldown - dt);
        if (now > u.animUntil) u.anim = 'idle';
        stepUnit(sim, u, dt);
    }
    separate(sim);
};

const canFight = (u: Unit) => UNITS[u.kind].damage > 0 && u.kind !== 'monk';

const stepUnit = (sim: Sim, u: Unit, dt: number) => {
    if (u.engageId !== null) {
        const t = sim.unitById.get(u.engageId);
        if (!t || t.hp <= 0 || Math.hypot(t.x - u.homeX, t.y - u.homeY) > ENGAGE_LEASH + UNITS[u.kind].vision) {
            u.engageId = null;
        } else {
            fightUnit(sim, u, t, dt);
            return;
        }
    }
    if (canFight(u) && acquireTarget(sim, u)) return;

    const o = u.order;
    switch (o.type) {
        case 'idle':
            idleBehaviour(sim, u, dt);
            return;
        case 'move': {
            const d = Math.hypot(o.x - u.x, o.y - u.y);
            const x0 = u.x;
            const y0 = u.y;
            const res = d < 0.4 ? 'arrived' : moveTo(sim, u, { x: Math.floor(o.x), y: Math.floor(o.y), w: 1, h: 1 }, `m:${o.x},${o.y}`, dt);
            const stalled = Math.hypot(u.x - x0, u.y - y0) < 0.02;
            if (res === 'stuck' || res === 'arrived' || (d < 1.1 && stalled)) setIdle(sim, u);
            return;
        }
        case 'wander': {
            const d = Math.hypot(o.x - u.x, o.y - u.y);
            const x0 = u.x;
            const y0 = u.y;
            const res = d < 0.4 ? 'arrived' : moveTo(sim, u, { x: Math.floor(o.x), y: Math.floor(o.y), w: 1, h: 1 }, `w:${o.x},${o.y}`, dt);
            if (res === 'stuck' || res === 'arrived' || (d < 1.1 && Math.hypot(u.x - x0, u.y - y0) < 0.02)) setIdle(sim, u);
            return;
        }
        case 'attack': {
            if (o.targetIsBuilding) {
                const b = sim.buildingById.get(o.targetId);
                if (!b || b.hp <= 0) return setIdle(sim, u);
                attackBuilding(sim, u, b, dt);
            } else {
                const t = sim.unitById.get(o.targetId);
                if (!t || t.hp <= 0) return setIdle(sim, u);
                fightUnit(sim, u, t, dt);
            }
            return;
        }
        case 'gather':
            gather(sim, u, o.resourceId, dt);
            return;
        case 'farm':
            farm(sim, u, o.buildingId, dt);
            return;
        case 'returnCargo':
            returnCargo(sim, u, dt);
            return;
        case 'build':
            build(sim, u, o.buildingId, dt);
            return;
        case 'heal': {
            const t = sim.unitById.get(o.targetId);
            if (!t || t.hp >= sim.maxHp(t.kind) || !sim.friendlyFactions(t.faction, u.faction)) return setIdle(sim, u);
            heal(sim, u, t, dt);
            return;
        }
        case 'convert':
            convert(sim, u, dt);
            return;
        case 'talk': {
            const v = sim.village(o.villageId);
            if (!v) return setIdle(sim, u);
            if (Math.hypot(v.cx - u.x, v.cy - u.y) < 4) {
                sim.request({ type: 'talk', villageId: v.id });
                return setIdle(sim, u);
            }
            if (moveTo(sim, u, { x: v.cx, y: v.cy, w: 1, h: 1 }, `t:${v.id}`, dt) === 'stuck') setIdle(sim, u);
            return;
        }
        case 'deliver': {
            const v = sim.village(o.villageId);
            const tc = v && sim.townCenter(v);
            if (!v || !tc) {
                sim.log('A messenger could not find the village and turned back.', 'bad', u);
                sim.removeUnit(u);
                return;
            }
            if (distToBuilding(u.x, u.y, tc) < 1.2) {
                receiveMessenger(sim, v, o.message, o.from);
                sim.removeUnit(u);
                return;
            }
            moveTo(sim, u, tc, `b:${tc.id}`, dt);
            return;
        }
        case 'trade': {
            const target = sim.village(o.leg === 'toSource' ? o.fromVillage : o.toVillage);
            const tc = target && sim.townCenter(target);
            if (!target || !tc) return setIdle(sim, u);
            if (distToBuilding(u.x, u.y, tc) < 1.2) {
                caravanArrive(sim, u, o);
                return;
            }
            moveTo(sim, u, tc, `b:${tc.id}`, dt);
            return;
        }
        case 'follow': {
            const t = sim.unitById.get(o.targetId);
            if (!t) return setIdle(sim, u);
            if (Math.hypot(t.x - u.x, t.y - u.y) > 2.5) moveTo(sim, u, { x: Math.floor(t.x), y: Math.floor(t.y), w: 1, h: 1 }, `u:${t.id}`, dt);
            return;
        }
        default: {
            const never: never = o;
            throw new Error(`Unhandled order ${JSON.stringify(never)}`);
        }
    }
};

export const setIdle = (sim: Sim, u: Unit) => {
    u.order = { type: 'idle' };
    u.path = [];
    u.pathTarget = '';
    u.idleSince = sim.state.time;
    if (u.faction !== WILD && u.faction !== BANDIT) {
        u.homeX = u.x;
        u.homeY = u.y;
    }
};

// ---------- targeting ----------

const acquireTarget = (sim: Sim, u: Unit): boolean => {
    const now = sim.state.time;
    // Self-defence works in every stance.
    if (u.lastAttackerId !== null && now - u.lastHurtAt < 3) {
        const attacker = sim.unitById.get(u.lastAttackerId);
        if (attacker && attacker.hp > 0 && Math.hypot(attacker.x - u.x, attacker.y - u.y) < 8) {
            if (u.stance !== 'hold' || Math.hypot(attacker.x - u.x, attacker.y - u.y) <= attackRange(sim, u) + 0.5) {
                if (u.kind !== 'messenger' && u.kind !== 'caravan') {
                    engage(u, attacker);
                    return true;
                }
            }
        }
    }
    const o = u.order;
    const seeks =
        u.stance === 'aggressive' ||
        u.stance === 'hold' ||
        (o.type === 'move' && o.attackMove);
    if (!seeks) return false;
    if (u.stance === 'aggressive' && u.faction === KINGDOM && (o.type === 'move' && !o.attackMove)) return false;
    if ((sim.scanAt.get(u.id) ?? 0) > now) return false;
    sim.scanAt.set(u.id, now + 0.4 + (u.id % 7) * 0.03);

    let radius = UNITS[u.kind].vision;
    if (u.stance === 'hold') radius = attackRange(sim, u) + 0.5;
    if (u.faction === WILD && u.kind === 'wolf' && !sim.isNight) radius *= 0.6;
    let best: Unit | null = null;
    let bestD = Infinity;
    for (const other of sim.spatial.query(u.x, u.y, radius)) {
        if (other.id === u.id || !sim.wantsToFight(u, other)) continue;
        if (u.faction === KINGDOM && other.faction !== KINGDOM && !sim.visible[idx(sim.state.map, Math.floor(other.x), Math.floor(other.y))]) continue;
        const d = Math.hypot(other.x - u.x, other.y - u.y);
        if (d < bestD) {
            bestD = d;
            best = other;
        }
    }
    if (best) {
        engage(u, best);
        return true;
    }
    return false;
};

const engage = (u: Unit, target: Unit) => {
    if (u.engageId === null) {
        u.homeX = u.x;
        u.homeY = u.y;
    }
    u.engageId = target.id;
};

const fightUnit = (sim: Sim, u: Unit, t: Unit, dt: number) => {
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    const range = attackRange(sim, u);
    if (d <= range + 0.35) {
        u.path = [];
        u.facing = t.x < u.x ? -1 : 1;
        if (u.cooldown <= 0) performAttack(sim, u, t, false);
        return;
    }
    if (u.stance === 'hold' && u.order.type !== 'attack') {
        u.engageId = null;
        return;
    }
    if (d < 2.2 && lineClear(sim, u, t.x, t.y)) {
        stepToward(sim, u, t.x, t.y, dt);
    } else if (moveTo(sim, u, { x: Math.floor(t.x), y: Math.floor(t.y), w: 1, h: 1 }, `u:${t.id}`, dt) === 'stuck') {
        u.engageId = null;
        if (u.order.type === 'attack') setIdle(sim, u);
    }
};

const attackBuilding = (sim: Sim, u: Unit, b: Building, dt: number) => {
    const d = distToBuilding(u.x, u.y, b);
    if (d <= attackRange(sim, u) + 0.3) {
        u.path = [];
        if (u.cooldown <= 0) performAttack(sim, u, b, true);
        return;
    }
    if (u.stance === 'hold') return;
    if (moveTo(sim, u, b, `b:${b.id}`, dt) === 'stuck') setIdle(sim, u);
};

// ---------- idle ----------

const idleBehaviour = (sim: Sim, u: Unit, _dt: number) => {
    const now = sim.state.time;
    if (u.kind === 'monk') {
        const hurt = sim
            .spatial.query(u.x, u.y, UNITS.monk.vision)
            .find((o) => o.hp < sim.maxHp(o.kind) && sim.friendlyFactions(o.faction, u.faction) && o.kind !== 'sheep');
        if (hurt) {
            u.order = { type: 'heal', targetId: hurt.id };
            return;
        }
    }
    const wanders = u.faction === WILD || (u.faction === BANDIT && now - u.idleSince > 6);
    if (wanders && sim.rng.chance(u.kind === 'sheep' ? 0.004 : 0.006)) {
        const r = u.faction === BANDIT ? 4 : 6;
        const tx = u.homeX + sim.rng.range(-r, r);
        const ty = u.homeY + sim.rng.range(-r, r);
        if (!sim.isSolidAt(Math.floor(tx), Math.floor(ty))) {
            const hx = u.homeX;
            const hy = u.homeY;
            u.order = { type: 'wander', x: tx, y: ty };
            u.homeX = hx;
            u.homeY = hy;
        }
    }
};

// ---------- movement ----------

type MoveResult = 'moving' | 'stuck' | 'arrived';

/** Walks toward a goal rectangle along an A* path. Returns 'arrived' when the path is used up. */
export const moveTo = (sim: Sim, u: Unit, goal: Rect, key: string, dt: number): MoveResult => {
    const now = sim.state.time;
    const chasing = key.startsWith('u:');
    if (u.pathTarget !== key || (chasing && now > u.repathAt) || (u.path.length === 0 && now > u.repathAt)) {
        u.path = sim.pathfinder.find(u.x, u.y, goal, sim.passableFor(u.faction));
        u.pathTarget = key;
        u.repathAt = now + (chasing ? 0.8 : 1.5);
        if (u.path.length === 0) {
            const adjacent =
                Math.max(goal.x - u.x, 0, u.x - (goal.x + goal.w)) <= 1.2 && Math.max(goal.y - u.y, 0, u.y - (goal.y + goal.h)) <= 1.2;
            return adjacent ? 'arrived' : 'stuck';
        }
    }
    if (u.path.length === 0) return 'arrived';
    const next = u.path[0];
    if (stepToward(sim, u, next.x, next.y, dt)) u.path.shift();
    return u.path.length === 0 ? 'arrived' : 'moving';
};

const speedOf = (sim: Sim, u: Unit): number => {
    const { map } = sim.state;
    const i = idx(map, Math.max(0, Math.min(map.w - 1, Math.floor(u.x))), Math.max(0, Math.min(map.h - 1, Math.floor(u.y))));
    let s = UNITS[u.kind].speed;
    if (map.road[i]) s *= 1.4;
    if (u.carry && u.carry.amount > 0) s *= 0.9;
    return s;
};

/**
 * Radius of the visible body, in tiles. Two units closer than the sum of their
 * radii are standing on the same pixels.
 */
const bodyRadius = (kind: UnitKind): number => {
    switch (kind) {
        case 'sheep':
            return 0.28;
        case 'wolf':
            return 0.36;
        case 'bear':
            return 0.44;
        case 'explorer':
            return 0.5;
        case 'lancer':
            return 0.42;
        case 'pawn':
        case 'militia':
        case 'archer':
        case 'warrior':
        case 'monk':
        case 'messenger':
        case 'caravan':
        case 'goblinTorch':
        case 'goblinTnt':
        case 'goblinBarrel':
            return 0.4;
        default: {
            const never: never = kind;
            throw new Error(`Unknown unit ${String(never)}`);
        }
    }
};

const nearby: Unit[] = [];

/** True when a straight walk stays on walkable tiles. */
const lineClear = (sim: Sim, u: Unit, tx: number, ty: number): boolean => {
    const dist = Math.hypot(tx - u.x, ty - u.y);
    const steps = Math.max(1, Math.ceil(dist * 2));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (!sim.walkable(u.faction, Math.floor(u.x + (tx - u.x) * t), Math.floor(u.y + (ty - u.y) * t))) return false;
    }
    return true;
};

/** A walkable point on a ring, stable per unit, so crowds don't share one tile. */
const approachPoint = (sim: Sim, u: Unit, cx: number, cy: number, dist: number): { x: number; y: number } => {
    const start = u.id % 8;
    for (let i = 0; i < 8; i++) {
        const a = ((start + i) % 8) * (Math.PI / 4);
        const x = cx + Math.cos(a) * dist;
        const y = cy + Math.sin(a) * dist;
        if (sim.walkable(u.faction, Math.floor(x), Math.floor(y))) return { x, y };
    }
    return { x: cx, y: cy };
};

const slideTo = (sim: Sim, u: Unit, nx: number, ny: number): boolean => {
    const ox = u.x;
    const oy = u.y;
    const free = (x: number, y: number) => sim.walkable(u.faction, Math.floor(x), Math.floor(y));
    if (free(nx, ny)) {
        u.x = nx;
        u.y = ny;
    } else if (free(nx, oy)) u.x = nx;
    else if (free(ox, ny)) u.y = ny;
    return u.x !== ox || u.y !== oy;
};

/** Pulls a walker toward the middle of a one-tile gap so they don't clip the walls. */
const laneBias = (sim: Sim, u: Unit, vx: number, vy: number, step: number): { x: number; y: number } => {
    const tileX = Math.floor(u.x);
    const tileY = Math.floor(u.y);
    const open = (x: number, y: number) => sim.walkable(u.faction, x, y);
    let bx = vx;
    let by = vy;
    if (!open(tileX - 1, tileY) && !open(tileX + 1, tileY)) bx += (tileX + 0.5 - u.x) * 0.65;
    if (!open(tileX, tileY - 1) && !open(tileX, tileY + 1)) by += (tileY + 0.5 - u.y) * 0.65;
    const spd = Math.hypot(bx, by);
    if (spd > step && spd > 0) {
        bx *= step / spd;
        by *= step / spd;
    }
    return { x: bx, y: by };
};

/**
 * The unit closer to the waypoint goes first. Ties break toward the lower id
 * so two sprites never both wait.
 */
const yieldsTo = (u: Unit, o: Unit, tx: number, ty: number): boolean => {
    const mine = Math.hypot(u.x - tx, u.y - ty);
    const theirs = Math.hypot(o.x - tx, o.y - ty);
    if (Math.abs(mine - theirs) <= 0.02) return u.id > o.id;
    return theirs < mine;
};

/** Returns true when the point has been reached. Queues behind other walkers and slides along walls. */
const stepToward = (sim: Sim, u: Unit, tx: number, ty: number, dt: number): boolean => {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return true;
    const step = Math.min(d, speedOf(sim, u) * dt);
    const biased = laneBias(sim, u, (dx / d) * step, (dy / d) * step, step);
    let vx = biased.x;
    let vy = biased.y;
    const ru = bodyRadius(u.kind);
    nearby.length = 0;
    sim.spatial.query(u.x, u.y, ru + 0.6, nearby);
    for (const o of nearby) {
        if (o.id === u.id) continue;
        let ox = o.x - u.x;
        let oy = o.y - u.y;
        let od = Math.hypot(ox, oy);
        const min = ru + bodyRadius(o.kind);
        if (od >= min + step) continue;
        if (od < 0.001) {
            const a = ((u.id * 13 + o.id) % 8) * (Math.PI / 4);
            ox = Math.cos(a);
            oy = Math.sin(a);
            od = 0;
        }
        const nx = od === 0 ? ox : ox / od;
        const ny = od === 0 ? oy : oy / od;
        const into = vx * nx + vy * ny;
        if (o.path.length === 0) {
            const shove = Math.min(0.05, Math.max(0.02, min - od));
            if (!pushOut(sim, o, nx * shove, ny * shove)) {
                pushOut(sim, o, -ny * shove, nx * shove) || pushOut(sim, o, ny * shove, -nx * shove);
            }
            const nd = Math.hypot(o.x - u.x, o.y - u.y);
            if (nd < min && into > 0) {
                vx -= nx * into;
                vy -= ny * into;
            }
            continue;
        }
        if (!yieldsTo(u, o, tx, ty)) continue;
        if (od < min) {
            vx = 0;
            vy = 0;
            break;
        }
        if (into > 0) {
            const allow = od - min;
            const cut = into - allow;
            if (cut > 0) {
                vx -= nx * cut;
                vy -= ny * cut;
            }
        }
    }
    const spd = Math.hypot(vx, vy);
    if (spd < 0.004) return false;
    if (spd > step) {
        vx *= step / spd;
        vy *= step / spd;
    }
    const wantX = u.x + vx;
    const wantY = u.y + vy;
    const moved = slideTo(sim, u, wantX, wantY);
    if (!moved) return false;
    if (Math.abs(dx) > 0.02) u.facing = dx < 0 ? -1 : 1;
    u.anim = u.carry && u.carry.amount > 0 ? 'carry' : 'run';
    const left = Math.hypot(tx - u.x, ty - u.y);
    const slid = Math.hypot(u.x - wantX, u.y - wantY) > 0.001;
    return left <= 0.001 || (slid && left < 0.35);
};

const pushOut = (sim: Sim, u: Unit, px: number, py: number): boolean => slideTo(sim, u, u.x + px, u.y + py);

/** Pushes overlapping sprites apart until their bodies no longer share pixels, and out of walls. */
const separate = (sim: Sim) => {
    for (let pass = 0; pass < 2; pass++) {
        for (const u of sim.state.units) {
            nearby.length = 0;
            sim.spatial.query(u.x, u.y, 1.2, nearby);
            for (const o of nearby) {
                if (o.id <= u.id) continue;
                let dx = o.x - u.x;
                let dy = o.y - u.y;
                let d = Math.hypot(dx, dy);
                const min = bodyRadius(u.kind) + bodyRadius(o.kind);
                if (d >= min) continue;
                const gap = d;
                if (d < 0.001) {
                    const a = ((u.id * 13 + o.id) % 8) * (Math.PI / 4);
                    dx = Math.cos(a);
                    dy = Math.sin(a);
                    d = 1;
                }
                const overlap = Math.min(min - gap, 0.8);
                const nx = dx / d;
                const ny = dy / d;
                if (u.path.length > 0 && o.path.length > 0) {
                    // Single file: ease the trailer back and leave the leader's step alone.
                    const wp = u.path[0];
                    const trailer = Math.hypot(u.x - wp.x, u.y - wp.y) <= Math.hypot(o.x - wp.x, o.y - wp.y) ? o : u;
                    const dir = trailer === u ? -1 : 1;
                    pushOut(sim, trailer, nx * dir * Math.min(overlap, 0.05), ny * dir * Math.min(overlap, 0.05));
                    continue;
                }
                let share = Math.min(overlap * 0.5, 0.12);
                if (!pushOut(sim, u, -nx * share, -ny * share)) share = Math.min(overlap, 0.2);
                const rest = Math.min(overlap - share, 0.2);
                if (!pushOut(sim, o, nx * share, ny * share) && rest > 0) pushOut(sim, u, -nx * rest, -ny * rest);
            }
        }
    }
    for (const u of sim.state.units) {
        if (sim.isSolidAt(Math.floor(u.x), Math.floor(u.y))) nudgeOut(sim, u);
    }
};

const nudgeOut = (sim: Sim, u: Unit) => {
    const cx = Math.floor(u.x);
    const cy = Math.floor(u.y);
    for (let r = 1; r < 6; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                if (!sim.isSolidAt(cx + dx, cy + dy)) {
                    u.x = cx + dx + 0.5;
                    u.y = cy + dy + 0.5;
                    return;
                }
            }
        }
    }
};

// ---------- work ----------

const gather = (sim: Sim, u: Unit, resourceId: number, dt: number) => {
    let r = sim.resourceById.get(resourceId);
    if (!r || r.amount <= 0) {
        const kind = r?.kind;
        const next = kind ? nearestResource(sim, u.x, u.y, kind, 10, resourceId) : null;
        if (next) {
            u.order = { type: 'gather', resourceId: next.id };
            return;
        }
        if (u.carry && u.carry.amount > 0) {
            u.order = { type: 'returnCargo', thenResourceId: null, thenFarmId: null };
        } else setIdle(sim, u);
        return;
    }
    const type = RESOURCE_OF[r.kind];
    const cap = carryCapacity(sim, u);
    if (u.carry && (u.carry.type !== type || u.carry.amount >= cap)) {
        u.order = { type: 'returnCargo', thenResourceId: r.id, thenFarmId: null };
        return;
    }
    const cx = r.x + 0.5;
    const cy = r.y + 0.5;
    const d = Math.hypot(cx - u.x, cy - u.y);
    if (d > 1.55) {
        const spot = approachPoint(sim, u, cx, cy, 1.15);
        if (moveTo(sim, u, { x: Math.floor(spot.x), y: Math.floor(spot.y), w: 1, h: 1 }, `r:${r.id}`, dt) === 'stuck') {
            const alt = nearestResource(sim, u.x, u.y, r.kind, 12, r.id);
            if (alt) u.order = { type: 'gather', resourceId: alt.id };
            else setIdle(sim, u);
        }
        return;
    }
    u.path = [];
    u.facing = r.x + 0.5 < u.x ? -1 : 1;
    u.anim = 'work';
    u.animUntil = sim.state.time + 0.2;
    const amount = Math.min(r.amount, gatherRate(sim, u, r.kind) * dt);
    r.amount -= amount;
    if (!u.carry) u.carry = { type, amount: 0 };
    u.carry.amount += amount;
    if (sim.rng.chance(dt * 0.8)) sim.emit({ type: 'sound', id: r.kind === 'tree' ? 'chop' : 'mine', x: r.x, y: r.y });
    if (r.amount <= 0.01) {
        if (r.kind === 'tree') sim.emit({ type: 'dust', x: r.x + 0.5, y: r.y + 0.5 });
        sim.removeResource(r);
        r = undefined;
    }
    if (u.carry.amount >= cap) u.order = { type: 'returnCargo', thenResourceId: resourceId, thenFarmId: null };
};

const farm = (sim: Sim, u: Unit, farmId: number, dt: number) => {
    const b = sim.buildingById.get(farmId);
    if (!b || b.kind !== 'farm') return setIdle(sim, u);
    if (!b.built) {
        u.order = { type: 'build', buildingId: b.id };
        return;
    }
    const cap = carryCapacity(sim, u);
    if (u.carry && (u.carry.type !== 'food' || u.carry.amount >= cap)) {
        u.order = { type: 'returnCargo', thenResourceId: null, thenFarmId: b.id };
        return;
    }
    const slot = (u.id % 8) * (Math.PI / 4);
    const spotX = b.x + b.w / 2 + Math.cos(slot) * 1.15;
    const spotY = b.y + b.h / 2 + Math.sin(slot) * 1.15;
    const spotD = Math.hypot(spotX - u.x, spotY - u.y);
    if (spotD > 0.35) {
        if (spotD < 3 && lineClear(sim, u, spotX, spotY)) stepToward(sim, u, spotX, spotY, dt);
        else if (moveTo(sim, u, { x: Math.floor(spotX), y: Math.floor(spotY), w: 1, h: 1 }, `f:${b.id}:${u.id % 8}`, dt) === 'stuck') setIdle(sim, u);
        if (spotD > 0.9) return;
    }
    u.anim = 'work';
    u.animUntil = sim.state.time + 0.2;
    if (!u.carry) u.carry = { type: 'food', amount: 0 };
    u.carry.amount += farmRate(sim, b) * workSpeed(u) * dt;
    if (u.carry.amount >= cap) u.order = { type: 'returnCargo', thenResourceId: null, thenFarmId: b.id };
};

const returnCargo = (sim: Sim, u: Unit, dt: number) => {
    const o = u.order;
    if (o.type !== 'returnCargo') return;
    if (!u.carry || u.carry.amount <= 0) {
        u.carry = null;
        resumeWork(sim, u, o.thenResourceId, o.thenFarmId);
        return;
    }
    const drop = findDropoff(sim, u, u.carry.type);
    if (!drop) {
        setIdle(sim, u);
        return;
    }
    if (distToBuilding(u.x, u.y, drop) < 1.1) {
        const v = sim.village(drop.villageId);
        if (v) v.stock[u.carry.type] += u.carry.amount;
        u.carry = null;
        resumeWork(sim, u, o.thenResourceId, o.thenFarmId);
        return;
    }
    if (moveTo(sim, u, drop, `b:${drop.id}`, dt) === 'stuck') setIdle(sim, u);
};

const resumeWork = (sim: Sim, u: Unit, resourceId: number | null, farmId: number | null) => {
    if (farmId !== null && sim.buildingById.has(farmId)) u.order = { type: 'farm', buildingId: farmId };
    else if (resourceId !== null && sim.resourceById.has(resourceId)) u.order = { type: 'gather', resourceId };
    else if (resourceId !== null) {
        setIdle(sim, u);
    } else setIdle(sim, u);
};

const build = (sim: Sim, u: Unit, buildingId: number, dt: number) => {
    const b = sim.buildingById.get(buildingId);
    const max = b ? sim.buildingMaxHp(b) : 0;
    if (!b || (b.built && b.hp >= max) || !sim.friendlyFactions(b.faction, u.faction)) {
        findMoreWork(sim, u, b);
        return;
    }
    const inside = !BUILDINGS[b.kind].blocksMovement;
    const d = distToBuilding(u.x, u.y, b);
    if (d > (inside ? 0.6 : 1.1)) {
        const key = `b:${b.id}`;
        const res = moveTo(sim, u, b, key, dt);
        if (res === 'stuck') setIdle(sim, u);
        return;
    }
    u.path = [];
    u.anim = 'work';
    u.animUntil = sim.state.time + 0.2;
    const c = buildingCenter(b);
    u.facing = c.x < u.x ? -1 : 1;
    const speed = workSpeed(u);
    if (!b.built) {
        const step = (dt / BUILDINGS[b.kind].buildTime) * speed;
        b.progress = Math.min(1, b.progress + step);
        b.hp = Math.min(max, b.hp + max * step * 0.9);
        if (sim.rng.chance(dt * 1.2)) sim.emit({ type: 'sound', id: 'build', x: b.x, y: b.y });
        if (b.progress >= 1) {
            completeBuilding(sim, b);
            if (sim.buildingById.has(b.id) && b.kind === 'farm') {
                u.order = { type: 'farm', buildingId: b.id };
                return;
            }
            findMoreWork(sim, u, b);
        }
    } else {
        b.hp = Math.min(max, b.hp + max * 0.03 * dt * speed);
    }
};

const findMoreWork = (sim: Sim, u: Unit, near: Building | undefined) => {
    const x = near ? near.x : u.x;
    const y = near ? near.y : u.y;
    const next = sim.state.buildings.find(
        (o) => !o.built && o.villageId === u.villageId && o.faction === u.faction && Math.hypot(o.x - x, o.y - y) < 10
    );
    if (next) u.order = { type: 'build', buildingId: next.id };
    else setIdle(sim, u);
};

// ---------- monks ----------

const heal = (sim: Sim, u: Unit, t: Unit, dt: number) => {
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d > UNITS.monk.range) {
        moveTo(sim, u, { x: Math.floor(t.x), y: Math.floor(t.y), w: 1, h: 1 }, `u:${t.id}`, dt);
        return;
    }
    u.path = [];
    u.facing = t.x < u.x ? -1 : 1;
    if (u.cooldown <= 0) {
        const amount = 8 * (u.faction === KINGDOM && sim.hasTech('herbalism') ? 1.5 : 1);
        t.hp = Math.min(sim.maxHp(t.kind), t.hp + amount);
        u.cooldown = UNITS.monk.cooldown;
        u.anim = 'heal';
        u.animUntil = sim.state.time + 1;
        sim.emit({ type: 'heal', x: t.x, y: t.y });
        if (sim.rng.chance(0.3)) sim.emit({ type: 'sound', id: 'heal', x: t.x, y: t.y });
    }
};

const convert = (sim: Sim, u: Unit, dt: number) => {
    const o = u.order;
    if (o.type !== 'convert') return;
    const t = sim.unitById.get(o.targetId);
    if (!t || t.kind === 'explorer' || t.faction === u.faction) return setIdle(sim, u);
    if (sim.state.time < u.convertCooldownUntil) return setIdle(sim, u);
    const d = Math.hypot(t.x - u.x, t.y - u.y);
    if (d > UNITS.monk.range + 1) {
        moveTo(sim, u, { x: Math.floor(t.x), y: Math.floor(t.y), w: 1, h: 1 }, `u:${t.id}`, dt);
        return;
    }
    u.path = [];
    u.anim = 'heal';
    u.animUntil = sim.state.time + 0.3;
    o.progress += dt;
    if (o.progress >= 6) {
        t.faction = u.faction;
        t.villageId = u.villageId;
        t.order = { type: 'idle' };
        t.engageId = null;
        t.stance = 'passive';
        u.convertCooldownUntil = sim.state.time + 25;
        sim.emit({ type: 'convert', x: t.x, y: t.y });
        sim.log(`A monk converted an enemy ${UNITS[t.kind].name} to your side!`, 'good', t);
        setIdle(sim, u);
    }
};
