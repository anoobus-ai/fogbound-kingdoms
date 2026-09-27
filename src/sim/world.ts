import { BANDIT_RAID_INTERVAL, DAY_SECONDS, EVENT_INTERVAL } from '../data/balance';
import { FIRST_NAMES } from '../data/names';
import { UNITS } from '../data/units';
import { biomeAt, idx } from './map';
import { makePerson } from './people';
import type { Sim } from './sim';
import { BANDIT, Ground, KINGDOM, WILD, type Point, type UnitKind, type Village } from './types';
import { killUnit } from './combat';
import { population } from './buildings';
import { spawnBanditCamp } from './create';

const lastSeasonOf = new WeakMap<Sim, string>();

export const updateWorld = (sim: Sim, _dt: number) => {
    const s = sim.state;
    const now = s.time;
    const k = s.kingdom;
    const lastSeason = lastSeasonOf.get(sim) ?? '';

    if (!sim.explorer() && now >= k.explorerDeadUntil) {
        const e = sim.spawnUnit('explorer', KINGDOM, null, k.respawn.x, k.respawn.y);
        k.explorerId = e.id;
        sim.log('Your explorer has returned.', 'good', e);
    }

    for (const r of [...s.resources]) {
        if (r.expiresAt !== null && now > r.expiresAt) sim.removeResource(r);
    }

    const season = sim.season;
    if (season !== lastSeason) {
        if (lastSeason) announceSeason(sim, season);
        lastSeasonOf.set(sim, season);
    }

    if (now >= s.clock.nextRaidAt) {
        s.clock.nextRaidAt = now + BANDIT_RAID_INTERVAL * sim.rng.range(0.7, 1.3);
        banditRaid(sim);
        regrowBandits(sim);
    }
    if (now >= s.clock.nextWildlifeAt) {
        s.clock.nextWildlifeAt = now + 40;
        regrowWildlife(sim);
    }
    if (now >= s.clock.nextEventAt) {
        s.clock.nextEventAt = now + EVENT_INTERVAL * sim.rng.range(0.8, 1.4);
        randomEvent(sim);
    }
};

const announceSeason = (sim: Sim, season: string) => {
    switch (season) {
        case 'winter':
            sim.log('Winter has come. Farms slow down and snowy villages will struggle to stay fed and warm.', 'bad');
            break;
        case 'spring':
            sim.log('Spring has arrived. Villages grow faster.', 'good');
            break;
        case 'summer':
            sim.log('Summer is here. Long days and good harvests.', 'info');
            break;
        case 'autumn':
            sim.log('Autumn — harvest season! Farms yield extra food.', 'good');
            break;
        default:
            break;
    }
};

const goblinsNear = (sim: Sim, p: Point, r: number) => sim.spatial.query(p.x, p.y, r).filter((u) => u.faction === BANDIT);

const banditCamps = (sim: Sim): Point[] => {
    const camps: Point[] = [];
    for (const b of sim.state.buildings) {
        if (b.faction !== BANDIT) continue;
        if (camps.every((c) => Math.hypot(c.x - b.x, c.y - b.y) > 8)) camps.push({ x: b.x + 1, y: b.y + 1 });
    }
    return camps;
};

const banditRaid = (sim: Sim) => {
    const camps = sim.rng.shuffle(banditCamps(sim));
    for (const camp of camps) {
        const goblins = goblinsNear(sim, camp, 8).filter((g) => g.order.type === 'idle' || g.order.type === 'wander');
        if (goblins.length < 3) continue;
        const target = sim.state.villages
            .filter((v) => v.stage === 'village' && Math.hypot(v.cx - camp.x, v.cy - camp.y) < 50)
            .sort((a, b) => Math.hypot(a.cx - camp.x, a.cy - camp.y) - Math.hypot(b.cx - camp.x, b.cy - camp.y))[0];
        if (!target) continue;
        const raiders = goblins.slice(0, Math.min(goblins.length - 1, sim.rng.int(3, 5)));
        for (const g of raiders) g.order = { type: 'move', x: target.cx + sim.rng.range(-2, 2), y: target.cy + sim.rng.range(-2, 2), attackMove: true };
        if (target.faction === KINGDOM) {
            sim.log(`Goblin raiders are heading for ${target.name}!`, 'bad', { x: target.cx, y: target.cy });
            sim.emit({ type: 'sound', id: 'horn' });
        }
        return;
    }
};

const regrowBandits = (sim: Sim) => {
    for (const camp of banditCamps(sim)) {
        if (goblinsNear(sim, camp, 10).length >= 7) continue;
        const kind: UnitKind = sim.rng.pick(['goblinTorch', 'goblinTorch', 'goblinTnt', 'goblinBarrel']);
        sim.spawnUnit(kind, BANDIT, null, camp.x + sim.rng.range(-2, 2), camp.y + 2.5);
    }
    if (banditCamps(sim).length < 2 && sim.rng.chance(0.3)) newBanditCamp(sim);
};

const findWildSpot = (sim: Sim, test: (x: number, y: number) => boolean): Point | null => {
    const { map } = sim.state;
    for (let i = 0; i < 300; i++) {
        const x = sim.rng.int(4, map.w - 5);
        const y = sim.rng.int(4, map.h - 5);
        if (sim.isSolidAt(x, y) || !test(x, y)) continue;
        if (sim.state.villages.some((v) => Math.hypot(v.cx - x, v.cy - y) < 18)) continue;
        return { x: x + 0.5, y: y + 0.5 };
    }
    return null;
};

const newBanditCamp = (sim: Sim) => {
    const spot = findWildSpot(sim, (x, y) => {
        for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 4; dx++) if (sim.isSolidAt(x + dx, y + dy)) return false;
        return true;
    });
    if (!spot) return;
    spawnBanditCamp(sim, { x: Math.floor(spot.x), y: Math.floor(spot.y) });
    sim.log('Rumours say a new goblin camp has appeared somewhere in the wilds.', 'bad');
};

const regrowWildlife = (sim: Sim) => {
    const count = (k: UnitKind) => sim.state.units.filter((u) => u.kind === k).length;
    const { map } = sim.state;
    if (count('sheep') < 30) {
        const p = findWildSpot(sim, (x, y) => biomeAt(map, x, y) === 'grassland');
        if (p) for (let i = 0; i < 2; i++) sim.spawnUnit('sheep', WILD, null, p.x + sim.rng.range(-1, 1), p.y + sim.rng.range(-1, 1));
    }
    if (count('wolf') < 10 && sim.rng.chance(0.4)) {
        const p = findWildSpot(sim, (x, y) => ['forest', 'snow'].includes(biomeAt(map, x, y)));
        if (p) for (let i = 0; i < 2; i++) sim.spawnUnit('wolf', WILD, null, p.x + sim.rng.range(-1, 1), p.y);
    }
    if (count('bear') < 4 && sim.rng.chance(0.2)) {
        const p = findWildSpot(sim, (x, y) => ['forest', 'snow'].includes(biomeAt(map, x, y)));
        if (p) sim.spawnUnit('bear', WILD, null, p.x, p.y);
    }
};

// ---------- random events ----------

const kingdomVillages = (sim: Sim): Village[] => sim.state.villages.filter((v) => v.faction === KINGDOM && v.stage === 'village');

const randomEvent = (sim: Sim) => {
    const villages = kingdomVillages(sim);
    if (!villages.length) return;
    const v = sim.rng.pick(villages);
    const now = sim.state.time;
    const at = { x: v.cx, y: v.cy };
    const roll = sim.rng.int(0, 7);
    switch (roll) {
        case 0:
            if (sim.season === 'winter') return;
            v.eventUntil.drought = now + DAY_SECONDS * 2;
            sim.request({ type: 'event', title: `Drought in ${v.name}`, text: 'The rains have failed. Farms there produce half as much food for two days. Wells and ponds help.' });
            sim.log(`Drought strikes ${v.name}.`, 'bad', at);
            return;
        case 1: {
            if (population(sim, v) < 8) return;
            const protectedByFaith = sim.hasTech('herbalism') || sim.state.buildings.some((b) => b.villageId === v.id && b.kind === 'monastery' && b.built);
            const deaths = protectedByFaith ? 0 : sim.rng.int(1, 2);
            const victims = sim.citizens(v.id).filter((u) => u.id !== v.leaderId).slice(0, deaths);
            victims.forEach((u) => killUnit(sim, u, null));
            sim.request({
                type: 'event',
                title: `Sickness in ${v.name}`,
                text: protectedByFaith ? 'A plague reached the village, but the monks nursed everyone back to health.' : `A plague swept through the village. ${deaths} villager(s) died. A Monastery or Herbalism protects against this.`
            });
            return;
        }
        case 2:
            sim.request({ type: 'merchant', x: v.cx, y: v.cy, villageId: v.id });
            sim.log(`A traveling merchant has arrived in ${v.name}.`, 'good', at);
            return;
        case 3:
            v.eventUntil.festival = now + DAY_SECONDS;
            sim.log(`${v.name} is holding a festival! Everyone is in a good mood.`, 'good', at);
            sim.emit({ type: 'sound', id: 'bell' });
            return;
        case 4: {
            const explorer = sim.explorer();
            if (!explorer) return;
            const hero = sim.spawnUnit('warrior', KINGDOM, v.id, v.cx + 1, v.cy + 3, makePerson(sim.rng, ['brave', 'loyal']));
            hero.person!.name = `${sim.rng.pick(FIRST_NAMES)} the Wanderer`;
            sim.request({ type: 'event', title: 'A wandering hero', text: `${hero.person!.name}, a seasoned warrior, has joined ${v.name}.` });
            return;
        }
        case 5:
            if (sim.season === 'winter') return;
            v.eventUntil.harvest = now + DAY_SECONDS * 2;
            sim.log(`A bountiful harvest in ${v.name}! Farms yield 50% more for two days.`, 'good', at);
            return;
        case 6: {
            const spot = { x: v.cx + sim.rng.pick([-12, 12]), y: v.cy + sim.rng.int(-6, 6) };
            if (sim.isSolidAt(spot.x, spot.y) || sim.state.map.ground[idx(sim.state.map, spot.x, spot.y)] === Ground.Water) return;
            for (let i = 0; i < 3; i++) {
                const w = sim.spawnUnit('wolf', WILD, null, spot.x + sim.rng.range(-1, 1), spot.y + sim.rng.range(-1, 1));
                w.order = { type: 'move', x: v.cx, y: v.cy, attackMove: true };
            }
            sim.log(`A wolf pack is prowling toward ${v.name}! ${UNITS.wolf.description}`, 'bad', at);
            return;
        }
        case 7:
            newBanditCamp(sim);
            return;
        default:
            return;
    }
};

export const MERCHANT_DEALS = [
    { give: { gold: 40 }, get: { food: 150 }, label: 'Buy 150 food for 40 gold' },
    { give: { gold: 40 }, get: { wood: 150 }, label: 'Buy 150 wood for 40 gold' },
    { give: { gold: 50 }, get: { stone: 100 }, label: 'Buy 100 stone for 50 gold' },
    { give: { food: 200 }, get: { gold: 50 }, label: 'Sell 200 food for 50 gold' },
    { give: { wood: 200 }, get: { gold: 50 }, label: 'Sell 200 wood for 50 gold' }
];
