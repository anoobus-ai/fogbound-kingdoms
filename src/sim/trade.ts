import type { Sim } from './sim';
import { pairKey } from './state';
import { KINGDOM, RESOURCE_TYPES, type Order, type ResourceType, type Unit, type Village } from './types';

const RESERVE = 120;
const LOAD = 60;

const hasMarket = (sim: Sim, v: Village) => sim.state.buildings.some((b) => b.villageId === v.id && b.kind === 'market' && b.built);

export const canTrade = (sim: Sim, a: Village, b: Village): boolean =>
    a.id !== b.id && a.stage === 'village' && b.stage === 'village' && sim.friendlyFactions(a.faction, b.faction);

/** What the source has most of (beyond what it needs to keep). */
const surplus = (v: Village): ResourceType | null => {
    let best: ResourceType | null = null;
    let bestAmount = RESERVE;
    for (const r of RESOURCE_TYPES) {
        if (r === 'gold') continue;
        if (v.stock[r] > bestAmount) {
            bestAmount = v.stock[r];
            best = r;
        }
    }
    return best;
};

export const caravanArrive = (sim: Sim, u: Unit, o: Extract<Order, { type: 'trade' }>) => {
    const from = sim.village(o.fromVillage);
    const to = sim.village(o.toVillage);
    if (!from || !to || !canTrade(sim, from, to)) {
        u.order = { type: 'idle' };
        return;
    }
    if (o.leg === 'toSource') {
        const r = surplus(from);
        u.cargo = { food: 0, wood: 0, gold: 0, stone: 0 };
        if (r) {
            const amount = Math.min(LOAD, from.stock[r] - RESERVE);
            from.stock[r] -= amount;
            u.cargo[r] = amount;
        }
        u.order = { ...o, leg: 'toDest' };
        return;
    }
    const cargo = u.cargo ?? { food: 0, wood: 0, gold: 0, stone: 0 };
    for (const r of RESOURCE_TYPES) to.stock[r] += cargo[r];
    const distance = Math.hypot(from.cx - to.cx, from.cy - to.cy);
    const marketBonus = (hasMarket(sim, from) ? 1.25 : 1) * (hasMarket(sim, to) ? 1.25 : 1);
    const profit = Math.round(distance * 0.35 * marketBonus);
    to.stock.gold += Math.ceil(profit / 2);
    from.stock.gold += Math.floor(profit / 2);
    if (from.faction !== to.faction) {
        const key = pairKey(from.faction, to.faction);
        sim.state.diplomacy.relations[key] = Math.min(100, (sim.state.diplomacy.relations[key] ?? 0) + 2);
    }
    if (to.faction === KINGDOM || from.faction === KINGDOM) {
        sim.emit({ type: 'sound', id: 'coin', x: u.x, y: u.y });
    }
    u.cargo = null;
    u.order = { ...o, leg: 'toSource' };
};
