import { NEED_LABELS } from '../data/biomes';
import { BUILDINGS } from '../data/buildings';
import {
    DAY_SECONDS,
    JUDGEMENT_AFTER_AWAY,
    LEADER_DECISION_DELAY,
    PRESENCE_RADIUS,
    PROPOSAL_INTERVAL,
    REBELLION_AFTER,
    STARTING_STOCK,
    UNREST_HIGH,
    VOTE_THRESHOLD
} from '../data/balance';
import { AGENDAS } from '../data/techs';
import { TRAITS } from '../data/traits';
import { UNITS } from '../data/units';
import { popularity } from './people';
import type { Sim } from './sim';
import { pairKey } from './state';
import {
    KINGDOM,
    type BuildingKind,
    type FactionId,
    type MessengerOrder,
    type NeedId,
    type Proposal,
    type ProposalKind,
    type Unit,
    type Village
} from './types';
import { findBuildSpot, placeFoundation, population, queueUnit } from './buildings';
import { NEED_IDS, needWeights, personLikes, scoreBuilding } from './villages';
import { receiveDiplomat, setStatus } from './diplomacy';

const PEOPLE_CHOICES: BuildingKind[] = [
    'house', 'farm', 'granary', 'well', 'market', 'barracks', 'monastery', 'tower', 'wall', 'garden', 'oasis', 'palace'
];

/** Unrest drifts toward a target built from these parts. The village panel shows the same numbers. */
export const UNREST_HAPPINESS_LINE = 55;
export const UNREST_PER_HAPPINESS_SHORT = 1.1;
export const UNREST_PER_GRIEVANCE = 6;
export const UNREST_GRIEVANCE_CAP = 30;
/** Fraction of the gap between current unrest and its target closed each second. */
export const UNREST_DRIFT = 0.01;

/** Unrest within this many points of the rebellion line counts as close. */
export const REBELLION_CLOSE = 15;

export const VOTE_AGREE_UNREST = 6;
export const VOTE_AGREE_MARGIN = 10;
export const VOTE_DISAGREE_UNREST = 8;
export const VOTE_DISAGREE_MARGIN = 20;
export const VOTE_PLAYER_LOYALTY_AGREE = 3;
export const VOTE_LEADER_LOYALTY_AGREE = 1;
export const VOTE_PLAYER_LOYALTY_DISAGREE = 6;

const lastTick = new WeakMap<Sim, number>();

export const updatePolitics = (sim: Sim) => {
    const now = sim.state.time;
    const explorer = sim.explorer();
    for (const v of sim.state.villages) {
        const radius = v.playerPresent ? PRESENCE_RADIUS + 2 : PRESENCE_RADIUS;
        const present = !!explorer && Math.hypot(explorer.x - v.cx, explorer.y - v.cy) < radius;
        if (present !== v.playerPresent) {
            v.playerPresent = present;
            if (v.faction === KINGDOM && v.stage === 'village') {
                if (present) onReturn(sim, v);
                else onLeave(sim, v);
            }
        }
        if (present && v.faction === KINGDOM) {
            const tc = sim.townCenter(v);
            if (tc) {
                sim.state.kingdom.respawn = { x: tc.x + tc.w / 2, y: tc.y + tc.h + 1 };
                sim.state.kingdom.respawnVillageId = v.id;
            }
        }
    }
    // The rest only needs to run about once a second.
    if (now - (lastTick.get(sim) ?? -1) < 1) return;
    lastTick.set(sim, now);
    for (const v of sim.state.villages) {
        if (v.faction !== KINGDOM || v.stage !== 'village') continue;
        tickVillagePolitics(sim, v);
    }
};

const tickVillagePolitics = (sim: Sim, v: Village) => {
    const now = sim.state.time;
    const pop = population(sim, v);

    if (!v.proposal && pop >= VOTE_THRESHOLD && now >= v.nextProposalAt) {
        const kind = choosePeoplesWish(sim, v, pop);
        if (kind) startProposal(sim, v, kind);
        else v.nextProposalAt = now + PROPOSAL_INTERVAL / 2;
    }
    const p = v.proposal;
    if (p && !p.resolved) {
        if (p.decider === 'player' && !v.playerPresent) p.decider = 'leader';
        if (p.decider === 'leader' && now - p.createdAt > LEADER_DECISION_DELAY) leaderDecides(sim, v, p);
    }

    const pressure = unrestPressure(v);
    v.unrest = clampMeter(v.unrest + (pressure.target - v.unrest) * UNREST_DRIFT);
    if (v.unrest >= UNREST_HIGH) {
        v.unrestHighSince ??= now;
        if (now - v.unrestHighSince > REBELLION_AFTER) rebellion(sim, v);
    } else v.unrestHighSince = null;

    const loyaltyTarget = Math.max(0, Math.min(100, v.happiness * 0.7 + agendaAlignment(sim, v) * 25 + 20 - v.grievances.length * 6));
    v.loyalty += (loyaltyTarget - v.loyalty) * 0.004;

    for (const promise of v.promises) {
        if (promise.kept !== null || now < promise.dueAt) continue;
        promise.kept = v.needs[promise.need] >= 60;
        if (promise.kept) {
            v.loyalty = Math.min(100, v.loyalty + 15);
            sim.log(`${v.name}: "You kept your promise — ${promise.text}". Loyalty rises.`, 'good', { x: v.cx, y: v.cy });
        } else {
            v.loyalty = Math.max(0, v.loyalty - 15);
            v.grievances.push(`You broke your promise: ${promise.text}`);
            sim.log(`${v.name}: "You promised — ${promise.text}. You lied to us."`, 'bad', { x: v.cx, y: v.cy });
        }
    }
};

const clampMeter = (n: number) => Math.max(0, Math.min(100, n));

export interface UnrestPart {
    label: string;
    /** Points this part adds to the unrest target. */
    points: number;
    detail: string;
}

export interface UnrestReadout {
    current: number;
    target: number;
    /** Points of unrest added per second. Negative means it is falling. */
    drift: number;
    parts: UnrestPart[];
    /** Seconds left before rebellion, or null when unrest is under the line. */
    rebellionIn: number | null;
    /** True when unrest is near the line or the clock is already running. */
    rebellionClose: boolean;
    line: number;
    /** How long unrest must stay at the line before the village rebels. */
    hold: number;
}

export const unrestPressure = (v: Village): { happiness: number; grievances: number; target: number } => {
    const happiness = Math.max(0, UNREST_HAPPINESS_LINE - v.happiness) * UNREST_PER_HAPPINESS_SHORT;
    const grievances = Math.min(UNREST_GRIEVANCE_CAP, v.grievances.length * UNREST_PER_GRIEVANCE);
    return { happiness, grievances, target: happiness + grievances };
};

/** The numbers behind a village's unrest, using the same formula as the simulation. */
export const unrestReadout = (v: Village, now: number): UnrestReadout => {
    const pressure = unrestPressure(v);
    const parts: UnrestPart[] = [];
    if (pressure.happiness > 0.05) {
        parts.push({
            label: 'Low happiness',
            points: pressure.happiness,
            detail: `Happiness is ${Math.round(v.happiness)}%. Each point under ${UNREST_HAPPINESS_LINE} adds ${UNREST_PER_HAPPINESS_SHORT} to the unrest target.`
        });
    }
    if (v.grievances.length) {
        const counted = Math.min(v.grievances.length, UNREST_GRIEVANCE_CAP / UNREST_PER_GRIEVANCE);
        const extra = v.grievances.length - counted;
        parts.push({
            label: 'Grievances',
            points: pressure.grievances,
            detail:
                `${v.grievances.length} grievance${v.grievances.length === 1 ? '' : 's'} × ${UNREST_PER_GRIEVANCE}` +
                (extra > 0 ? `, capped at ${UNREST_GRIEVANCE_CAP}` : '') +
                '.'
        });
    }
    const rebellionIn =
        v.unrest >= UNREST_HIGH && v.unrestHighSince != null ? Math.max(0, REBELLION_AFTER - (now - v.unrestHighSince)) : null;
    const rebellionClose = rebellionIn != null || v.unrest >= UNREST_HIGH - REBELLION_CLOSE;
    return {
        current: v.unrest,
        target: pressure.target,
        drift: (pressure.target - v.unrest) * UNREST_DRIFT,
        parts,
        rebellionIn,
        rebellionClose,
        line: UNREST_HIGH,
        hold: REBELLION_AFTER
    };
};

export const peopleWantApproval = (p: Proposal): boolean => p.yes > p.no;

export const proposalMargin = (p: Proposal): number => Math.abs(p.yes - p.no) / Math.max(1, p.yes + p.no);

export interface VoteChoicePreview {
    approve: boolean;
    agreesWithPeople: boolean;
    unrestDelta: number;
    unrestAfter: number;
    loyaltyDelta: number;
    loyaltyAfter: number;
    /** Set when this choice writes a grievance the village will remember. */
    grievance: string | null;
    /** What this choice does in the world, besides the meters. */
    consequence: string;
    /** Unrest crosses or leaves the rebellion line. */
    crossesLine: 'starts' | 'stops' | null;
}

const approveConsequence = (sim: Sim, v: Village, kind: ProposalKind): string => {
    switch (kind.type) {
        case 'build':
            return `Places a ${BUILDINGS[kind.building].name} if there is room and ${v.name} can pay. Otherwise they queue it until they can afford it.`;
        case 'army':
            return sim.state.buildings.some((b) => b.villageId === v.id && b.built && b.kind === 'barracks')
                ? 'Trains 3 militia at the barracks.'
                : 'Queues a barracks, since this village has none yet.';
        case 'peace':
            return `Makes peace with ${factionName(sim, kind.withFaction)}. Your relation becomes neutral.`;
        case 'war':
            return `Declares war on ${factionName(sim, kind.withFaction)}.`;
        case 'cancelProject':
            return `Abandons the ${BUILDINGS[kind.building].name} and returns half its cost to the stores.`;
        default: {
            const never: never = kind;
            throw new Error(`Unknown proposal ${JSON.stringify(never)}`);
        }
    }
};

/** What approve or reject will change, before the choice is made. */
export const previewVote = (sim: Sim, v: Village, p: Proposal, approve: boolean, by: 'player' | 'leader'): VoteChoicePreview => {
    const agrees = approve === peopleWantApproval(p);
    const margin = proposalMargin(p);
    const unrestDelta = agrees ? -(VOTE_AGREE_UNREST + VOTE_AGREE_MARGIN * margin) : VOTE_DISAGREE_UNREST + VOTE_DISAGREE_MARGIN * margin;
    const loyaltyDelta = agrees
        ? by === 'player'
            ? VOTE_PLAYER_LOYALTY_AGREE
            : VOTE_LEADER_LOYALTY_AGREE
        : by === 'player'
          ? -VOTE_PLAYER_LOYALTY_DISAGREE
          : 0;
    const grievance = !agrees && by === 'player' ? `You ignored our vote to ${p.title.toLowerCase()}.` : null;
    const unrestAfter = clampMeter(v.unrest + unrestDelta);
    const wasHigh = v.unrest >= UNREST_HIGH;
    const willBeHigh = unrestAfter >= UNREST_HIGH;
    return {
        approve,
        agreesWithPeople: agrees,
        unrestDelta,
        unrestAfter,
        loyaltyDelta,
        loyaltyAfter: clampMeter(v.loyalty + loyaltyDelta),
        grievance,
        consequence: approve ? approveConsequence(sim, v, p.kind) : 'Drops the proposal. Nothing is built, trained, or changed.',
        crossesLine: !wasHigh && willBeHigh ? 'starts' : wasHigh && !willBeHigh ? 'stops' : null
    };
};

// ---------- leaving & returning ----------

const onLeave = (sim: Sim, v: Village) => {
    v.lastVisitAt = sim.state.time;
    v.awayReport = [];
    const leader = sim.unitById.get(v.leaderId ?? -1);
    if (!leader) {
        const best = bestCandidate(sim, v);
        if (best) {
            v.leaderId = best.id;
            sim.log(`${best.person!.name} will lead ${v.name} while you are away.`, 'politics', best);
        }
    }
    if (sim.citizens(v.id).length >= 2) sim.request({ type: 'appointLeader', villageId: v.id });
};

const onReturn = (sim: Sim, v: Village) => {
    const away = sim.state.time - v.lastVisitAt;
    if (away < JUDGEMENT_AFTER_AWAY) return;
    if (judge(sim, v)) return;
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const lines = [...v.awayReport];
    if (!lines.length) lines.push('Nothing much changed while you were away.');
    lines.unshift(
        `${leader?.person?.name ?? 'The people'} ran ${v.name} for ${Math.round(away / DAY_SECONDS * 10) / 10} days.`,
        `Mood ${Math.round(v.happiness)}%, unrest ${Math.round(v.unrest)}%, loyalty ${Math.round(v.loyalty)}%.`
    );
    sim.request({ type: 'returnReport', villageId: v.id, lines });
    sim.emit({ type: 'sound', id: 'bell' });
};

export const bestCandidate = (sim: Sim, v: Village): Unit | undefined =>
    sim.citizens(v.id).sort((a, b) => popularity(b) - popularity(a))[0];

export const appointLeader = (sim: Sim, v: Village, unitId: number) => {
    const u = sim.unitById.get(unitId);
    if (!u || u.villageId !== v.id || !u.person) return;
    const favourite = bestCandidate(sim, v);
    v.leaderId = u.id;
    if (favourite && favourite.id !== u.id && popularity(favourite) - popularity(u) > 15) {
        v.unrest = Math.min(100, v.unrest + 6);
        sim.log(`The people of ${v.name} grumble: they wanted ${favourite.person!.name}, not ${u.person.name}.`, 'politics', u);
    } else {
        sim.log(`${u.person.name} is now the leader of ${v.name}.`, 'politics', u);
    }
};

// ---------- agenda & judgement ----------

/** -1 = the people hate your agenda, 1 = they love it. */
export const agendaAlignment = (sim: Sim, v: Village): number => {
    const agenda = sim.state.kingdom.agenda;
    if (!agenda.length) return 0;
    const people = sim.citizens(v.id);
    if (!people.length) return 0;
    let total = 0;
    for (const u of people) {
        for (const a of agenda) for (const t of u.person!.traits) total += TRAITS[t].agenda[a] ?? 0;
    }
    return Math.max(-1, Math.min(1, total / (people.length * agenda.length) / 0.8));
};

const disagreements = (sim: Sim, v: Village): string[] => {
    const reasons: string[] = [];
    const grand = sim.state.buildings.filter((b) => b.villageId === v.id && b.orderedByPlayer && BUILDINGS[b.kind].grand);
    const people = sim.citizens(v.id);
    for (const b of grand) {
        const dislikers = people.filter((u) => personLikes(u.person!.traits, b.kind) < 0).length;
        if (dislikers > people.length / 3) reasons.push(`Your ${BUILDINGS[b.kind].name} is far too expensive. We never wanted it.`);
    }
    reasons.push(...v.grievances.slice(-3));
    const weights = needWeights(sim, v);
    const worst = NEED_IDS.filter((n) => weights[n] > 0.6).sort((a, b) => v.needs[a] - v.needs[b])[0];
    if (worst && v.needs[worst] < 35) reasons.push(`Our need for ${NEED_LABELS[worst].toLowerCase()} was ignored (${Math.round(v.needs[worst])}%).`);
    for (const a of sim.state.kingdom.agenda) {
        let score = 0;
        for (const u of people) for (const t of u.person!.traits) score += TRAITS[t].agenda[a] ?? 0;
        if (score < -people.length * 0.3) reasons.push(`We do not share your dream of ${AGENDAS[a].name}.`);
    }
    return [...new Set(reasons)];
};

/** Decides whether the village exiles the returning explorer. Returns true if he was exiled. */
export const judge = (sim: Sim, v: Village): boolean => {
    const pop = population(sim, v);
    const broken = v.promises.filter((p) => p.kept === false).length;
    const score = (50 - v.loyalty) * 0.8 + (v.unrest - 40) * 0.5 + v.grievances.length * 10 - agendaAlignment(sim, v) * 25 + broken * 8;
    if (score <= 30) return false;
    if (pop < VOTE_THRESHOLD && v.unrest < UNREST_HIGH) return false;
    let yes = 0;
    let no = 0;
    const alignment = agendaAlignment(sim, v);
    for (const u of sim.citizens(v.id)) {
        const angry = (60 - u.person!.mood) / 60 + v.grievances.length * 0.08 - alignment * 0.3;
        const loyal = u.person!.traits.includes('loyal') ? 0.4 : 0;
        if (angry - loyal + sim.rng.range(-0.25, 0.25) > 0.15) yes++;
        else no++;
    }
    if (yes <= no) {
        sim.log(`${v.name} held a vote to exile you, but you survived it (${yes} for, ${no} against). Tread carefully.`, 'politics', { x: v.cx, y: v.cy });
        v.unrest = Math.max(0, v.unrest - 10);
        return false;
    }
    const reasons = disagreements(sim, v);
    if (!reasons.length) reasons.push('The people simply no longer trust you.');
    secede(sim, v, reasons, `${yes} voted to exile you, ${no} wanted you to stay.`);
    return true;
};

export const setVillageFaction = (sim: Sim, v: Village, faction: FactionId) => {
    v.faction = faction;
    for (const u of sim.state.units) {
        if (u.villageId === v.id) {
            u.faction = faction;
            u.engageId = null;
            if (u.order.type === 'follow') u.order = { type: 'idle' };
        }
    }
    for (const b of sim.state.buildings) if (b.villageId === v.id) b.faction = faction;
    sim.entityVersion++;
};

export const secede = (sim: Sim, v: Village, reasons: string[], voteLine: string) => {
    const rebelFaction = `v${v.id}`;
    const leader = bestCandidate(sim, v);
    setVillageFaction(sim, v, rebelFaction);
    v.leaderId = leader?.id ?? null;
    v.exiledPlayerAt = sim.state.time;
    v.loyalty = 10;
    v.unrest = 15;
    v.grievances = [];
    v.proposal = null;
    v.promises = [];
    setStatus(sim, KINGDOM, rebelFaction, 'war', -60);
    const k = sim.state.kingdom;
    if (k.respawnVillageId === v.id) {
        const other = sim.state.villages.find((o) => o.faction === KINGDOM && o.stage === 'village');
        const tc = other && sim.townCenter(other);
        k.respawn = tc ? { x: tc.x + tc.w / 2, y: tc.y + tc.h + 1 } : { x: sim.state.map.w / 2, y: sim.state.map.h / 2 };
        k.respawnVillageId = other?.id ?? null;
    }
    sim.log(`EXILED! ${v.name} has cast you out. ${voteLine}`, 'bad', { x: v.cx, y: v.cy });
    sim.request({ type: 'exiled', villageId: v.id, reasons: [voteLine, ...reasons] });
    sim.emit({ type: 'sound', id: 'horn' });
};

const rebellion = (sim: Sim, v: Village) => {
    v.unrestHighSince = null;
    const playerFault = v.grievances.length >= 2 || v.loyalty < 30;
    if (playerFault) {
        secede(sim, v, ['Unrest boiled over into open rebellion.', ...disagreements(sim, v)], 'The people rose up against your rule.');
        return;
    }
    const old = sim.unitById.get(v.leaderId ?? -1);
    const favourite = sim.citizens(v.id).filter((u) => u.id !== old?.id).sort((a, b) => popularity(b) - popularity(a))[0];
    v.leaderId = favourite?.id ?? null;
    v.unrest = 40;
    sim.log(
        `Rebellion in ${v.name}! ${old?.person?.name ?? 'The leader'} was overthrown${favourite ? ` and ${favourite.person!.name} now leads` : ''}.`,
        'bad',
        { x: v.cx, y: v.cy }
    );
    v.awayReport.push(`The people overthrew ${old?.person?.name ?? 'their leader'} in a rebellion.`);
    sim.emit({ type: 'sound', id: 'horn' });
};

// ---------- proposals & votes ----------

const choosePeoplesWish = (sim: Sim, v: Village, pop: number): ProposalKind | null => {
    const project = sim.state.buildings.find((b) => b.villageId === v.id && !b.built && b.orderedByPlayer && BUILDINGS[b.kind].grand);
    if (project) {
        const people = sim.citizens(v.id);
        const dislikers = people.filter((u) => personLikes(u.person!.traits, project.kind) < 0).length;
        if (dislikers >= people.length * 0.25) return { type: 'cancelProject', buildingId: project.id, building: project.kind };
    }
    const atWarWith = Object.entries(sim.state.diplomacy.status).find(([k, s]) => s === 'war' && k.split('|').includes(KINGDOM));
    if (atWarWith && sim.rng.chance(0.3)) {
        const other = atWarWith[0].split('|').find((f) => f !== KINGDOM)!;
        return { type: 'peace', withFaction: other };
    }
    if (v.needs.safety < 35 && sim.rng.chance(0.4)) return { type: 'army' };
    let best: BuildingKind | null = null;
    let bestScore = 0.6;
    for (const kind of PEOPLE_CHOICES) {
        const have = sim.state.buildings.filter((b) => b.villageId === v.id && b.kind === kind).length;
        if ((kind === 'palace' || kind === 'oasis' || kind === 'market' || kind === 'monastery') && have > 0) continue;
        let s = scoreBuilding(sim, v, kind, pop);
        for (const u of sim.citizens(v.id)) s += personLikes(u.person!.traits, kind) * (0.4 / Math.max(1, pop));
        s += sim.rng.range(0, 0.4);
        if (s > bestScore) {
            bestScore = s;
            best = kind;
        }
    }
    return best ? { type: 'build', building: best } : null;
};

const describe = (sim: Sim, v: Village, kind: ProposalKind): { title: string; reason: string } => {
    switch (kind.type) {
        case 'build': {
            const def = BUILDINGS[kind.building];
            const need = (Object.keys(def.satisfies) as NeedId[]).sort((a, b) => v.needs[a] - v.needs[b])[0];
            const reason = need ? `Our ${NEED_LABELS[need].toLowerCase()} is at ${Math.round(v.needs[need])}%.` : 'Many of us would love one.';
            return { title: `Build a ${def.name}`, reason };
        }
        case 'army':
            return { title: 'Train more soldiers', reason: `We feel unsafe (safety ${Math.round(v.needs.safety)}%).` };
        case 'peace':
            return { title: `Make peace with ${factionName(sim, kind.withFaction)}`, reason: 'We are tired of war.' };
        case 'war':
            return { title: `Declare war on ${factionName(sim, kind.withFaction)}`, reason: 'They have wronged us.' };
        case 'cancelProject':
            return { title: `Cancel the ${BUILDINGS[kind.building].name}`, reason: 'It costs a fortune and we never asked for it.' };
        default: {
            const never: never = kind;
            throw new Error(`Unknown proposal ${JSON.stringify(never)}`);
        }
    }
};

export const factionName = (sim: Sim, f: FactionId): string => {
    if (f === KINGDOM) return 'your kingdom';
    const vs = sim.state.villages.filter((v) => v.faction === f);
    return vs.length ? vs.map((v) => v.name).join(' & ') : f;
};

const personSupports = (_sim: Sim, v: Village, u: Unit, kind: ProposalKind): number => {
    const traits = u.person!.traits;
    switch (kind.type) {
        case 'build': {
            let s = personLikes(traits, kind.building);
            for (const [need, amount] of Object.entries(BUILDINGS[kind.building].satisfies) as [NeedId, number][]) {
                s += (1 - v.needs[need] / 100) * Math.min(amount, 40) / 20;
            }
            if (BUILDINGS[kind.building].grand && traits.includes('frugal')) s -= 1;
            return s;
        }
        case 'army':
            return traits.reduce((a, t) => a + TRAITS[t].warlike, 0) + (1 - v.needs.safety / 100);
        case 'peace':
            return -traits.reduce((a, t) => a + TRAITS[t].warlike, 0) + 0.3;
        case 'war':
            return traits.reduce((a, t) => a + TRAITS[t].warlike, 0) - 0.3;
        case 'cancelProject':
            return -personLikes(traits, kind.building) + (traits.includes('frugal') || traits.includes('lazy') ? 0.8 : 0) - 0.2;
        default: {
            const never: never = kind;
            throw new Error(`Unknown proposal ${JSON.stringify(never)}`);
        }
    }
};

export const startProposal = (sim: Sim, v: Village, kind: ProposalKind) => {
    const { title, reason } = describe(sim, v, kind);
    let yes = 0;
    let no = 0;
    for (const u of sim.citizens(v.id)) {
        if (personSupports(sim, v, u, kind) + sim.rng.range(-0.3, 0.3) > 0) yes++;
        else no++;
    }
    const p: Proposal = {
        id: sim.nextId(),
        kind,
        title,
        reason,
        yes,
        no,
        createdAt: sim.state.time,
        decider: v.playerPresent ? 'player' : 'leader',
        resolved: false
    };
    v.proposal = p;
    sim.log(`${v.name} votes: "${title}" — ${yes} for, ${no} against.`, 'politics', { x: v.cx, y: v.cy });
    if (p.decider === 'player') {
        sim.request({ type: 'vote', villageId: v.id, proposalId: p.id });
        sim.emit({ type: 'sound', id: 'bell' });
    }
};

const leaderDecides = (sim: Sim, v: Village, p: Proposal) => {
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const peopleWant = p.yes > p.no;
    if (!leader?.person) {
        resolveProposal(sim, v, peopleWant, 'leader');
        return;
    }
    const own = personSupports(sim, v, leader, p.kind);
    const leaderWants = own > 0;
    let approve = peopleWant;
    if (leaderWants !== peopleWant) {
        const ignore = leader.person.traits.reduce((s, t) => s + TRAITS[t].ignoresVotes, 0.2);
        if (sim.rng.chance(Math.max(0.05, Math.min(0.9, ignore)))) approve = leaderWants;
    }
    resolveProposal(sim, v, approve, 'leader');
};

export const resolveProposal = (sim: Sim, v: Village, approve: boolean, by: 'player' | 'leader') => {
    const p = v.proposal;
    if (!p || p.resolved) return;
    p.resolved = true;
    v.proposal = null;
    v.nextProposalAt = sim.state.time + PROPOSAL_INTERVAL;
    const peopleWant = peopleWantApproval(p);
    const preview = previewVote(sim, v, p, approve, by);
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const who = by === 'player' ? 'You' : leader?.person?.name ?? 'The people';

    if (approve) carryOut(sim, v, p.kind);
    v.unrest = preview.unrestAfter;
    v.loyalty = preview.loyaltyAfter;
    if (preview.grievance) v.grievances.push(preview.grievance);
    if (preview.agreesWithPeople) {
        sim.log(`${who} ${approve ? 'approved' : 'rejected'} "${p.title}", as the people wished.`, 'politics', { x: v.cx, y: v.cy });
    } else {
        if (by === 'leader' && leader?.person) leader.person.mood = Math.max(0, leader.person.mood - 10);
        sim.log(`${who} ignored the people of ${v.name} and ${approve ? 'approved' : 'rejected'} "${p.title}". Unrest grows.`, 'bad', { x: v.cx, y: v.cy });
    }
    if (by === 'leader' && !v.playerPresent) {
        v.awayReport.push(`${who} ${approve ? 'approved' : 'rejected'} "${p.title}" (${p.yes} for, ${p.no} against)${approve === peopleWant ? '' : ' — against the people\'s wishes'}.`);
    }
};

const carryOut = (sim: Sim, v: Village, kind: ProposalKind) => {
    switch (kind.type) {
        case 'build': {
            const spot = findBuildSpot(sim, v, kind.building);
            const res = spot ? placeFoundation(sim, v, kind.building, spot.x, spot.y, v.faction, false) : 'No room to build.';
            if (typeof res === 'string') {
                v.directives.push({ type: 'build', building: kind.building, issuedAt: sim.state.time });
                sim.log(`${v.name} will build the ${BUILDINGS[kind.building].name} once they can afford it.`, 'info');
            }
            return;
        }
        case 'army': {
            const b = sim.state.buildings.find((o) => o.villageId === v.id && o.built && o.kind === 'barracks');
            if (b) for (let i = 0; i < 3; i++) queueUnit(sim, b, 'militia');
            else v.directives.push({ type: 'build', building: 'barracks', issuedAt: sim.state.time });
            return;
        }
        case 'peace':
            setStatus(sim, KINGDOM, kind.withFaction, 'neutral', -10);
            sim.log(`Your kingdom made peace with ${factionName(sim, kind.withFaction)}.`, 'good');
            return;
        case 'war':
            setStatus(sim, KINGDOM, kind.withFaction, 'war', -60);
            return;
        case 'cancelProject': {
            const b = sim.buildingById.get(kind.buildingId);
            if (b && !b.built) {
                sim.refund(v.stock, BUILDINGS[b.kind].cost, 0.5);
                sim.removeBuilding(b);
                sim.log(`The ${BUILDINGS[kind.building].name} in ${v.name} was abandoned. Half the cost was recovered.`, 'politics');
            }
            return;
        }
        default: {
            const never: never = kind;
            throw new Error(`Unknown proposal ${JSON.stringify(never)}`);
        }
    }
};

/** The player ordered a grand project; frugal villagers get upset and may call a vote. */
export const reactToPlayerProject = (sim: Sim, v: Village, kind: BuildingKind) => {
    const people = sim.citizens(v.id);
    if (!people.length) return;
    const dislikers = people.filter((u) => personLikes(u.person!.traits, kind) < 0).length;
    const share = dislikers / people.length;
    v.unrest = Math.min(100, v.unrest + share * 25);
    if (share > 0.2) {
        sim.log(`Murmurs in ${v.name}: ${Math.round(share * 100)}% of the people think the ${BUILDINGS[kind].name} is a waste.`, 'politics', { x: v.cx, y: v.cy });
        if (people.length >= VOTE_THRESHOLD && !v.proposal) v.nextProposalAt = sim.state.time + 4;
    }
};

// ---------- joining, capturing, messengers ----------

export const joinKingdom = (sim: Sim, v: Village, promise: NeedId | null) => {
    const wasCamp = v.stage === 'camp';
    setVillageFaction(sim, v, KINGDOM);
    v.everJoined = true;
    v.loyalty = wasCamp ? 65 : 60;
    v.unrest = 10;
    v.lastVisitAt = sim.state.time;
    if (promise) {
        v.promises.push({
            need: promise,
            text: `we will have enough ${NEED_LABELS[promise].toLowerCase()}`,
            dueAt: sim.state.time + DAY_SECONDS * 5,
            kept: null
        });
        v.loyalty += 10;
    }
    if (wasCamp) {
        v.stage = 'village';
        for (const k of Object.keys(STARTING_STOCK) as (keyof typeof STARTING_STOCK)[]) v.stock[k] += STARTING_STOCK[k];
        v.stock.wood += 400;
        v.stock.stone += 100;
        const spot = findBuildSpot(sim, v, 'townCenter');
        if (spot) placeFoundation(sim, v, 'townCenter', spot.x, spot.y, KINGDOM, false);
        sim.log(`${v.name} has joined your kingdom! The people begin raising a Town Center.`, 'good', { x: v.cx, y: v.cy });
    } else {
        sim.log(`${v.name} has joined your kingdom!`, 'good', { x: v.cx, y: v.cy });
    }
    sim.emit({ type: 'sound', id: 'horn' });
};

export const captureVillage = (sim: Sim, v: Village, faction: FactionId) => {
    const oldFaction = v.faction;
    setVillageFaction(sim, v, faction);
    v.proposal = null;
    v.grievances = [];
    v.unrest = 45;
    v.leaderId = null;
    for (const u of sim.citizens(v.id)) u.person!.mood = Math.max(0, u.person!.mood - 10);
    if (faction === KINGDOM) {
        const retaken = v.everJoined;
        v.everJoined = true;
        v.loyalty = retaken ? 40 : 30;
        v.exiledPlayerAt = null;
        v.lastVisitAt = sim.state.time;
        if (!sim.state.villages.some((o) => o.faction === oldFaction)) delete sim.state.diplomacy.status[pairKey(KINGDOM, oldFaction)];
        sim.log(retaken ? `You have retaken ${v.name}! The people accept your rule — for now.` : `You conquered ${v.name}!`, 'good', { x: v.cx, y: v.cy });
        sim.emit({ type: 'sound', id: 'horn' });
    } else {
        v.loyalty = 20;
        sim.log(`${v.name} was captured by ${factionName(sim, faction)}.`, oldFaction === KINGDOM ? 'bad' : 'info', { x: v.cx, y: v.cy });
    }
};

/** A messenger arrived with an order or offer. */
export const receiveMessenger = (sim: Sim, v: Village, msg: MessengerOrder, from: FactionId) => {
    if (v.faction !== KINGDOM || from !== KINGDOM) {
        receiveDiplomat(sim, v, msg, from);
        return;
    }
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const traits = leader?.person?.traits ?? v.culture;
    let chance = 0.3 + (v.loyalty / 100) * 0.6 + traits.reduce((s, t) => s + TRAITS[t].obeys, 0);
    if (msg.type === 'build') chance += personLikes(traits, msg.building) * 0.15;
    if (msg.type === 'train' && traits.includes('peaceful')) chance -= 0.2;
    const name = leader?.person?.name ?? `The people of ${v.name}`;
    const what = describeOrder(msg);
    if (sim.rng.chance(Math.max(0.05, Math.min(0.98, chance)))) {
        v.directives.push({ ...msg, issuedAt: sim.state.time });
        sim.log(`Messenger arrived: ${name} agreed to ${what}.`, 'good', { x: v.cx, y: v.cy });
        v.awayReport.push(`${name} followed your order to ${what}.`);
    } else {
        v.loyalty = Math.max(0, v.loyalty - 2);
        sim.log(`Messenger arrived: ${name} refused to ${what}.`, 'politics', { x: v.cx, y: v.cy });
        v.awayReport.push(`${name} refused your order to ${what}.`);
    }
};

export const describeOrder = (msg: MessengerOrder): string => {
    switch (msg.type) {
        case 'build':
            return `build a ${BUILDINGS[msg.building].name}`;
        case 'train':
            return `train ${msg.count} ${UNITS[msg.unit].name}s`;
        case 'focus':
            return `focus on gathering ${msg.resource}`;
        case 'sendTroops':
            return 'send soldiers to you';
        case 'gift':
            return `accept a gift of ${msg.amount} ${msg.resource}`;
        case 'alliance':
            return 'form an alliance';
        case 'peace':
            return 'make peace';
        case 'invite':
            return 'join your kingdom';
        default: {
            const never: never = msg;
            throw new Error(`Unknown order ${JSON.stringify(never)}`);
        }
    }
};
