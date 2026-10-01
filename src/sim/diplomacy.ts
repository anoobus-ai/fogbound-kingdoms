import { DAY_SECONDS } from '../data/balance';
import { TRAITS, TRAIT_CONFLICTS } from '../data/traits';
import { UNITS } from '../data/units';
import type { Sim } from './sim';
import { pairKey } from './state';
import { KINGDOM, type DiplomacyStatus, type FactionId, type MessengerOrder, type Stance, type TraitId, type UnitKind, type Village } from './types';
import { factionName, joinKingdom } from './politics';

const lastTick = new WeakMap<Sim, number>();

export const setStatus = (sim: Sim, a: FactionId, b: FactionId, status: DiplomacyStatus, relation?: number) => {
    if (a === b) return;
    const key = pairKey(a, b);
    const before = sim.state.diplomacy.status[key] ?? 'neutral';
    sim.state.diplomacy.status[key] = status;
    if (relation !== undefined) {
        sim.state.diplomacy.relations[key] = relation;
        if (a === KINGDOM || b === KINGDOM) {
            const other = a === KINGDOM ? b : a;
            for (const v of sim.state.villages) if (v.faction === other) v.loyalty = Math.max(0, Math.min(100, 50 + relation / 2));
        }
    }
    if (before !== status && (a === KINGDOM || b === KINGDOM)) {
        const other = a === KINGDOM ? b : a;
        const name = factionName(sim, other);
        switch (status) {
            case 'war':
                sim.log(`War! ${name} and your kingdom are now at war.`, 'bad');
                sim.emit({ type: 'sound', id: 'horn' });
                armKingdomForWar(sim);
                break;
            case 'allied':
                sim.log(`${name} is now your ally.`, 'good');
                break;
            case 'neutral':
            case 'rival':
                break;
            default: {
                const never: never = status;
                throw new Error(`Unknown status ${String(never)}`);
            }
        }
    }
};

const answersToWar = (kind: UnitKind): boolean => {
    const cls = UNITS[kind].unitClass;
    return cls === 'soldier' || cls === 'hero';
};

/** True while your kingdom is at war with anyone on the map. */
export const kingdomAtWar = (sim: Sim): boolean =>
    Object.entries(sim.state.diplomacy.status).some(([key, status]) => status === 'war' && key.split('|').includes(KINGDOM));

/** Soldiers and the hero attack on sight during a war. Everyone else still only fights back. */
export const initialStance = (sim: Sim, faction: FactionId, kind: UnitKind): Stance => {
    if (UNITS[kind].unitClass === 'bandit' || kind === 'wolf') return 'aggressive';
    if (faction === KINGDOM && kingdomAtWar(sim) && answersToWar(kind)) return 'aggressive';
    return 'passive';
};

/** Passive soldiers and the hero switch to attack-on-sight when a war begins. Hold and a chosen passive stay put until the next war. */
export const armKingdomForWar = (sim: Sim) => {
    for (const u of sim.state.units) {
        if (u.faction === KINGDOM && u.stance === 'passive' && answersToWar(u.kind)) u.stance = 'aggressive';
    }
};

/** Independent factions currently on the map (village factions that aren't the kingdom). */
export const independentFactions = (sim: Sim): FactionId[] => [
    ...new Set(sim.state.villages.filter((v) => v.faction !== KINGDOM).map((v) => v.faction))
];

const cultureOf = (sim: Sim, f: FactionId): TraitId[] => sim.state.villages.filter((v) => v.faction === f).flatMap((v) => v.culture);

const compatibility = (a: TraitId[], b: TraitId[]): number => {
    let score = 0;
    for (const x of a) {
        for (const y of b) {
            if (x === y) score += 12;
            if (TRAIT_CONFLICTS.some(([p, q]) => (p === x && q === y) || (p === y && q === x))) score -= 18;
            score += (TRAITS[x].warlike + TRAITS[y].warlike) * -2;
        }
    }
    return score / Math.max(1, Math.sqrt(a.length * b.length));
};

const closestDistance = (sim: Sim, a: FactionId, b: FactionId): number => {
    let best = Infinity;
    for (const va of sim.state.villages) {
        if (va.faction !== a) continue;
        for (const vb of sim.state.villages) {
            if (vb.faction === b) best = Math.min(best, Math.hypot(va.cx - vb.cx, va.cy - vb.cy));
        }
    }
    return best;
};

/** How well the kingdom's agenda fits this village's culture, -1..1. */
export const cultureAgendaFit = (sim: Sim, v: Village): number => {
    const agenda = sim.state.kingdom.agenda;
    if (!agenda.length) return 0;
    let s = 0;
    for (const a of agenda) for (const t of v.culture) s += TRAITS[t].agenda[a] ?? 0;
    return Math.max(-1, Math.min(1, s / (agenda.length * v.culture.length) / 0.6));
};

export const updateDiplomacy = (sim: Sim) => {
    const now = sim.state.time;
    if (now - (lastTick.get(sim) ?? -10) < 5) return;
    lastTick.set(sim, now);
    const d = sim.state.diplomacy;
    const factions = independentFactions(sim).filter((f) => sim.state.villages.some((v) => v.faction === f && v.stage === 'village'));

    // Independent villages among themselves.
    for (let i = 0; i < factions.length; i++) {
        for (let j = i + 1; j < factions.length; j++) {
            const a = factions[i];
            const b = factions[j];
            const key = pairKey(a, b);
            const status = d.status[key] ?? 'neutral';
            const dist = closestDistance(sim, a, b);
            let target = compatibility(cultureOf(sim, a), cultureOf(sim, b)) * 4.5 - (dist < 40 ? 22 : 0);
            if (status === 'war') target += 30;
            const rel = d.relations[key] ?? 0;
            d.relations[key] = Math.max(-100, Math.min(100, rel + (target - rel) * 0.05 + sim.rng.range(-2, 2)));
            const r = d.relations[key];
            let next: DiplomacyStatus = status;
            if (status === 'war') {
                if (r > -20) next = 'neutral';
            } else if (r < -50) next = 'war';
            else if (r < -30) next = 'rival';
            else if (r > 40) next = 'allied';
            else if (status !== 'allied' || r < 30) next = 'neutral';
            if (next !== status) {
                d.status[key] = next;
                const na = factionName(sim, a);
                const nb = factionName(sim, b);
                if (next === 'war') sim.log(`${na} and ${nb} have gone to war with each other!`, 'politics');
                else if (next === 'allied') sim.log(`${na} and ${nb} formed an alliance. They share common interests.`, 'politics');
                else if (status === 'war') sim.log(`${na} and ${nb} made peace.`, 'politics');
                else if (next === 'rival') sim.log(`${na} and ${nb} are becoming rivals.`, 'politics');
            }
        }
    }

    // Each independent village's opinion of your kingdom.
    for (const v of sim.state.villages) {
        if (v.faction === KINGDOM || v.stage !== 'village') continue;
        const status = sim.status(KINGDOM, v.faction);
        const target = 42 + cultureAgendaFit(sim, v) * 25 + (status === 'allied' ? 15 : 0) - (status === 'war' ? 30 : 0) - (v.exiledPlayerAt !== null ? 15 : 0);
        v.loyalty += (target - v.loyalty) * 0.01;
        const warlike = v.culture.reduce((s, t) => s + TRAITS[t].warlike, 0);
        if (status !== 'war' && v.loyalty < 12 && warlike > 0.3) {
            setStatus(sim, KINGDOM, v.faction, 'war', -60);
        } else if (status === 'war' && v.loyalty > 40 && warlike < 0 && sim.rng.chance(0.1)) {
            setStatus(sim, KINGDOM, v.faction, 'neutral', -10);
            sim.log(`${v.name} is tired of fighting and offers peace.`, 'good', { x: v.cx, y: v.cy });
        }
    }
};

/** An offer delivered to an independent village, by messenger or by the explorer in person. */
export const receiveDiplomat = (sim: Sim, v: Village, msg: MessengerOrder, from: FactionId) => {
    if (from !== KINGDOM) return;
    const at = { x: v.cx, y: v.cy };
    const status = sim.status(KINGDOM, v.faction);
    switch (msg.type) {
        case 'gift': {
            v.stock[msg.resource] += msg.amount;
            const boost = Math.min(25, msg.amount / (msg.resource === 'gold' ? 5 : 10));
            v.loyalty = Math.min(100, v.loyalty + boost);
            sim.log(`${v.name} gratefully accepts your gift of ${msg.amount} ${msg.resource}. (Opinion ${Math.round(v.loyalty)})`, 'good', at);
            return;
        }
        case 'alliance':
            if (status === 'war') sim.log(`${v.name}: "An alliance? We are at war!"`, 'bad', at);
            else if (v.loyalty >= 55) setStatus(sim, KINGDOM, v.faction, 'allied');
            else sim.log(`${v.name} declines an alliance. (Opinion ${Math.round(v.loyalty)}, needs 55)`, 'politics', at);
            return;
        case 'peace':
            if (status !== 'war') return;
            if (v.loyalty >= 25 || sim.rng.chance(0.25)) {
                setStatus(sim, KINGDOM, v.faction, 'neutral', -10);
                sim.log(`${v.name} accepts peace.`, 'good', at);
            } else sim.log(`${v.name} refuses peace. (Opinion ${Math.round(v.loyalty)}, needs 25)`, 'bad', at);
            return;
        case 'invite':
            if (status === 'war') {
                sim.log(`${v.name} laughs at your invitation.`, 'bad', at);
            } else if (v.loyalty >= 70 || (status === 'allied' && v.loyalty >= 60)) {
                joinKingdom(sim, v, null);
            } else {
                sim.log(`${v.name} is not ready to join your kingdom. (Opinion ${Math.round(v.loyalty)}, needs 70)`, 'politics', at);
            }
            return;
        case 'sendTroops': {
            const explorer = sim.explorer();
            if (status !== 'allied') {
                sim.log(`${v.name} only sends soldiers to allies.`, 'politics', at);
                return;
            }
            if (sim.state.time - v.aidSentAt < DAY_SECONDS * 2) {
                sim.log(`${v.name} already sent help recently.`, 'politics', at);
                return;
            }
            const troops = sim.citizens(v.id).filter((u) => UNITS[u.kind].unitClass === 'soldier').slice(0, 5);
            if (!troops.length || !explorer) {
                sim.log(`${v.name} has no soldiers to spare.`, 'politics', at);
                return;
            }
            v.aidSentAt = sim.state.time;
            for (const t of troops) {
                t.faction = KINGDOM;
                t.villageId = null;
                t.stance = 'aggressive';
                t.order = { type: 'follow', targetId: explorer.id };
            }
            sim.log(`${v.name} sends ${troops.length} soldiers to fight at your side! They are yours to command.`, 'good', at);
            return;
        }
        case 'build':
        case 'train':
        case 'focus':
            sim.log(`${v.name} does not take orders from you.`, 'politics', at);
            return;
        default: {
            const never: never = msg;
            throw new Error(`Unknown message ${JSON.stringify(never)}`);
        }
    }
};
