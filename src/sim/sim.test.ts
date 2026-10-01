import { describe, expect, it } from 'vitest';
import { idx } from './map';
import { generateWorld } from './mapgen';
import { Pathfinder } from './pathfinding';
import { newGame } from './create';
import { deserialize, openSaveText, saveFileName, serialize } from './save';
import { KINGDOM } from './types';
import { joinKingdom, judge, resolveProposal, secede, startProposal } from './politics';
import { VOTE_THRESHOLD } from '../data/balance';
import { makePerson } from './people';
import { createTradeRoute, issueMove, issueSmartCommand, sendMessenger } from './commands';
import { damageBuilding, killUnit } from './combat';
import { carryCapacity } from './economy';
import { startResearch } from './buildings';

const run = (sim: ReturnType<typeof newGame>, seconds: number, dt = 1 / 20) => {
    for (let t = 0; t < seconds; t += dt) sim.update(dt);
};

describe('map generation', () => {
    it('is deterministic for a seed', () => {
        const a = generateWorld(42, 96);
        const b = generateWorld(42, 96);
        expect(Array.from(a.map.ground)).toEqual(Array.from(b.map.ground));
        expect(a.camps).toEqual(b.camps);
    });

    it('produces camps, villages and a walkable center', () => {
        for (const seed of [1, 7, 99, 1234]) {
            const w = generateWorld(seed, 128);
            expect(w.camps.length).toBeGreaterThanOrEqual(4);
            expect(w.villages.length).toBeGreaterThanOrEqual(2);
            const i = w.center.y * 128 + w.center.x;
            expect(w.map.ground[i]).not.toBe(0);
            expect(w.map.elev[i]).toBe(0);
        }
    });
});

describe('pathfinding', () => {
    it('walks around a wall', () => {
        const pf = new Pathfinder(10, 10);
        const wall = (x: number, y: number) => !(x === 5 && y < 8);
        const path = pf.find(1, 1, { x: 8, y: 1, w: 1, h: 1 }, wall);
        expect(path.length).toBeGreaterThan(0);
        const last = path[path.length - 1];
        expect(Math.floor(last.x)).toBe(8);
        expect(path.every((p) => wall(Math.floor(p.x), Math.floor(p.y)))).toBe(true);
    });
});

describe('game simulation', () => {
    it('runs several minutes without errors and keeps the explorer alive', () => {
        const sim = newGame(2024);
        run(sim, 240);
        expect(sim.state.time).toBeGreaterThan(239);
        expect(sim.state.units.length).toBeGreaterThan(20);
        expect(sim.state.explored.some((e) => e === 1)).toBe(true);
    });

    it('keeps a hero name through save, load, and respawn', () => {
        const sim = newGame(21);
        sim.state.kingdom.heroName = 'Alric';
        const copy = deserialize(serialize(sim.state));
        expect(copy.heroName()).toBe('Alric');
        killUnit(copy, copy.explorer()!, null);
        expect(copy.state.log.some((l) => l.text.includes('Alric has fallen'))).toBe(true);
        run(copy, 11);
        expect(copy.heroName()).toBe('Alric');
        expect(copy.state.log.some((l) => l.text.includes('Alric has returned'))).toBe(true);
    });

    it('saves and loads the whole world', () => {
        const sim = newGame(77);
        run(sim, 20);
        const copy = deserialize(serialize(sim.state));
        expect(copy.state.units.length).toBe(sim.state.units.length);
        expect(copy.state.buildings.length).toBe(sim.state.buildings.length);
        expect(Array.from(copy.state.map.block)).toEqual(Array.from(sim.state.map.block));
        run(copy, 10);
    });

    it('names a downloaded save and opens that same file', () => {
        const sim = newGame(77);
        expect(saveFileName(sim.day, 2)).toBe('fogbound-slot-2-day-1.json');
        expect(saveFileName(12.8)).toBe('fogbound-day-12.json');
        const copy = openSaveText(serialize(sim.state));
        expect(copy.state.seed).toBe(sim.state.seed);
        expect(() => openSaveText('not a save')).toThrow(/not a Fogbound Kingdoms save/);
        expect(() => openSaveText('{"version":2}')).toThrow(/incompatible version/);
    });

    it('lets a camp join and grow into a village with a town center', () => {
        const sim = newGame(5);
        const camp = sim.state.villages.find((v) => v.stage === 'camp')!;
        joinKingdom(sim, camp, 'food');
        expect(camp.faction).toBe(KINGDOM);
        expect(camp.stage).toBe('village');
        run(sim, 120);
        const tc = sim.state.buildings.find((b) => b.villageId === camp.id && b.kind === 'townCenter');
        expect(tc).toBeDefined();
        expect(tc!.progress).toBeGreaterThan(0);
    });

    it('lets a warrior beat an archer and a lancer beat a warrior', () => {
        const sim = newGame(3);
        sim.state.kingdom.explorerDeadUntil = 1e9;
        sim.removeUnit(sim.explorer()!);
        const center = sim.state.kingdom.respawn;
        const duel = (a: 'warrior' | 'lancer' | 'archer', b: 'warrior' | 'lancer' | 'archer') => {
            const ua = sim.spawnUnit(a, 'v9001', null, center.x - 2.5, center.y);
            const ub = sim.spawnUnit(b, 'bandit', null, center.x + 2.5, center.y);
            ua.order = { type: 'attack', targetId: ub.id, targetIsBuilding: false };
            ub.order = { type: 'attack', targetId: ua.id, targetIsBuilding: false };
            for (let i = 0; i < 20 * 60 && ua.hp > 0 && ub.hp > 0; i++) sim.update(1 / 20);
            const winner = ua.hp > 0 ? a : b;
            if (ua.hp > 0) sim.removeUnit(ua);
            if (ub.hp > 0) sim.removeUnit(ub);
            return winner;
        };
        expect(duel('warrior', 'archer')).toBe('warrior');
        expect(duel('lancer', 'warrior')).toBe('lancer');
        expect(duel('archer', 'lancer')).toBe('archer');
    });

    it('exiles a player who ignores the people and pushes an unpopular agenda', () => {
        const sim = newGame(11);
        const camp = sim.state.villages.find((v) => v.stage === 'camp')!;
        joinKingdom(sim, camp, null);
        for (let i = 0; i < VOTE_THRESHOLD; i++) {
            const p = makePerson(sim.rng, ['frugal']);
            p.traits = ['frugal', 'peaceful'];
            p.mood = 20;
            sim.spawnUnit('pawn', KINGDOM, camp.id, camp.cx + 1, camp.cy + 2, p);
        }
        sim.state.kingdom.agenda = ['grandeur', 'military'];
        startProposal(sim, camp, { type: 'build', building: 'granary' });
        camp.playerPresent = true;
        resolveProposal(sim, camp, false, 'player');
        camp.loyalty = 15;
        camp.unrest = 70;
        const exiled = judge(sim, camp);
        expect(exiled).toBe(true);
        expect(camp.faction).not.toBe(KINGDOM);
        expect(sim.status(KINGDOM, camp.faction)).toBe('war');
        expect(sim.state.requests.some((r) => r.type === 'exiled')).toBe(true);
    });

    it('respawns the explorer at the last friendly village he visited', () => {
        const sim = newGame(21);
        const camp = sim.state.villages.find((v) => v.stage === 'camp')!;
        joinKingdom(sim, camp, null);
        const e = sim.explorer()!;
        e.x = camp.cx + 1;
        e.y = camp.cy + 2;
        run(sim, 60);
        const tc = sim.townCenter(camp)!;
        expect(tc.built).toBe(true);
        expect(sim.state.kingdom.respawnVillageId).toBe(camp.id);
        sim.explorer()!.x = 5;
        killUnit(sim, sim.explorer()!, null);
        expect(sim.explorer()).toBeUndefined();
        run(sim, 11);
        const back = sim.explorer()!;
        expect(back).toBeDefined();
        expect(Math.hypot(back.x - camp.cx, back.y - camp.cy)).toBeLessThan(8);
    });

    it('lets a monk convert an enemy soldier', () => {
        const sim = newGame(4);
        const c = sim.state.kingdom.respawn;
        const monk = sim.spawnUnit('monk', KINGDOM, null, c.x, c.y);
        const enemy = sim.spawnUnit('warrior', 'v777', null, c.x + 2, c.y);
        enemy.stance = 'hold';
        monk.order = { type: 'convert', targetId: enemy.id, progress: 0 };
        run(sim, 7);
        expect(enemy.faction).toBe(KINGDOM);
    });

    it('delivers a messenger order to a faraway village and the leader answers', () => {
        const sim = newGame(33);
        const [a, b] = sim.state.villages.filter((v) => v.stage === 'camp');
        joinKingdom(sim, a, null);
        joinKingdom(sim, b, null);
        run(sim, 90);
        const e = sim.explorer()!;
        e.x = a.cx + 1;
        e.y = a.cy + 2;
        b.stock.wood += 500;
        b.loyalty = 90;
        expect(sendMessenger(sim, b.id, { type: 'build', building: 'house' })).toBeNull();
        const messenger = sim.state.units.find((u) => u.kind === 'messenger')!;
        expect(messenger).toBeDefined();
        const logBefore = sim.state.log.length;
        run(sim, 120);
        expect(sim.state.units.some((u) => u.kind === 'messenger')).toBe(false);
        const replies = sim.state.log.slice(logBefore).filter((l) => l.text.startsWith('Messenger arrived'));
        expect(replies.length).toBe(1);
    });

    it('lets the kingdom retake an exiled village by capturing its town center', () => {
        const sim = newGame(12);
        const camp = sim.state.villages.find((v) => v.stage === 'camp')!;
        joinKingdom(sim, camp, null);
        run(sim, 90);
        secede(sim, camp, ['test'], 'test');
        expect(camp.faction).not.toBe(KINGDOM);
        const tc = sim.townCenter(camp)!;
        damageBuilding(sim, tc, tc.hp + 10, KINGDOM);
        expect(camp.faction).toBe(KINGDOM);
        expect(sim.state.buildings.includes(tc)).toBe(true);
    });

    it('runs trade caravans between two friendly villages for gold', () => {
        const sim = newGame(44);
        const [a, b] = sim.state.villages.filter((v) => v.stage === 'camp');
        joinKingdom(sim, a, null);
        joinKingdom(sim, b, null);
        const e = sim.explorer()!;
        e.x = a.cx + 1;
        e.y = a.cy + 2;
        run(sim, 90);
        a.stock.wood += 600;
        a.stock.food += 300;
        expect(createTradeRoute(sim, a.id, b.id)).toBeNull();
        const goldBefore = a.stock.gold + b.stock.gold;
        run(sim, 200);
        expect(sim.state.units.some((u) => u.kind === 'caravan')).toBe(true);
        expect(a.stock.gold + b.stock.gold).toBeGreaterThan(goldBefore);
    });

    it('lets independent villages form opinions of each other over time', () => {
        const sim = newGame(99);
        run(sim, 300);
        expect(Object.keys(sim.state.diplomacy.relations).length).toBeGreaterThan(0);
    });

    it('researches a technology that changes the rules', () => {
        const sim = newGame(55);
        const camp = sim.state.villages.find((v) => v.stage === 'camp')!;
        joinKingdom(sim, camp, null);
        const e = sim.explorer()!;
        e.x = camp.cx + 1;
        e.y = camp.cy + 2;
        run(sim, 60);
        const tc = sim.townCenter(camp)!;
        camp.stock.food += 500;
        camp.stock.wood += 500;
        const pawn = sim.citizens(camp.id)[0];
        const before = carryCapacity(sim, pawn);
        expect(startResearch(sim, tc, 'wheelbarrow')).toBeNull();
        run(sim, 35);
        expect(sim.hasTech('wheelbarrow')).toBe(true);
        expect(carryCapacity(sim, pawn)).toBeGreaterThan(before);
    });

    it('sends villagers to chop a tree on right-click', () => {
        const sim = newGame(8);
        const explorer = sim.explorer()!;
        const pawn = sim.spawnUnit('pawn', KINGDOM, null, explorer.x, explorer.y, makePerson(sim.rng));
        const tree = sim.state.resources.find((r) => r.kind === 'tree')!;
        issueSmartCommand(sim, [pawn], tree.x + 0.5, tree.y + 0.5);
        expect(pawn.order.type).toBe('gather');
    });
});

describe('unit collision', () => {
    it('separates villagers who spawn on the same spot', () => {
        const sim = newGame(3);
        const e = sim.explorer()!;
        const a = sim.spawnUnit('pawn', KINGDOM, null, e.x, e.y);
        const b = sim.spawnUnit('pawn', KINGDOM, null, e.x, e.y);
        run(sim, 1);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.75);
    });

    it('keeps villagers off solid tiles while they walk', () => {
        const sim = newGame(4);
        const e = sim.explorer()!;
        const tx = Math.floor(e.x);
        const ty = Math.floor(e.y);
        const map = sim.state.map;
        for (let y = 0; y < map.h; y++) sim.solid[idx(map, tx + 2, y)] = 1;
        const pawn = sim.spawnUnit('pawn', KINGDOM, null, tx + 0.5, ty + 0.5);
        pawn.order = { type: 'move', x: tx + 5.5, y: ty + 0.5, attackMove: false };
        pawn.path = [];
        pawn.pathTarget = '';
        for (let i = 0; i < 60; i++) {
            sim.update(1 / 20);
            expect(sim.isSolidAt(Math.floor(pawn.x), Math.floor(pawn.y))).toBe(false);
        }
    });

    it('files a group through a one-tile gap instead of piling up', () => {
        const sim = newGame(4);
        const e = sim.explorer()!;
        const map = sim.state.map;
        const x = Math.floor(e.x) + 6;
        const y = Math.floor(e.y);
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -4; dx <= 4; dx++) sim.solid[idx(map, x + dx, y + dy)] = dx === 0 && dy !== 0 ? 1 : 0;
        }
        const pawns = [];
        for (let i = 0; i < 4; i++) pawns.push(sim.spawnUnit('pawn', KINGDOM, null, x - 2.2, y + 0.5 + (i - 1.5) * 0.35));
        issueMove(sim, pawns, x + 3.5, y + 0.5);
        run(sim, 12);
        for (const p of pawns) {
            expect(p.x).toBeGreaterThan(x + 0.2);
            expect(sim.isSolidAt(Math.floor(p.x), Math.floor(p.y))).toBe(false);
        }
        for (let i = 0; i < pawns.length; i++) {
            for (let j = i + 1; j < pawns.length; j++) {
                expect(Math.hypot(pawns[i].x - pawns[j].x, pawns[i].y - pawns[j].y)).toBeGreaterThanOrEqual(0.7);
            }
        }
    });

    it('separates a crowd that is standing on one spot', () => {
        const sim = newGame(8);
        const e = sim.explorer()!;
        const pawns = [];
        for (let i = 0; i < 5; i++) pawns.push(sim.spawnUnit('pawn', KINGDOM, null, e.x, e.y));
        run(sim, 2);
        for (let i = 0; i < pawns.length; i++) {
            for (let j = i + 1; j < pawns.length; j++) {
                expect(Math.hypot(pawns[i].x - pawns[j].x, pawns[i].y - pawns[j].y)).toBeGreaterThanOrEqual(0.7);
            }
        }
    });
});
