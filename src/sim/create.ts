import { DAY_SECONDS, MAP_SIZE } from '../data/balance';
import { generateWorld, type Site } from './mapgen';
import { makeCulture, makePerson, villageName } from './people';
import { Rng } from './rng';
import { Sim } from './sim';
import type { GameState } from './state';
import {
    BANDIT,
    KINGDOM,
    WILD,
    type BuildingKind,
    type Point,
    type TeamColor,
    type UnitKind,
    type Village
} from './types';
import { bestCandidate } from './politics';
import { placementProblem } from './buildings';

const INDEPENDENT_COLORS: TeamColor[] = ['Red', 'Purple', 'Yellow', 'Black'];

export const emptyNeeds = () => ({ food: 50, shelter: 50, safety: 50, water: 50, faith: 50, wealth: 50, beauty: 50, warmth: 50 });

const makeVillage = (id: number, name: string, site: Site, stage: Village['stage'], color: TeamColor, culture: Village['culture']): Village => ({
    id,
    name,
    faction: `v${id}`,
    biome: site.biome,
    culture,
    color,
    cx: site.x,
    cy: site.y,
    stage,
    discovered: false,
    stock: stage === 'camp' ? { food: 60, wood: 40, gold: 0, stone: 0 } : { food: 400, wood: 300, gold: 120, stone: 150 },
    leaderId: null,
    playerPresent: false,
    lastVisitAt: 0,
    loyalty: 50,
    unrest: 10,
    unrestHighSince: null,
    happiness: 60,
    needs: emptyNeeds(),
    proposal: null,
    nextProposalAt: 120,
    grievances: [],
    promises: [],
    directives: [],
    focus: null,
    nextThinkAt: 5,
    nextBuildAt: 20,
    nextGrowthAt: 40,
    lastAttackWaveAt: 0,
    tradeRoutes: [],
    eventUntil: {},
    everJoined: false,
    exiledPlayerAt: null,
    aidSentAt: -9999,
    awayReport: []
});

export const newGame = (seed: number): Sim => {
    const world = generateWorld(seed, MAP_SIZE);
    const state: GameState = {
        version: 1,
        seed,
        time: DAY_SECONDS * 0.15,
        nextId: 1,
        rngState: seed ^ 0x5bd1e995,
        map: world.map,
        explored: new Uint8Array(world.map.w * world.map.h),
        units: [],
        buildings: [],
        resources: [],
        villages: [],
        kingdom: {
            explorerId: 0,
            heroName: '',
            explorerDeadUntil: 0,
            respawn: { x: world.center.x + 0.5, y: world.center.y + 0.5 },
            respawnVillageId: null,
            agenda: [],
            techs: []
        },
        diplomacy: { relations: {}, status: {} },
        clock: { nextRaidAt: 300, nextEventAt: 150, nextWildlifeAt: 40, nextDiplomacyAt: 5 },
        log: [],
        requests: [],
        settings: { sightFog: true, pauseOnPopup: true, musicVolume: 0.4, sfxVolume: 0.7 }
    };
    const sim = new Sim(state);
    const rng = new Rng(seed * 7 + 13);

    for (const t of world.trees) sim.addResource('tree', t.x, t.y, 100, t.variant);
    for (const g of world.gold) sim.addResource('gold', g.x, g.y, 400, rng.int(0, 5));
    for (const s of world.stone) sim.addResource('stone', s.x, s.y, 300, rng.int(0, 3));

    const names = new Set<string>();
    let colorIndex = 0;
    for (const site of world.camps) {
        const v = makeVillage(sim.nextId(), villageName(sim.rng, names), site, 'camp', INDEPENDENT_COLORS[colorIndex++ % 4], makeCulture(sim.rng));
        state.villages.push(v);
        sim.villageById.set(v.id, v);
        sim.addBuilding('campHut', v.faction, v.id, site.x - 1, site.y - 1, true);
        const people = sim.rng.int(3, 5);
        for (let i = 0; i < people; i++) {
            sim.spawnUnit('pawn', v.faction, v.id, site.x + sim.rng.range(-2, 2), site.y + 1.6 + sim.rng.range(0, 1), makePerson(sim.rng, v.culture));
        }
        v.loyalty = sim.rng.int(45, 65);
    }

    for (const site of world.villages) {
        const v = makeVillage(sim.nextId(), villageName(sim.rng, names), site, 'village', INDEPENDENT_COLORS[colorIndex++ % 4], makeCulture(sim.rng));
        state.villages.push(v);
        sim.villageById.set(v.id, v);
        buildEstablishedVillage(sim, v);
        v.loyalty = sim.rng.int(30, 55);
    }

    for (const site of world.bandits) spawnBanditCamp(sim, site);

    for (const p of world.sheep) sim.spawnUnit('sheep', WILD, null, p.x + 0.5, p.y + 0.5);
    for (const p of world.wolves) sim.spawnUnit('wolf', WILD, null, p.x + 0.5, p.y + 0.5);
    for (const p of world.bears) sim.spawnUnit('bear', WILD, null, p.x + 0.5, p.y + 0.5);

    const explorer = sim.spawnUnit('explorer', KINGDOM, null, world.center.x + 0.5, world.center.y + 0.5);
    state.kingdom.explorerId = explorer.id;

    sim.log('Welcome, explorer. The world is hidden in fog. Walk out and find people living in small camps.', 'good');
    sim.log('Right-click to move. Drag or use WASD to look around. Press F to follow your explorer.', 'info');
    sim.rebuildSolid();
    return sim;
};

const tryPlace = (sim: Sim, v: Village, kind: BuildingKind, near: Point, radius: number): boolean => {
    for (let attempt = 0; attempt < 60; attempt++) {
        const x = near.x + sim.rng.int(-radius, radius);
        const y = near.y + sim.rng.int(-radius, radius);
        if (!placementProblem(sim, kind, x, y)) {
            sim.addBuilding(kind, v.faction, v.id, x, y, true);
            return true;
        }
    }
    return false;
};

const buildEstablishedVillage = (sim: Sim, v: Village) => {
    sim.addBuilding('townCenter', v.faction, v.id, v.cx - 2, v.cy - 1, true);
    const center = { x: v.cx, y: v.cy };
    for (let i = 0; i < 3; i++) tryPlace(sim, v, 'house', center, 6);
    for (let i = 0; i < 2; i++) tryPlace(sim, v, 'farm', center, 7);
    tryPlace(sim, v, 'barracks', center, 6);
    if (v.culture.includes('pious')) tryPlace(sim, v, 'monastery', center, 7);
    if (v.culture.includes('cautious')) tryPlace(sim, v, 'tower', center, 6);
    if (v.culture.includes('greedy')) tryPlace(sim, v, 'market', center, 7);
    const pop = sim.rng.int(9, 13);
    const soldierKinds: UnitKind[] = ['warrior', 'archer', 'lancer', 'militia'];
    for (let i = 0; i < pop; i++) {
        const kind: UnitKind = i < 3 ? sim.rng.pick(soldierKinds) : 'pawn';
        sim.spawnUnit(kind, v.faction, v.id, v.cx + sim.rng.range(-3, 3), v.cy + 3 + sim.rng.range(0, 1.5), makePerson(sim.rng, v.culture));
    }
    v.leaderId = bestCandidate(sim, v)?.id ?? null;
};

export const spawnBanditCamp = (sim: Sim, site: Point) => {
    sim.addBuilding('goblinTower', BANDIT, null, site.x - 1, site.y - 1, true);
    if (!placementProblem(sim, 'goblinHut', site.x + 3, site.y - 1)) sim.addBuilding('goblinHut', BANDIT, null, site.x + 3, site.y - 1, true);
    if (!placementProblem(sim, 'goblinHut', site.x - 4, site.y)) sim.addBuilding('goblinHut', BANDIT, null, site.x - 4, site.y, true);
    const count = sim.rng.int(4, 6);
    for (let i = 0; i < count; i++) {
        const kind: UnitKind = i === 0 ? 'goblinTnt' : i === count - 1 ? 'goblinBarrel' : 'goblinTorch';
        sim.spawnUnit(kind, BANDIT, null, site.x + sim.rng.range(-2, 3), site.y + 2 + sim.rng.range(0, 1));
    }
};
