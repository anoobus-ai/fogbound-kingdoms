import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { idx } from './map';
import type { Sim } from './sim';
import { BANDIT, KINGDOM, WILD, type Building, type Rect, type Unit } from './types';
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
            const arrived = Math.hypot(o.x - u.x, o.y - u.y) < 0.35;
            if (arrived || moveTo(sim, u, { x: Math.floor(o.x), y: Math.floor(o.y), w: 1, h: 1 }, `m:${o.x},${o.y}`, dt) === 'stuck') {
                setIdle(sim, u);
            }
            return;
        }
        case 'wander': {
            if (Math.hypot(o.x - u.x, o.y - u.y) < 0.4 || moveTo(sim, u, { x: Math.floor(o.x), y: Math.floor(o.y), w: 1, h: 1 }, `w:${o.x},${o.y}`, dt) === 'stuck') {
                setIdle(sim, u);
            }
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
    if (d < 2.2) {
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

/** Returns true when the point has been reached. */
const stepToward = (sim: Sim, u: Unit, tx: number, ty: number, dt: number): boolean => {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return true;
    const step = Math.min(d, speedOf(sim, u) * dt);
    u.x += (dx / d) * step;
    u.y += (dy / d) * step;
    if (Math.abs(dx) > 0.02) u.facing = dx < 0 ? -1 : 1;
    u.anim = u.carry && u.carry.amount > 0 ? 'carry' : 'run';
    return step >= d - 0.001;
};

/** Gently pushes overlapping units apart and out of walls. */
const separate = (sim: Sim) => {
    const near: Unit[] = [];
    for (const u of sim.state.units) {
        near.length = 0;
        sim.spatial.query(u.x, u.y, 0.5, near);
        for (const o of near) {
            if (o.id <= u.id) continue;
            let dx = o.x - u.x;
            let dy = o.y - u.y;
            let d = Math.hypot(dx, dy);
            if (d < 0.001) {
                dx = ((u.id % 3) - 1) * 0.01 + 0.01;
                dy = ((o.id % 3) - 1) * 0.01;
                d = Math.hypot(dx, dy);
            }
            if (d >= 0.5) continue;
            const push = (0.5 - d) * 0.25;
            const px = (dx / d) * push;
            const py = (dy / d) * push;
            if (!sim.isSolidAt(Math.floor(u.x - px), Math.floor(u.y - py))) {
                u.x -= px;
                u.y -= py;
            }
            if (!sim.isSolidAt(Math.floor(o.x + px), Math.floor(o.y + py))) {
                o.x += px;
                o.y += py;
            }
        }
        if (sim.isSolidAt(Math.floor(u.x), Math.floor(u.y)) && u.path.length === 0) nudgeOut(sim, u);
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
    const d = Math.hypot(r.x + 0.5 - u.x, r.y + 0.5 - u.y);
    if (d > 1.25) {
        if (moveTo(sim, u, { x: r.x, y: r.y, w: 1, h: 1 }, `r:${r.id}`, dt) === 'stuck') {
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
    const spotX = b.x + 0.7 + ((u.id * 7) % 16) / 10;
    const spotY = b.y + 0.9 + ((u.id * 3) % 12) / 10;
    if (Math.hypot(spotX - u.x, spotY - u.y) > 0.3) {
        if (Math.hypot(spotX - u.x, spotY - u.y) < 3) stepToward(sim, u, spotX, spotY, dt);
        else if (moveTo(sim, u, { x: Math.floor(spotX), y: Math.floor(spotY), w: 1, h: 1 }, `f:${b.id}`, dt) === 'stuck') setIdle(sim, u);
        return;
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
