import { BIOMES } from '../data/biomes';
import { BUILDINGS } from '../data/buildings';
import { TRAITS } from '../data/traits';
import { biomeAt, idx, inBounds } from './map';
import { computeCliffs } from './mapgen';
import type { Sim } from './sim';
import { Ground, KINGDOM, type Building, type ResourceNode, type ResourceType, type Unit } from './types';
import { distToBuilding } from './combat';

export const RESOURCE_OF: Record<ResourceNode['kind'], ResourceType> = {
    tree: 'wood',
    gold: 'gold',
    stone: 'stone',
    carcass: 'food'
};

export const carryCapacity = (sim: Sim, u: Unit): number => (u.faction === KINGDOM && sim.hasTech('wheelbarrow') ? 15 : 10);

export const workSpeed = (u: Unit): number => {
    if (!u.person) return 1;
    return u.person.traits.reduce((m, t) => m * TRAITS[t].workSpeed, 1);
};

export const gatherRate = (sim: Sim, u: Unit, kind: ResourceNode['kind']): number => {
    const k = u.faction === KINGDOM;
    let rate: number;
    switch (kind) {
        case 'tree':
            rate = 0.8 * (k && sim.hasTech('sharpAxes') ? 1.3 : 1);
            break;
        case 'gold':
        case 'stone':
            rate = 0.6 * (k && sim.hasTech('goldPanning') ? 1.3 : 1);
            break;
        case 'carcass':
            rate = 1.3;
            break;
        default: {
            const never: never = kind;
            throw new Error(`Unknown resource ${String(never)}`);
        }
    }
    return rate * workSpeed(u);
};

const nearWater = (sim: Sim, b: Building, r: number): boolean => {
    const { map } = sim.state;
    for (let y = b.y - r; y < b.y + b.h + r; y++) {
        for (let x = b.x - r; x < b.x + b.w + r; x++) {
            if (inBounds(map, x, y) && map.ground[idx(map, x, y)] === Ground.Water) return true;
        }
    }
    return sim.state.buildings.some(
        (o) => o.built && (o.kind === 'well' || o.kind === 'oasis') && distToBuilding(b.x + b.w / 2, b.y + b.h / 2, o) < r + 2
    );
};

/** Food per second a farmer earns on this farm right now. */
export const farmRate = (sim: Sim, farm: Building): number => {
    const biomeId = biomeAt(sim.state.map, farm.x + 1, farm.y + 1);
    const biome = BIOMES[biomeId];
    let rate = 0.55 * biome.farmYield;
    switch (sim.season) {
        case 'spring':
            break;
        case 'summer':
            rate *= 1.1;
            break;
        case 'autumn':
            rate *= 1.4;
            break;
        case 'winter':
            rate *= biome.winterFarm;
            break;
        default: {
            const never: never = sim.season;
            throw new Error(`Unknown season ${String(never)}`);
        }
    }
    const k = farm.faction === KINGDOM;
    if (k && sim.hasTech('cropRotation')) rate *= 1.3;
    if (k && sim.hasTech('irrigation') && (biomeId === 'desert' || biomeId === 'snow')) rate *= 1.5;
    if (nearWater(sim, farm, 4)) rate *= 1.35;
    const v = sim.village(farm.villageId);
    if (v?.eventUntil.drought && v.eventUntil.drought > sim.state.time) rate *= 0.5;
    if (v?.eventUntil.harvest && v.eventUntil.harvest > sim.state.time) rate *= 1.5;
    return rate;
};

export const findDropoff = (sim: Sim, u: Unit, type: ResourceType): Building | null => {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of sim.state.buildings) {
        if (!b.built || !BUILDINGS[b.kind].dropoff.includes(type)) continue;
        const own = u.villageId !== null ? b.villageId === u.villageId : b.faction === u.faction;
        const kingdomShare = u.faction === KINGDOM && b.faction === KINGDOM;
        if (!own && !kingdomShare) continue;
        const d = distToBuilding(u.x, u.y, b) + (own ? 0 : 12);
        if (d < bestD) {
            bestD = d;
            best = b;
        }
    }
    return best;
};

export const nearestResource = (sim: Sim, x: number, y: number, kind: ResourceNode['kind'], maxDist: number, exclude?: number) => {
    let best: ResourceNode | null = null;
    let bestD = maxDist;
    for (const r of sim.state.resources) {
        if (r.kind !== kind || r.id === exclude || r.amount <= 0) continue;
        const d = Math.hypot(r.x + 0.5 - x, r.y + 0.5 - y);
        if (d < bestD) {
            bestD = d;
            best = r;
        }
    }
    return best;
};

export const completeBuilding = (sim: Sim, b: Building) => {
    b.built = true;
    b.progress = 1;
    b.hp = sim.buildingMaxHp(b);
    const { map } = sim.state;
    const v = sim.village(b.villageId);
    sim.emit({ type: 'sound', id: 'complete', x: b.x, y: b.y });
    switch (b.kind) {
        case 'road':
            map.road[idx(map, b.x, b.y)] = 1;
            map.version++;
            sim.removeBuilding(b);
            return;
        case 'pond': {
            sim.removeBuilding(b);
            map.ground[idx(map, b.x, b.y)] = Ground.Water;
            map.road[idx(map, b.x, b.y)] = 0;
            map.version++;
            sim.rebuildSolid();
            return;
        }
        case 'landfill': {
            sim.removeBuilding(b);
            const biome = biomeAt(map, b.x, b.y);
            map.ground[idx(map, b.x, b.y)] = biome === 'snow' ? Ground.Snow : biome === 'desert' ? Ground.Sand : Ground.Grass;
            if (biome === 'water') map.biome[idx(map, b.x, b.y)] = 1;
            computeCliffs(map);
            map.version++;
            sim.rebuildSolid();
            return;
        }
        case 'sapling':
            sim.removeBuilding(b);
            sim.addResource('tree', b.x, b.y, 60, sim.rng.int(0, 3));
            return;
        default:
            break;
    }
    if (v && v.faction === KINGDOM) sim.log(`${v.name} finished building a ${BUILDINGS[b.kind].name}.`, 'good', b);
};

/** A free tile next to a building or resource where a unit can stand. */
export const approachRect = (b: { x: number; y: number; w?: number; h?: number }) => ({ x: b.x, y: b.y, w: b.w ?? 1, h: b.h ?? 1 });
