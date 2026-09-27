import { BIOMES } from '../data/biomes';
import { BUILDINGS } from '../data/buildings';
import { DAY_SECONDS, FOOD_PER_CITIZEN_PER_DAY, GROWTH_INTERVAL, IDLE_AUTOWORK_AFTER } from '../data/balance';
import { TRAITS } from '../data/traits';
import { FIGHTER_KINDS, UNITS } from '../data/units';
import { idx, inBounds } from './map';
import { makePerson } from './people';
import type { Sim } from './sim';
import {
    BANDIT,
    Ground,
    KINGDOM,
    WILD,
    type Building,
    type BuildingKind,
    type NeedId,
    type ResourceType,
    type TraitId,
    type Unit,
    type UnitKind,
    type Village
} from './types';
import { findBuildSpot, placeFoundation, popCap, population, queueUnit } from './buildings';
import { distToBuilding, killUnit } from './combat';
import { nearestResource } from './economy';

export const NEED_IDS: NeedId[] = ['food', 'shelter', 'safety', 'water', 'faith', 'wealth', 'beauty', 'warmth'];

export const updateVillages = (sim: Sim, dt: number) => {
    const now = sim.state.time;
    for (const v of sim.state.villages) {
        const pop = population(sim, v);
        consumeFood(sim, v, pop, dt);
        if (Math.floor(now * 2) !== Math.floor((now - dt) * 2)) {
            computeNeeds(sim, v, pop);
            updateMoods(sim, v);
        }
        if (now >= v.nextGrowthAt) grow(sim, v, pop);
        autoWork(sim, v);
        if (now >= v.nextThinkAt) {
            v.nextThinkAt = now + 6 + sim.rng.range(0, 3);
            think(sim, v, pop);
        }
    }
};

// ---------- food ----------

export const dailyFoodUse = (sim: Sim, v: Village, pop: number): number => {
    const winter = sim.season === 'winter' ? (v.biome === 'snow' ? 1.4 : 1.15) : 1;
    return pop * FOOD_PER_CITIZEN_PER_DAY * BIOMES[v.biome].foodUse * winter;
};

const starvingSince = new WeakMap<Village, number>();

const consumeFood = (sim: Sim, v: Village, pop: number, dt: number) => {
    v.stock.food -= (dailyFoodUse(sim, v, pop) / DAY_SECONDS) * dt;
    if (v.stock.food >= 0) {
        starvingSince.delete(v);
        return;
    }
    v.stock.food = 0;
    const since = starvingSince.get(v) ?? sim.state.time;
    starvingSince.set(v, since);
    if (sim.state.time - since > 25) {
        starvingSince.set(v, sim.state.time);
        const victim = sim.citizens(v.id).find((u) => u.id !== v.leaderId && u.kind === 'pawn') ?? sim.citizens(v.id)[0];
        if (victim) {
            if (v.faction === KINGDOM) sim.log(`${v.name} is starving! ${victim.person?.name ?? 'A villager'} has died of hunger.`, 'bad', victim);
            killUnit(sim, victim, null);
            v.unrest = Math.min(100, v.unrest + 8);
        }
    }
};

// ---------- needs ----------

const threatNear = (sim: Sim, v: Village): number => {
    let threat = 0;
    for (const b of sim.state.buildings) {
        if (b.faction === BANDIT && Math.hypot(b.x - v.cx, b.y - v.cy) < 28) threat += 6;
    }
    for (const u of sim.spatial.query(v.cx, v.cy, 14)) {
        if (u.faction === WILD && u.kind !== 'sheep') threat += 4;
        else if (u.faction !== v.faction && sim.hostileFactions(u.faction, v.faction)) threat += 5;
    }
    for (const [key, status] of Object.entries(sim.state.diplomacy.status)) {
        if (status === 'war' && key.split('|').includes(v.faction)) threat += 15;
    }
    return threat;
};

const waterNear = (sim: Sim, v: Village): boolean => {
    const { map } = sim.state;
    for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
            const x = v.cx + dx;
            const y = v.cy + dy;
            if (inBounds(map, x, y) && map.ground[idx(map, x, y)] === Ground.Water) return true;
        }
    }
    return false;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export const computeNeeds = (sim: Sim, v: Village, pop: number) => {
    const built = sim.state.buildings.filter((b) => b.villageId === v.id && b.built);
    const sum = (need: NeedId) => built.reduce((s, b) => s + (BUILDINGS[b.kind].satisfies[need] ?? 0), 0);
    const soldiers = sim.citizens(v.id).filter((u) => UNITS[u.kind].unitClass === 'soldier').length;
    const daily = Math.max(1, dailyFoodUse(sim, v, pop));
    const cap = popCap(sim, v);
    const winter = sim.season === 'winter';

    v.needs.food = clamp((v.stock.food / daily) * 22 + sum('food'));
    v.needs.shelter = clamp(45 + (cap - pop) * 11);
    v.needs.safety = clamp(45 + sum('safety') + soldiers * 4 - threatNear(sim, v));
    v.needs.water = clamp((waterNear(sim, v) ? 55 : v.biome === 'desert' ? 5 : 30) + sum('water'));
    v.needs.faith = clamp(30 + sum('faith'));
    v.needs.wealth = clamp(20 + Math.min(35, v.stock.gold / 8) + sum('wealth'));
    v.needs.beauty = clamp(30 + sum('beauty'));
    const warmthBase = winter ? (v.biome === 'snow' ? 10 : 45) : v.biome === 'snow' ? 45 : 80;
    v.needs.warmth = clamp(warmthBase + sum('warmth') - Math.max(0, pop - cap) * 5);

    const weights = needWeights(sim, v);
    let total = 0;
    let wsum = 0;
    for (const n of NEED_IDS) {
        total += v.needs[n] * weights[n];
        wsum += weights[n];
    }
    v.happiness = wsum > 0 ? total / wsum : 50;
};

/** Biome weights plus what the village's people care about. */
export const needWeights = (sim: Sim, v: Village): Record<NeedId, number> => {
    const w = { ...BIOMES[v.biome].needWeights };
    const people = sim.citizens(v.id);
    const n = Math.max(1, people.length);
    for (const u of people) {
        for (const t of u.person!.traits) {
            for (const [need, extra] of Object.entries(TRAITS[t].needs) as [NeedId, number][]) w[need] = Math.max(0, w[need] + extra / n);
        }
    }
    return w;
};

/** How strongly a person feels about a building kind (-2..2). */
export const personLikes = (traits: readonly TraitId[], kind: BuildingKind): number =>
    traits.reduce((s, t) => s + (TRAITS[t].likes[kind] ?? 0), 0);

const updateMoods = (sim: Sim, v: Village) => {
    const now = sim.state.time;
    const festival = (v.eventUntil.festival ?? 0) > now ? 15 : 0;
    const built = sim.state.buildings.filter((b) => b.villageId === v.id && b.built);
    for (const u of sim.citizens(v.id)) {
        const p = u.person!;
        let likes = 0;
        for (const b of built) likes += personLikes(p.traits, b.kind) * 2;
        const target = clamp(v.happiness + Math.max(-20, Math.min(20, likes)) - v.unrest * 0.25 + festival);
        p.mood += (target - p.mood) * 0.03;
    }
};

// ---------- growth ----------

const grow = (sim: Sim, v: Village, pop: number) => {
    const spring = sim.season === 'spring' ? 0.7 : 1;
    v.nextGrowthAt = sim.state.time + GROWTH_INTERVAL * spring * sim.rng.range(0.8, 1.3);
    if (pop === 0) return;
    const cap = popCap(sim, v);
    if (pop >= cap || v.stock.food < 40 + pop * 5 || v.happiness < 40) return;
    const home = sim.townCenter(v) ?? sim.state.buildings.find((b) => b.villageId === v.id);
    if (!home) return;
    v.stock.food -= 25;
    const u = sim.spawnUnit('pawn', v.faction, v.id, home.x + home.w / 2, home.y + home.h + 0.5, makePerson(sim.rng, v.culture));
    if (v.faction === KINGDOM) sim.log(`${u.person!.name} was born in ${v.name}. (${pop + 1} people)`, 'good', u);
};

// ---------- auto work ----------

const resourceTargets = (sim: Sim, v: Village, pop: number): Record<ResourceType, number> => {
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const traits = leader?.person?.traits ?? v.culture;
    return {
        food: 150 + pop * 12 + (v.biome === 'snow' ? 150 : 0),
        wood: 250,
        gold: traits.includes('greedy') || traits.includes('ambitious') ? 250 : 80,
        stone: traits.includes('cautious') ? 200 : 90
    };
};

const autoWork = (sim: Sim, v: Village) => {
    const now = sim.state.time;
    const idle = sim.state.units.filter(
        (u) => u.villageId === v.id && u.kind === 'pawn' && u.order.type === 'idle' && u.engageId === null && now - u.idleSince > IDLE_AUTOWORK_AFTER
    );
    if (!idle.length) return;
    const pop = population(sim, v);
    const targets = resourceTargets(sim, v, pop);
    for (const u of idle) assignJob(sim, v, u, targets);
};

const assignJob = (sim: Sim, v: Village, u: Unit, targets: Record<ResourceType, number>) => {
    const unbuilt = sim.state.buildings.find(
        (b) =>
            !b.built &&
            b.villageId === v.id &&
            sim.state.units.filter((o) => o.order.type === 'build' && o.order.buildingId === b.id).length < 3
    );
    if (unbuilt) {
        u.order = { type: 'build', buildingId: unbuilt.id };
        return;
    }
    const damaged = sim.state.buildings.find((b) => b.villageId === v.id && b.built && b.hp < sim.buildingMaxHp(b) * 0.6);
    if (damaged && sim.rng.chance(0.5)) {
        u.order = { type: 'build', buildingId: damaged.id };
        return;
    }

    const order: ResourceType[] = (['food', 'wood', 'gold', 'stone'] as ResourceType[]).sort((a, b) => {
        const fa = (v.stock[a] + workersOn(sim, v, a) * 30) / targets[a] - (v.focus === a ? 1 : 0);
        const fb = (v.stock[b] + workersOn(sim, v, b) * 30) / targets[b] - (v.focus === b ? 1 : 0);
        return fa - fb;
    });
    for (const res of order) {
        if (tryJob(sim, v, u, res)) return;
    }
    u.idleSince = sim.state.time;
};

const workersOn = (sim: Sim, v: Village, res: ResourceType): number => {
    let n = 0;
    for (const u of sim.state.units) {
        if (u.villageId !== v.id) continue;
        const o = u.order;
        if (o.type === 'farm' && res === 'food') n++;
        else if (o.type === 'gather') {
            const r = sim.resourceById.get(o.resourceId);
            if (r && ((r.kind === 'tree' && res === 'wood') || (r.kind === res) || (r.kind === 'carcass' && res === 'food'))) n++;
        }
    }
    return n;
};

const tryJob = (sim: Sim, v: Village, u: Unit, res: ResourceType): boolean => {
    switch (res) {
        case 'food': {
            const farm = sim.state.buildings.find(
                (b) =>
                    b.kind === 'farm' &&
                    b.built &&
                    b.villageId === v.id &&
                    sim.state.units.filter((o) => o.order.type === 'farm' && o.order.buildingId === b.id).length < 1
            );
            if (farm) {
                u.order = { type: 'farm', buildingId: farm.id };
                return true;
            }
            const carcass = nearestResource(sim, v.cx, v.cy, 'carcass', 16);
            if (carcass) {
                u.order = { type: 'gather', resourceId: carcass.id };
                return true;
            }
            const sheep = sim.spatial.query(v.cx, v.cy, 14).find((o) => o.kind === 'sheep');
            if (sheep) {
                u.order = { type: 'attack', targetId: sheep.id, targetIsBuilding: false };
                return true;
            }
            return false;
        }
        case 'wood':
        case 'gold':
        case 'stone': {
            const kind = res === 'wood' ? 'tree' : res;
            const node = nearestResource(sim, u.x, u.y, kind, res === 'wood' ? 18 : 22);
            if (node && Math.hypot(node.x - v.cx, node.y - v.cy) < 24) {
                u.order = { type: 'gather', resourceId: node.id };
                return true;
            }
            return false;
        }
        default: {
            const never: never = res;
            throw new Error(`Unknown resource ${String(never)}`);
        }
    }
};

// ---------- AI decisions (leader or independent village) ----------

const AI_LIMITS: Partial<Record<BuildingKind, number>> = {
    market: 1,
    monastery: 1,
    palace: 1,
    oasis: 1,
    well: 2,
    tower: 4,
    barracks: 1,
    archery: 1,
    lumberCamp: 2,
    mine: 1,
    granary: 2,
    garden: 3
};

const AI_CANDIDATES: BuildingKind[] = [
    'house', 'farm', 'lumberCamp', 'mine', 'granary', 'well', 'market', 'barracks', 'archery', 'monastery', 'tower', 'garden', 'oasis', 'palace', 'wall'
];

export const aiRuns = (v: Village): boolean => v.stage === 'village' && (v.faction !== KINGDOM || !v.playerPresent);

export const leaderTraits = (sim: Sim, v: Village): TraitId[] => sim.unitById.get(v.leaderId ?? -1)?.person?.traits ?? v.culture;

const think = (sim: Sim, v: Village, pop: number) => {
    if (v.stage === 'camp') return;
    if (!aiRuns(v)) return;
    runDirectives(sim, v);
    if (sim.state.time >= v.nextBuildAt) {
        v.nextBuildAt = sim.state.time + 12 + sim.rng.range(0, 8);
        decideBuild(sim, v, pop);
    }
    decideMilitary(sim, v, pop);
    commandArmy(sim, v);
};

export const scoreBuilding = (sim: Sim, v: Village, kind: BuildingKind, pop: number): number => {
    const def = BUILDINGS[kind];
    const weights = needWeights(sim, v);
    let score = 0;
    for (const [need, amount] of Object.entries(def.satisfies) as [NeedId, number][]) {
        score += (1 - v.needs[need] / 100) * weights[need] * Math.min(amount, 40) / 12;
    }
    const traits = leaderTraits(sim, v);
    score += personLikes(traits, kind) * 0.6 + personLikes(v.culture, kind) * 0.25;
    const count = (k: BuildingKind) => sim.state.buildings.filter((b) => b.villageId === v.id && b.kind === k).length;
    const cap = popCap(sim, v);
    switch (kind) {
        case 'house':
            score += pop >= cap - 1 ? 3 : pop >= cap - 3 ? 1 : -1;
            break;
        case 'farm':
            score += count('farm') * 3 < pop ? 2.2 : -0.5;
            if (v.needs.food < 40) score += 1.5;
            break;
        case 'lumberCamp':
            score += count('lumberCamp') === 0 ? 0.8 : -0.5;
            break;
        case 'mine':
            score += count('mine') === 0 && pop > 8 ? 0.6 : -1;
            break;
        case 'barracks':
            score += count('barracks') === 0 && (v.needs.safety < 50 || traits.includes('brave')) ? 1.5 : 0;
            break;
        case 'wall':
            score += v.needs.safety < 45 && (traits.includes('cautious') || v.biome === 'forest') ? 1.2 : -2;
            break;
        case 'palace':
        case 'oasis':
            score -= pop < 14 ? 3 : 0.5;
            break;
        default:
            break;
    }
    return score;
};

const decideBuild = (sim: Sim, v: Village, pop: number) => {
    const pending = sim.state.buildings.filter((b) => b.villageId === v.id && !b.built).length;
    if (pending >= 2) return;
    let best: BuildingKind | null = null;
    let bestScore = 0.4;
    for (const kind of AI_CANDIDATES) {
        const limit = AI_LIMITS[kind];
        const have = sim.state.buildings.filter((b) => b.villageId === v.id && b.kind === kind).length;
        if (limit !== undefined && have >= limit) continue;
        if (!sim.canAfford(v.stock, BUILDINGS[kind].cost)) continue;
        const s = scoreBuilding(sim, v, kind, pop) + sim.rng.range(0, 0.3);
        if (s > bestScore) {
            bestScore = s;
            best = kind;
        }
    }
    if (!best) return;
    if (best === 'wall') {
        buildWallRing(sim, v);
        return;
    }
    const near = best === 'lumberCamp' ? nearestResource(sim, v.cx, v.cy, 'tree', 20) : best === 'mine' ? nearestResource(sim, v.cx, v.cy, 'gold', 22) : null;
    const spot = findBuildSpot(sim, v, best, near ?? undefined);
    if (!spot) return;
    const result = placeFoundation(sim, v, best, spot.x, spot.y, v.faction, false);
    if (typeof result !== 'string' && v.faction === KINGDOM) {
        const leader = sim.unitById.get(v.leaderId ?? -1);
        const who = leader?.person?.name ?? 'The people';
        sim.log(`${who} of ${v.name} decided to build a ${BUILDINGS[best].name}.`, 'politics', result);
        v.awayReport.push(`${who} built a ${BUILDINGS[best].name}.`);
    }
};

export const wallRing = (v: Village): { x: number; y: number; gate: boolean }[] => {
    const r = 9;
    const out: { x: number; y: number; gate: boolean }[] = [];
    for (let d = -r; d <= r; d++) {
        const gate = Math.abs(d) <= 0;
        out.push({ x: v.cx + d, y: v.cy - r, gate }, { x: v.cx + d, y: v.cy + r, gate });
        if (Math.abs(d) < r) out.push({ x: v.cx - r, y: v.cy + d, gate }, { x: v.cx + r, y: v.cy + d, gate });
    }
    return out;
};

const buildWallRing = (sim: Sim, v: Village) => {
    let placed = 0;
    for (const t of wallRing(v)) {
        if (placed >= 8) break;
        const kind = t.gate ? 'gate' : 'wall';
        const res = placeFoundation(sim, v, kind, t.x, t.y, v.faction, false);
        if (typeof res !== 'string') placed++;
    }
    if (placed && v.faction === KINGDOM) {
        sim.log(`${v.name} started raising walls to keep danger out.`, 'politics', { x: v.cx, y: v.cy });
        v.awayReport.push('Started raising stone walls around the village.');
    }
};

const decideMilitary = (sim: Sim, v: Village, pop: number) => {
    const traits = leaderTraits(sim, v);
    const brave = traits.includes('brave') || traits.includes('ambitious') ? 0.1 : 0;
    const peaceful = traits.includes('peaceful') ? -0.08 : 0;
    const atWar = Object.entries(sim.state.diplomacy.status).some(([k, s]) => s === 'war' && k.split('|').includes(v.faction));
    const desired = Math.floor(pop * (0.15 + brave + peaceful + (atWar ? 0.25 : 0) + (v.needs.safety < 40 ? 0.1 : 0)));
    const soldiers = sim.citizens(v.id).filter((u) => UNITS[u.kind].unitClass === 'soldier' || u.kind === 'monk').length;
    const queued = sim.state.buildings.reduce((n, b) => (b.villageId === v.id ? n + b.queue.length : n), 0);
    if (soldiers + queued >= desired || v.stock.food < 120) return;
    const producers = sim.state.buildings.filter((b) => b.villageId === v.id && b.built && BUILDINGS[b.kind].trains.some((k) => FIGHTER_KINDS.includes(k)));
    if (!producers.length) return;
    const b = sim.rng.pick(producers);
    const options = BUILDINGS[b.kind].trains.filter((k) => FIGHTER_KINDS.includes(k));
    const pick: UnitKind = traits.includes('frugal') && options.includes('militia') ? 'militia' : sim.rng.pick(options);
    queueUnit(sim, b, pick);
};

/** Sends the army out when at war, and brings stragglers home. */
const commandArmy = (sim: Sim, v: Village) => {
    const now = sim.state.time;
    const soldiers = sim.citizens(v.id).filter((u) => UNITS[u.kind].unitClass === 'soldier');
    const enemies = sim.state.villages.filter((o) => o.id !== v.id && o.stage === 'village' && sim.status(v.faction, o.faction) === 'war');

    for (const s of soldiers) {
        if (s.order.type !== 'idle' || s.engageId !== null) continue;
        const enemyTc = enemies.map((e) => sim.townCenter(e)).find((tc) => tc && distToBuilding(s.x, s.y, tc) < 9);
        if (enemyTc) {
            s.order = { type: 'attack', targetId: enemyTc.id, targetIsBuilding: true };
        } else if (Math.hypot(s.x - v.cx, s.y - v.cy) > 14 && s.faction !== KINGDOM) {
            s.order = { type: 'move', x: v.cx + sim.rng.range(-3, 3), y: v.cy + 4, attackMove: true };
        }
    }

    if (v.faction === KINGDOM || !enemies.length || now - v.lastAttackWaveAt < 100) return;
    const ready = soldiers.filter((s) => s.order.type === 'idle' && Math.hypot(s.x - v.cx, s.y - v.cy) < 14);
    if (ready.length < 5) return;
    const target = enemies.sort((a, b) => Math.hypot(a.cx - v.cx, a.cy - v.cy) - Math.hypot(b.cx - v.cx, b.cy - v.cy))[0];
    v.lastAttackWaveAt = now;
    const wave = ready.slice(0, Math.ceil(ready.length * 0.7));
    for (const s of wave) s.order = { type: 'move', x: target.cx + sim.rng.range(-2, 2), y: target.cy + 3, attackMove: true };
    if (target.faction === KINGDOM || v.faction === KINGDOM) {
        sim.log(`${v.name} is marching ${wave.length} soldiers on ${target.name}!`, 'bad', { x: v.cx, y: v.cy });
        sim.emit({ type: 'sound', id: 'horn' });
    }
};

const runDirectives = (sim: Sim, v: Village) => {
    const d = v.directives.shift();
    if (!d) return;
    switch (d.type) {
        case 'build': {
            const spot = findBuildSpot(sim, v, d.building);
            const res = spot ? placeFoundation(sim, v, d.building, spot.x, spot.y, v.faction, true) : 'No space.';
            if (typeof res === 'string') sim.log(`${v.name} could not build the ${BUILDINGS[d.building].name}: ${res}`, 'bad');
            break;
        }
        case 'train': {
            const b = sim.state.buildings.find((o) => o.villageId === v.id && o.built && BUILDINGS[o.kind].trains.includes(d.unit));
            if (!b) {
                sim.log(`${v.name} has no building to train ${UNITS[d.unit].name}s.`, 'bad');
                break;
            }
            let trained = 0;
            for (let i = 0; i < d.count; i++) if (!queueUnit(sim, b, d.unit)) trained++;
            if (trained < d.count) sim.log(`${v.name} could only afford ${trained} of ${d.count} ${UNITS[d.unit].name}s.`, 'info');
            break;
        }
        case 'focus':
            v.focus = d.resource;
            break;
        case 'sendTroops': {
            const explorer = sim.explorer();
            if (!explorer) break;
            const troops = sim.citizens(v.id).filter((u) => UNITS[u.kind].unitClass === 'soldier').slice(0, 8);
            for (const t of troops) {
                t.stance = 'aggressive';
                t.order = { type: 'follow', targetId: explorer.id };
            }
            sim.log(`${v.name} sends ${troops.length} soldiers to join you.`, 'good');
            break;
        }
        case 'gift':
        case 'alliance':
        case 'peace':
        case 'invite':
            break;
        default: {
            const never: never = d;
            throw new Error(`Unknown directive ${JSON.stringify(never)}`);
        }
    }
};

export const buildingsOf = (sim: Sim, v: Village, kind: BuildingKind): Building[] =>
    sim.state.buildings.filter((b) => b.villageId === v.id && b.kind === kind);
