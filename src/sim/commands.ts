import { BUILDINGS } from '../data/buildings';
import { COMMAND_RADIUS } from '../data/balance';
import { MAX_AGENDA } from '../data/techs';
import { UNITS } from '../data/units';
import { idx, inBounds } from './map';
import type { Sim } from './sim';
import {
    KINGDOM,
    WILD,
    type AgendaId,
    type Building,
    type BuildingKind,
    type MessengerOrder,
    type NeedId,
    type ResourceType,
    type Stance,
    type Stock,
    type TechId,
    type Unit,
    type UnitKind,
    type Village
} from './types';
import { placeFoundation, queueUnit, startResearch } from './buildings';
import { distToBuilding } from './combat';
import { appointLeader, joinKingdom, reactToPlayerProject, resolveProposal } from './politics';
import { receiveDiplomat, setStatus } from './diplomacy';
import { canTrade } from './trade';
import { setIdle } from './units';
import { MERCHANT_DEALS } from './world';

export const isCommandable = (sim: Sim, u: Unit): boolean => {
    if (u.faction !== KINGDOM) return false;
    if (u.kind === 'explorer') return true;
    const e = sim.explorer();
    return !!e && Math.hypot(e.x - u.x, e.y - u.y) <= COMMAND_RADIUS;
};

export const isBuildingCommandable = (sim: Sim, b: Building): boolean => {
    if (b.faction !== KINGDOM) return false;
    const e = sim.explorer();
    return !!e && distToBuilding(e.x, e.y, b) <= COMMAND_RADIUS;
};

/** The kingdom village the explorer is standing in, if any. */
export const currentVillage = (sim: Sim): Village | undefined =>
    sim.state.villages.find((v) => v.faction === KINGDOM && v.stage === 'village' && v.playerPresent);

export const nearestKingdomVillageTo = (sim: Sim, x: number, y: number, maxDist = Infinity): Village | undefined => {
    let best: Village | undefined;
    let bestD = maxDist;
    for (const v of sim.state.villages) {
        if (v.faction !== KINGDOM || v.stage !== 'village') continue;
        const d = Math.hypot(v.cx - x, v.cy - y);
        if (d < bestD) {
            bestD = d;
            best = v;
        }
    }
    return best;
};

const formation = (i: number, n: number): { dx: number; dy: number } => {
    if (n === 1) return { dx: 0, dy: 0 };
    const cols = Math.ceil(Math.sqrt(n));
    const row = Math.floor(i / cols);
    const col = i % cols;
    return { dx: (col - (cols - 1) / 2) * 1.05, dy: (row - (Math.ceil(n / cols) - 1) / 2) * 1.05 };
};

export const issueMove = (sim: Sim, units: Unit[], x: number, y: number, attackMove = false) => {
    units.forEach((u, i) => {
        const f = formation(i, units.length);
        let tx = x + f.dx;
        let ty = y + f.dy;
        if (sim.isSolidAt(Math.floor(tx), Math.floor(ty))) {
            tx = x;
            ty = y;
        }
        u.order = { type: 'move', x: tx, y: ty, attackMove };
        u.engageId = null;
        u.path = [];
        u.pathTarget = '';
    });
    sim.emit({ type: 'sound', id: 'command' });
};

export const unitAt = (sim: Sim, x: number, y: number, radius = 0.6): Unit | undefined => {
    let best: Unit | undefined;
    let bestD = radius;
    for (const u of sim.spatial.query(x, y - 0.3, radius + 0.5)) {
        const d = Math.hypot(u.x - x, u.y - 0.3 - y);
        if (d < bestD) {
            bestD = d;
            best = u;
        }
    }
    return best;
};

export const buildingAt = (sim: Sim, x: number, y: number): Building | undefined => {
    const { map } = sim.state;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!inBounds(map, tx, ty)) return undefined;
    const direct = sim.buildingById.get(map.block[idx(map, tx, ty)]);
    if (direct) return direct;
    // Tall buildings: clicking their roof (above the footprint) should still select them.
    for (let dy = 1; dy <= 2; dy++) {
        if (!inBounds(map, tx, ty + dy)) continue;
        const b = sim.buildingById.get(map.block[idx(map, tx, ty + dy)]);
        if (b && BUILDINGS[b.kind].blocksMovement && b.y === ty + dy) return b;
    }
    return undefined;
};

/** Context-sensitive right click, like Age of Empires. */
export const issueSmartCommand = (sim: Sim, units: Unit[], x: number, y: number): string | null => {
    if (!units.length) return null;
    const target = unitAt(sim, x, y);
    const building = target ? undefined : buildingAt(sim, x, y);
    const { map } = sim.state;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const resource = inBounds(map, tx, ty)
        ? sim.resourceById.get(map.block[idx(map, tx, ty)]) ?? sim.state.resources.find((r) => r.kind === 'carcass' && r.x === tx && r.y === ty)
        : undefined;

    const explorer = units.find((u) => u.kind === 'explorer');
    const talkVillage = (() => {
        const vid = target?.villageId ?? building?.villageId;
        const v = sim.village(vid);
        if (!v || v.faction === KINGDOM || sim.hostileFactions(KINGDOM, v.faction)) return undefined;
        return v;
    })();
    if (explorer && talkVillage) {
        explorer.order = { type: 'talk', villageId: talkVillage.id };
        explorer.engageId = null;
        const rest = units.filter((u) => u !== explorer);
        if (rest.length) issueMove(sim, rest, x, y + 1.5);
        sim.emit({ type: 'sound', id: 'command' });
        return null;
    }

    const leftovers: Unit[] = [];
    for (const u of units) {
        u.engageId = null;
        u.path = [];
        u.pathTarget = '';
        if (target && target.id !== u.id) {
            const hostile = sim.hostileFactions(u.faction, target.faction) || target.kind === 'sheep';
            if (u.kind === 'monk') {
                if (sim.friendlyFactions(u.faction, target.faction)) u.order = { type: 'heal', targetId: target.id };
                else if (target.faction !== WILD) u.order = { type: 'convert', targetId: target.id, progress: 0 };
                else leftovers.push(u);
                continue;
            }
            if (hostile && UNITS[u.kind].damage > 0) {
                u.order = { type: 'attack', targetId: target.id, targetIsBuilding: false };
                continue;
            }
            if (!hostile && target.faction === KINGDOM) {
                u.order = { type: 'follow', targetId: target.id };
                continue;
            }
        }
        if (building) {
            if (u.kind === 'pawn' && building.faction === KINGDOM) {
                if (building.kind === 'farm' && building.built) u.order = { type: 'farm', buildingId: building.id };
                else if (!building.built || building.hp < sim.buildingMaxHp(building)) u.order = { type: 'build', buildingId: building.id };
                else if (u.carry) u.order = { type: 'returnCargo', thenResourceId: null, thenFarmId: null };
                else leftovers.push(u);
                continue;
            }
            if (sim.hostileFactions(u.faction, building.faction) && UNITS[u.kind].damage > 0 && u.kind !== 'monk') {
                u.order = { type: 'attack', targetId: building.id, targetIsBuilding: true };
                continue;
            }
        }
        if (resource && u.kind === 'pawn') {
            u.order = { type: 'gather', resourceId: resource.id };
            continue;
        }
        leftovers.push(u);
    }
    if (leftovers.length) issueMove(sim, leftovers, x, y);
    else sim.emit({ type: 'sound', id: 'command' });
    return null;
};

export const setStance = (units: Unit[], stance: Stance) => {
    for (const u of units) {
        u.stance = stance;
        if (stance === 'passive') u.engageId = null;
    }
};

export const stopUnits = (sim: Sim, units: Unit[]) => {
    for (const u of units) {
        setIdle(sim, u);
        u.engageId = null;
    }
};

export const assignBuilders = (sim: Sim, units: Unit[], b: Building) => {
    for (const u of units) if (u.kind === 'pawn' && isCommandable(sim, u)) u.order = { type: 'build', buildingId: b.id };
};

/** The player places a building. It belongs to the nearest kingdom village. */
export const playerPlaceBuilding = (sim: Sim, kind: BuildingKind, x: number, y: number, builders: Unit[]): Building | string => {
    const explorer = sim.explorer();
    if (!explorer) return 'Your explorer must be nearby to give orders.';
    const def = BUILDINGS[kind];
    const cx = x + def.w / 2;
    const cy = y + def.h / 2;
    if (Math.hypot(explorer.x - cx, explorer.y - cy) > COMMAND_RADIUS) return 'Too far from your explorer.';
    const { map } = sim.state;
    if (!inBounds(map, x, y) || !sim.state.explored[idx(map, x, y)]) return 'You cannot build in unexplored land.';
    const v = nearestKingdomVillageTo(sim, cx, cy, 22);
    if (!v) return 'Buildings must be near one of your villages.';
    const result = placeFoundation(sim, v, kind, x, y, KINGDOM, true);
    if (typeof result === 'string') return result;
    if (def.grand) reactToPlayerProject(sim, v, kind);
    assignBuilders(sim, builders, result);
    sim.emit({ type: 'sound', id: 'build' });
    return result;
};

export const playerTrain = (sim: Sim, b: Building, unit: UnitKind): string | null => {
    if (!isBuildingCommandable(sim, b)) return 'Your explorer must be nearby. Send a messenger instead.';
    const err = queueUnit(sim, b, unit);
    if (!err) sim.emit({ type: 'sound', id: 'click' });
    return err;
};

export const playerResearch = (sim: Sim, b: Building, tech: TechId): string | null => {
    if (!isBuildingCommandable(sim, b)) return 'Your explorer must be nearby.';
    return startResearch(sim, b, tech);
};

export const demolish = (sim: Sim, b: Building) => {
    if (!isBuildingCommandable(sim, b) || b.kind === 'townCenter') return;
    const v = sim.village(b.villageId);
    if (v) sim.refund(v.stock, BUILDINGS[b.kind].cost, b.built ? 0.25 : 0.75);
    sim.removeBuilding(b);
};

/** Sends a messenger from the explorer to a village. Gifts are paid by the village you are in (or nearest). */
export const sendMessenger = (sim: Sim, villageId: number, msg: MessengerOrder): string | null => {
    const explorer = sim.explorer();
    const target = sim.village(villageId);
    if (!explorer || !target) return 'No explorer to send from.';
    if (msg.type === 'gift') {
        const payer = currentVillage(sim) ?? nearestKingdomVillageTo(sim, explorer.x, explorer.y);
        if (!payer || payer.stock[msg.resource] < msg.amount) return `Not enough ${msg.resource} to send.`;
        payer.stock[msg.resource] -= msg.amount;
    }
    const m = sim.spawnUnit('messenger', KINGDOM, null, explorer.x + 0.5, explorer.y + 0.5);
    m.order = { type: 'deliver', villageId, message: msg, from: KINGDOM };
    sim.log(`A messenger sets off for ${target.name}.`, 'info', m);
    sim.emit({ type: 'sound', id: 'command' });
    return null;
};

/** Talking in person with a camp or independent village. */
export const talkAction = (sim: Sim, villageId: number, action: MessengerOrder | { type: 'join'; promise: NeedId | null }): string | null => {
    const v = sim.village(villageId);
    const explorer = sim.explorer();
    if (!v || !explorer) return 'Nobody to talk to.';
    if (Math.hypot(explorer.x - v.cx, explorer.y - v.cy) > 8) return 'You must be in the village to talk.';
    if (action.type === 'join') {
        if (v.stage !== 'camp') return null;
        if (v.loyalty + (action.promise ? 12 : 0) < 45) {
            sim.log(`${v.name} is not convinced yet. Bring a gift or make them a promise.`, 'politics', { x: v.cx, y: v.cy });
            return 'They are not convinced.';
        }
        joinKingdom(sim, v, action.promise);
        return null;
    }
    if (action.type === 'gift') {
        const payer = currentVillage(sim) ?? nearestKingdomVillageTo(sim, explorer.x, explorer.y);
        if (!payer || payer.stock[action.resource] < action.amount) {
            if (v.stage === 'camp' && action.resource === 'food' && !payer) {
                v.loyalty = Math.min(100, v.loyalty + 12);
                sim.log(`You share your travel rations with ${v.name}. They warm to you.`, 'good', { x: v.cx, y: v.cy });
                return null;
            }
            return `Not enough ${action.resource}.`;
        }
        payer.stock[action.resource] -= action.amount;
        if (v.stage === 'camp') {
            v.stock[action.resource] += action.amount;
            v.loyalty = Math.min(100, v.loyalty + 15);
            sim.log(`${v.name} gratefully accepts your gift.`, 'good', { x: v.cx, y: v.cy });
            return null;
        }
    }
    receiveDiplomat(sim, v, action, KINGDOM);
    return null;
};

export const declareWar = (sim: Sim, villageId: number) => {
    const v = sim.village(villageId);
    if (!v || v.faction === KINGDOM) return;
    setStatus(sim, KINGDOM, v.faction, 'war', -60);
    for (const o of sim.state.villages) {
        if (o.faction !== KINGDOM && o.faction !== v.faction && sim.friendlyFactions(o.faction, v.faction)) o.loyalty = Math.max(0, o.loyalty - 15);
    }
};

export const setAgenda = (sim: Sim, agenda: AgendaId[]) => {
    sim.state.kingdom.agenda = agenda.slice(0, MAX_AGENDA);
};

export const createTradeRoute = (sim: Sim, fromId: number, toId: number): string | null => {
    const from = sim.village(fromId);
    const to = sim.village(toId);
    if (!from || !to || !canTrade(sim, from, to)) return 'Trade needs two friendly villages.';
    if (!from.tradeRoutes.includes(to.id)) from.tradeRoutes.push(to.id);
    const tc = sim.townCenter(from);
    if (!tc || !tc.built) return `${from.name} needs a finished Town Center.`;
    const err = queueUnit(sim, tc, 'caravan');
    if (err) return err;
    sim.log(`${from.name} is preparing a caravan for ${to.name}.`, 'info');
    return null;
};

export const playerAppoint = (sim: Sim, villageId: number, unitId: number) => {
    const v = sim.village(villageId);
    if (v) appointLeader(sim, v, unitId);
};

export const playerVote = (sim: Sim, villageId: number, approve: boolean) => {
    const v = sim.village(villageId);
    if (v?.proposal) resolveProposal(sim, v, approve, 'player');
};

export const merchantDeal = (sim: Sim, villageId: number, index: number): string | null => {
    const v = sim.village(villageId);
    const deal = MERCHANT_DEALS[index];
    if (!v || !deal) return 'No deal.';
    if (!sim.canAfford(v.stock, deal.give as Partial<Stock>)) return 'Not enough resources.';
    sim.pay(v.stock, deal.give as Partial<Stock>);
    sim.refund(v.stock, deal.get as Partial<Stock>);
    sim.emit({ type: 'sound', id: 'coin' });
    return null;
};

export const setFocus = (v: Village, resource: ResourceType | null) => {
    v.focus = resource;
};
