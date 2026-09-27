import { BUILDINGS, isTerraform } from '../data/buildings';
import { TECHS } from '../data/techs';
import { UNITS, isCitizenKind } from '../data/units';
import { idx, inBounds, isBuildableTerrain } from './map';
import { makePerson } from './people';
import type { Sim } from './sim';
import { Ground, KINGDOM, type Building, type BuildingKind, type FactionId, type TechId, type UnitKind, type Village } from './types';
import { buildingCenter, damageUnit } from './combat';

export const updateBuildings = (sim: Sim, dt: number) => {
    for (const b of [...sim.state.buildings]) {
        if (!sim.buildingById.has(b.id) || !b.built) continue;
        if (b.queue.length) train(sim, b, dt);
        if (b.research) research(sim, b, dt);
        const def = BUILDINGS[b.kind];
        if (def.attack) shoot(sim, b, dt);
        if (b.kind === 'market') {
            const v = sim.village(b.villageId);
            if (v) v.stock.gold += 0.05 * dt;
        }
    }
};

export const popCap = (sim: Sim, v: Village): number =>
    sim.state.buildings.reduce((sum, b) => (b.villageId === v.id && b.built ? sum + BUILDINGS[b.kind].popCap : sum), 0);

export const population = (sim: Sim, v: Village): number => sim.state.units.filter((u) => u.villageId === v.id && u.person).length;

const train = (sim: Sim, b: Building, dt: number) => {
    const v = sim.village(b.villageId);
    if (!v) return;
    const item = b.queue[0];
    const needsRoom = isCitizenKind(item.unit);
    if (needsRoom && population(sim, v) >= popCap(sim, v)) return;
    item.progress += dt / Math.max(1, UNITS[item.unit].trainTime);
    if (item.progress < 1) return;
    b.queue.shift();
    const spot = freeSpotNear(sim, b);
    const person = needsRoom ? makePerson(sim.rng, v.culture) : null;
    const u = sim.spawnUnit(item.unit, b.faction, v.id, spot.x, spot.y, person);
    if (item.unit === 'caravan') {
        const dest = v.tradeRoutes.map((id) => sim.village(id)).find((o) => o);
        if (dest) u.order = { type: 'trade', fromVillage: v.id, toVillage: dest.id, leg: 'toSource' };
    }
    if (b.faction === KINGDOM) sim.emit({ type: 'sound', id: 'bell', x: b.x, y: b.y });
};

const research = (sim: Sim, b: Building, dt: number) => {
    const r = b.research!;
    r.progress += dt / TECHS[r.tech].time;
    if (r.progress < 1) return;
    b.research = null;
    if (b.faction === KINGDOM && !sim.hasTech(r.tech)) {
        sim.state.kingdom.techs.push(r.tech);
        sim.log(`Research complete: ${TECHS[r.tech].name}. ${TECHS[r.tech].description}`, 'good', b);
        sim.emit({ type: 'sound', id: 'complete' });
        if (r.tech === 'masonry') {
            for (const o of sim.state.buildings) if (o.faction === KINGDOM && o.built) o.hp = Math.round(o.hp * 1.3);
        }
    }
};

const shoot = (sim: Sim, b: Building, dt: number) => {
    b.cooldown -= dt;
    if (b.cooldown > 0) return;
    const def = BUILDINGS[b.kind];
    const atk = def.attack!;
    const fletch = b.faction === KINGDOM && sim.hasTech('fletching');
    const range = atk.range + (fletch && b.kind === 'tower' ? 1 : 0);
    const c = buildingCenter(b);
    let target = null;
    let bestD = Infinity;
    for (const u of sim.spatial.query(c.x, c.y, range + 1.5)) {
        if (!sim.hostileFactions(b.faction, u.faction) || u.kind === 'sheep') continue;
        const d = Math.hypot(u.x - c.x, u.y - c.y);
        if (d < bestD) {
            bestD = d;
            target = u;
        }
    }
    if (!target) return;
    b.cooldown = atk.cooldown;
    sim.emit({ type: 'arrow', fromX: c.x, fromY: b.y + 0.5, toX: target.x, toY: target.y });
    const dmg = atk.damage + (fletch ? 2 : 0) - sim.armorOf(target);
    damageUnit(sim, target, Math.max(1, dmg), null);
};

export const freeSpotNear = (sim: Sim, b: Building) => {
    const cx = b.x + Math.floor(b.w / 2);
    const cy = b.y + b.h;
    for (let r = 0; r < 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                if (!sim.isSolidAt(cx + dx, cy + dy)) return { x: cx + dx + 0.5 + sim.rng.range(-0.2, 0.2), y: cy + dy + 0.5 };
            }
        }
    }
    return { x: cx + 0.5, y: cy + 0.5 };
};

/** Can this building go here? Returns a reason when it can't. */
export const placementProblem = (sim: Sim, kind: BuildingKind, x: number, y: number): string | null => {
    const def = BUILDINGS[kind];
    const { map } = sim.state;
    if (kind === 'landfill') {
        if (!inBounds(map, x, y) || map.ground[idx(map, x, y)] !== Ground.Water) return 'Landfill must go on water.';
        const touchesLand = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
            ([dx, dy]) => inBounds(map, x + dx, y + dy) && map.ground[idx(map, x + dx, y + dy)] !== Ground.Water
        );
        return touchesLand ? null : 'Landfill must touch the shore.';
    }
    for (let ty = y; ty < y + def.h; ty++) {
        for (let tx = x; tx < x + def.w; tx++) {
            if (!isBuildableTerrain(map, tx, ty)) return 'You can only build on flat land.';
            if (map.block[idx(map, tx, ty)] !== 0) return 'Something is already there.';
            if (kind === 'road' && map.road[idx(map, tx, ty)]) return 'There is already a road.';
        }
    }
    if (!isTerraform(kind) && kind !== 'wall' && kind !== 'gate') {
        // Leave a walkway around buildings so villagers never get boxed in.
        for (let ty = y - 1; ty <= y + def.h; ty++) {
            for (let tx = x - 1; tx <= x + def.w; tx++) {
                if (!inBounds(map, tx, ty)) continue;
                const id = map.block[idx(map, tx, ty)];
                const other = id ? sim.buildingById.get(id) : undefined;
                if (other && BUILDINGS[other.kind].blocksMovement && def.blocksMovement && other.kind !== 'wall' && other.kind !== 'gate') {
                    return 'Too close to another building.';
                }
            }
        }
    }
    return null;
};

/** Finds a spot for an AI-placed building, spiralling out from the village center. */
export const findBuildSpot = (sim: Sim, v: Village, kind: BuildingKind, near?: { x: number; y: number }): { x: number; y: number } | null => {
    const def = BUILDINGS[kind];
    const ox = near ? near.x : v.cx;
    const oy = near ? near.y : v.cy;
    for (let r = near ? 1 : 3; r < 14; r++) {
        const candidates: { x: number; y: number }[] = [];
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                candidates.push({ x: ox + dx - Math.floor(def.w / 2), y: oy + dy - Math.floor(def.h / 2) });
            }
        }
        sim.rng.shuffle(candidates);
        for (const c of candidates) {
            if (!placementProblem(sim, kind, c.x, c.y)) return c;
        }
    }
    return null;
};

export const queueUnit = (sim: Sim, b: Building, unit: UnitKind): string | null => {
    const v = sim.village(b.villageId);
    if (!v) return 'No village.';
    if (!b.built) return 'Not finished yet.';
    if (!BUILDINGS[b.kind].trains.includes(unit)) return 'Cannot train that here.';
    if (b.queue.length >= 6) return 'The queue is full.';
    const cost = UNITS[unit].cost;
    if (!sim.canAfford(v.stock, cost)) return `Not enough resources in ${v.name}.`;
    sim.pay(v.stock, cost);
    b.queue.push({ unit, progress: 0 });
    return null;
};

export const cancelQueued = (sim: Sim, b: Building, index: number) => {
    const v = sim.village(b.villageId);
    const item = b.queue[index];
    if (!item || !v) return;
    b.queue.splice(index, 1);
    sim.refund(v.stock, UNITS[item.unit].cost);
};

export const startResearch = (sim: Sim, b: Building, tech: TechId): string | null => {
    const v = sim.village(b.villageId);
    if (!v || !b.built) return 'Not available.';
    if (sim.hasTech(tech)) return 'Already researched.';
    if (b.research) return 'Already researching.';
    if (sim.state.buildings.some((o) => o.research?.tech === tech)) return 'Already being researched elsewhere.';
    const def = TECHS[tech];
    if (def.requires && !sim.hasTech(def.requires)) return `Requires ${TECHS[def.requires].name}.`;
    if (!sim.canAfford(v.stock, def.cost)) return `Not enough resources in ${v.name}.`;
    sim.pay(v.stock, def.cost);
    b.research = { tech, progress: 0 };
    return null;
};

export const placeFoundation = (
    sim: Sim,
    v: Village,
    kind: BuildingKind,
    x: number,
    y: number,
    faction: FactionId,
    byPlayer: boolean
): Building | string => {
    const problem = placementProblem(sim, kind, x, y);
    if (problem) return problem;
    const cost = BUILDINGS[kind].cost;
    if (!sim.canAfford(v.stock, cost)) return `${v.name} can't afford a ${BUILDINGS[kind].name}.`;
    sim.pay(v.stock, cost);
    const b = sim.addBuilding(kind, faction, v.id, x, y, false);
    b.orderedByPlayer = byPlayer;
    return b;
};
