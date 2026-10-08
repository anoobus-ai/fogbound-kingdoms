import { BIOMES, NEED_LABELS } from '../data/biomes';
import { BUILDINGS, BUILD_MENU, type BuildCategory } from '../data/buildings';
import { COMMAND_RADIUS, VOTE_THRESHOLD } from '../data/balance';
import { TECHS } from '../data/techs';
import { TRAITS } from '../data/traits';
import { UNITS } from '../data/units';
import type { Controller } from '../game/controller';
import { factionColor } from '../render/entities';
import { freeUrl, oldUrl } from '../render/assets';
import type { Sim } from '../sim/sim';
import { KINGDOM, WILD, type Building, type NeedId, type Order, type Unit, type Village } from '../sim/types';
import { currentVillage, isBuildingCommandable, isCommandable } from '../sim/commands';
import { popCap, population } from '../sim/buildings';
import { NEED_IDS, needWeights } from '../sim/villages';
import { agendaAlignment, factionName } from '../sim/politics';
import { popularity } from '../sim/people';
import { bar, costHtml, esc, healthColor, icon, moodColor, personAvatar, resIcon, unitPortrait, unrestColor } from './dom';

export interface PanelState {
    buildTab: Exclude<BuildCategory, 'hidden' | 'core'>;
    villagePanelId: number | null;
    villagePanelClosed: boolean;
    /** The unit/building card starts compact; this opens the rest of its details. */
    selectionExpanded: boolean;
}

const fmt = (n: number) => Math.floor(n).toLocaleString();

const healthMeter = (current: number, max: number) => {
    const pct = max > 0 ? (current / max) * 100 : 0;
    return bar(pct, healthColor(pct), `Health ${Math.ceil(current)} / ${max}`, pct <= 35 ? 'health critical' : 'health');
};

// ---------- top bar ----------

export const renderTopbar = (sim: Sim): string => {
    const v = currentVillage(sim);
    const explorer = sim.explorer();
    const kingdomVillages = sim.state.villages.filter((o) => o.faction === KINGDOM && o.stage === 'village');
    const shown = v ?? (explorer ? nearest(kingdomVillages, explorer.x, explorer.y) : kingdomVillages[0]);
    const tod = sim.timeOfDay;
    const sunIcon = sim.isNight ? '🌙' : tod < 0.2 ? '🌅' : '☀️';
    const place = v ? `In ${esc(v.name)}` : shown ? `Wilderness · stores of ${esc(shown.name)}` : 'The Wilderness';
    const res = shown
        ? (['food', 'wood', 'gold', 'stone'] as const)
              .map((r) => `<span class="res" title="${r}">${resIcon(r)}${fmt(shown.stock[r])}</span>`)
              .join('') + `<span class="res" title="Population / housing">👥 ${population(sim, shown)}/${popCap(sim, shown)}</span>`
        : '<span class="muted" style="color:#e9d9b4">Find a camp and invite them to join you.</span>';
    return `
        <span class="place">${place}</span>
        ${res}
        <span class="clock">${sunIcon} Day ${sim.day} · ${cap(sim.season)} · ${kingdomVillages.length} ${kingdomVillages.length === 1 ? 'village' : 'villages'}</span>`;
};

const nearest = (vs: Village[], x: number, y: number) =>
    vs.slice().sort((a, b) => Math.hypot(a.cx - x, a.cy - y) - Math.hypot(b.cx - x, b.cy - y))[0];

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- selection panel ----------

/** Compact summary, with the rest of the card hidden until the player opens it. */
const inspectCard = (summary: string, details: string, expanded: boolean): string => `
    <div class="inspect${expanded ? ' open' : ''}">
        <div class="inspect-summary">${summary}</div>
        ${expanded ? `<div class="inspect-details">${details}</div>` : ''}
        <button type="button" class="inspect-toggle" data-action="toggle-inspect" aria-expanded="${expanded}">${expanded ? 'Less ▴' : 'More ▾'}</button>
    </div>`;

export const describeOrder = (sim: Sim, u: Unit): string => {
    if (u.engageId !== null) return 'Fighting';
    const o: Order = u.order;
    switch (o.type) {
        case 'idle':
            return u.kind === 'sheep' ? 'Grazing' : 'Idle';
        case 'move':
            return o.attackMove ? 'Marching (attacking anything in the way)' : 'Walking';
        case 'wander':
            return 'Wandering';
        case 'attack':
            return 'Attacking';
        case 'gather': {
            const r = sim.resourceById.get(o.resourceId);
            return r?.kind === 'tree' ? 'Chopping wood' : r?.kind === 'carcass' ? 'Butchering meat' : r?.kind === 'gold' ? 'Mining gold' : 'Quarrying stone';
        }
        case 'farm':
            return 'Farming';
        case 'returnCargo':
            return `Carrying ${u.carry?.type ?? 'goods'} home`;
        case 'build':
            return 'Building';
        case 'heal':
            return 'Healing';
        case 'convert':
            return `Converting (${Math.round((o.progress / 6) * 100)}%)`;
        case 'talk':
            return 'Going to talk';
        case 'deliver':
            return `Carrying a message to ${sim.village(o.villageId)?.name ?? '?'}`;
        case 'trade':
            return o.leg === 'toDest' ? `Trading goods to ${sim.village(o.toVillage)?.name}` : `Returning to ${sim.village(o.fromVillage)?.name}`;
        case 'follow':
            return 'Following';
        default: {
            const never: never = o;
            throw new Error(`Unknown order ${JSON.stringify(never)}`);
        }
    }
};

const relationChip = (sim: Sim, faction: string): string => {
    if (faction === KINGDOM) return '<span class="chip good">Your kingdom</span>';
    if (faction === WILD) return '<span class="chip neutral">Wild</span>';
    if (faction === 'bandit') return '<span class="chip bad">Bandits</span>';
    const status = sim.status(KINGDOM, faction);
    const cls = status === 'war' ? 'bad' : status === 'allied' ? 'good' : status === 'rival' ? 'politics' : 'neutral';
    return `<span class="chip ${cls}">${esc(factionName(sim, faction))} · ${status}</span>`;
};

const traitChips = (u: Unit): string =>
    u.person ? u.person.traits.map((t) => `<span class="chip" title="${esc(TRAITS[t].description)}">${TRAITS[t].name}</span>`).join('') : '';

const stanceButtons = (units: Unit[]): string => {
    const current = units.every((u) => u.stance === units[0].stance) ? units[0].stance : null;
    const b = (stance: string, label: string, title: string) =>
        `<button class="btn small ${current === stance ? 'active' : ''}" data-action="stance" data-stance="${stance}" title="${title}">${label}</button>`;
    return `<div class="row wrap">
        ${b('passive', '🛡 Passive', 'Only fights back when attacked (default).')}
        ${b('aggressive', '⚔ Attack on sight', 'Attacks any enemy it can see.')}
        ${b('hold', '✋ Hold', 'Stays put and only hits enemies in reach.')}
        <button class="btn small red" data-action="stop" title="Stop what they are doing">Stop</button>
    </div>`;
};

const buildMenu = (sim: Sim, state: PanelState): string => {
    const v = currentVillage(sim);
    const tabs = (Object.keys(BUILD_MENU) as PanelState['buildTab'][])
        .map((t) => `<button class="btn small ${state.buildTab === t ? 'active' : ''}" data-action="build-tab" data-tab="${t}">${cap(t)}</button>`)
        .join('');
    const items = BUILD_MENU[state.buildTab]
        .map((k) => {
            const def = BUILDINGS[k];
            const afford = v ? sim.canAfford(v.stock, def.cost) : false;
            return `<button class="btn tile ${afford ? '' : 'disabled'}" data-action="place" data-kind="${k}" title="${esc(def.description)}">
                <span>${esc(def.name)}${def.grand ? ' ★' : ''}</span><span>${costHtml(def.cost)}</span></button>`;
        })
        .join('');
    return `<div class="tabs">${icon('hammer')}${tabs}</div><div class="build-grid">${items}</div>
        <div class="muted">Click a building, then click on the map. Walls, roads and trees can be painted by dragging. Right-click cancels.</div>`;
};

export const renderSelection = (sim: Sim, c: Controller, state: PanelState): string => {
    const units = c.selectedUnitList();
    if (units.length === 1) return renderOneUnit(sim, units[0], state);
    if (units.length > 1) return renderManyUnits(sim, units, state);
    const b = c.selectedBuilding !== null ? sim.buildingById.get(c.selectedBuilding) : undefined;
    if (b) return renderBuilding(sim, b, state);
    if (c.selectedBuilding !== null) c.selectedBuilding = null;
    return '';
};

const renderOneUnit = (sim: Sim, u: Unit, state: PanelState): string => {
    const def = UNITS[u.kind];
    const color = factionColor(sim, u.faction);
    const village = sim.village(u.villageId);
    const commandable = isCommandable(sim, u);
    const portrait = u.person ? personAvatar(u.person.avatar, true) : unitPortrait(u.kind, color, 36);
    const namedHero = u.kind === 'explorer' && !!sim.state.kingdom.heroName?.trim();
    const title =
        u.kind === 'explorer'
            ? `<input id="hero-name" class="hero-name" maxlength="24" value="${esc(sim.heroName())}" placeholder="Name your hero" spellcheck="false" autocomplete="off" aria-label="Your hero's name" title="Click to name your hero">`
            : u.person
              ? `${esc(u.person.name)}`
              : def.name;
    const role = u.kind === 'explorer' ? (namedHero ? 'Explorer' : '') : u.person ? `${def.name}${village ? ` of ${esc(village.name)}` : ''}` : '';
    const leader = village && village.leaderId === u.id ? '<span class="chip politics">Leader</span>' : '';
    let extra = '';
    if (u.faction === KINGDOM && !commandable) {
        extra = `<div class="muted">Too far from your explorer to hear orders (over ${COMMAND_RADIUS} tiles). Walk closer or send a messenger.</div>`;
    } else if (commandable) {
        extra = stanceButtons([u]);
        if (u.kind === 'pawn') extra += buildMenu(sim, state);
        if (u.kind === 'monk') extra += '<div class="muted">Right-click an ally to heal them, or an enemy to convert them to your side.</div>';
        if (u.kind === 'explorer') {
            if (!namedHero) extra += `<div class="muted">Click the name to rename your hero.</div>`;
            extra += `<div class="muted">Your hero: soldiers near him deal 20% more damage. Right-click a camp or village to talk to them. Units within ${COMMAND_RADIUS} tiles obey your orders.</div>`;
            const v = currentVillage(sim);
            if (v) extra += `<button class="btn small" data-action="open-village" data-id="${v.id}">Open ${esc(v.name)}</button>`;
        }
        if (u.kind === 'pawn') extra += '<div class="muted">Right-click trees, gold, stone, sheep or farms to gather. Right-click an unfinished building to help build it.</div>';
    }
    const carry = u.carry && u.carry.amount >= 1 ? ` · carrying ${Math.floor(u.carry.amount)} ${u.carry.type}` : '';
    const summary = `<div class="row">
        ${portrait}
        <div class="col" style="flex:1;min-width:0">
            ${u.kind === 'explorer' ? title : `<h3>${title} ${leader}</h3>`}
            ${role ? `<div class="muted">${role}</div>` : ''}
            <div class="row wrap">${relationChip(sim, u.faction)}</div>
            ${healthMeter(u.hp, sim.maxHp(u.kind))}
            <div class="muted">${describeOrder(sim, u)}${carry}</div>
        </div>
    </div>`;
    const details = `
        ${traitChips(u) ? `<div class="row wrap">${traitChips(u)}</div>` : ''}
        ${u.person ? bar(u.person.mood, moodColor(u.person.mood), `Mood ${Math.round(u.person.mood)}`) : ''}
        <div class="muted">${esc(def.description)}</div>
        ${def.damage ? `<div class="muted">⚔ ${def.damage} dmg · 🛡 ${def.armor} armor · range ${def.range}</div>` : ''}
        ${extra}`;
    return inspectCard(summary, details, state.selectionExpanded);
};

const renderManyUnits = (sim: Sim, units: Unit[], state: PanelState): string => {
    const counts = new Map<string, { n: number; u: Unit }>();
    for (const u of units) {
        const e = counts.get(u.kind);
        if (e) e.n++;
        else counts.set(u.kind, { n: 1, u });
    }
    const chips = [...counts.values()]
        .map(({ n, u }) => `<div class="unit-chip" data-action="select-kind" data-kind="${u.kind}" title="${UNITS[u.kind].name}">${unitPortrait(u.kind, factionColor(sim, u.faction), 32)}<b>${n}</b></div>`)
        .join('');
    const commandable = units.filter((u) => isCommandable(sim, u));
    const hasPawn = commandable.some((u) => u.kind === 'pawn');
    const far = units.length - commandable.length;
    const summary = `<div class="col">
        <h3>${units.length} units</h3>
        <div class="units-grid">${chips}</div>
    </div>`;
    const details = `
        ${far ? `<div class="muted">${far} of them are too far from your explorer to hear orders.</div>` : ''}
        ${commandable.length ? stanceButtons(commandable) : ''}
        ${hasPawn ? buildMenu(sim, state) : ''}
        <div class="muted">Right-click to move or attack. Hold Ctrl and right-click to march and attack anything on the way.</div>`;
    return inspectCard(summary, details, state.selectionExpanded);
};

const buildingArt = (sim: Sim, b: Building, height = 40): string => {
    const color = factionColor(sim, b.faction);
    const art: Partial<Record<Building['kind'], string>> = {
        townCenter: freeUrl(`Buildings/${color} Buildings/Castle.png`),
        house: freeUrl(`Buildings/${color} Buildings/House${b.variant + 1}.png`),
        campHut: freeUrl(`Buildings/${color} Buildings/House1.png`),
        granary: freeUrl(`Buildings/${color} Buildings/House2.png`),
        market: freeUrl(`Buildings/${color} Buildings/House3.png`),
        tower: freeUrl(`Buildings/${color} Buildings/Tower.png`),
        barracks: freeUrl(`Buildings/${color} Buildings/Barracks.png`),
        archery: freeUrl(`Buildings/${color} Buildings/Archery.png`),
        monastery: freeUrl(`Buildings/${color} Buildings/Monastery.png`),
        palace: oldUrl('Factions/Knights/Buildings/Castle/Castle_Yellow.png'),
        mine: oldUrl('Resources/Gold Mine/GoldMine_Active.png'),
        goblinHut: oldUrl('Factions/Goblins/Buildings/Wood_House/Goblin_House.png'),
        farm: oldUrl('Deco/18.png'),
        lumberCamp: oldUrl('Resources/Resources/W_Idle.png'),
        garden: oldUrl('Deco/12.png')
    };
    const src = art[b.kind];
    return src ? `<img class="building-art" src="${src}" style="height:${height}px" alt="">` : '';
};

const renderBuilding = (sim: Sim, b: Building, state: PanelState): string => {
    const def = BUILDINGS[b.kind];
    const v = sim.village(b.villageId);
    const max = sim.buildingMaxHp(b);
    const commandable = isBuildingCommandable(sim, b);
    let body = '';
    if (!b.built) {
        body += '<div class="muted">Select villagers and right-click it to help build.</div>';
    } else if (b.faction === KINGDOM && commandable) {
        if (def.trains.length) {
            const trains = def.trains
                .map((k) => {
                    const ud = UNITS[k];
                    const afford = v ? sim.canAfford(v.stock, ud.cost) : false;
                    return `<button class="btn tile ${afford ? '' : 'disabled'}" data-action="train" data-id="${b.id}" data-unit="${k}" title="${esc(ud.description)}">
                        ${unitPortrait(k, 'Blue', 34)}<span>${ud.name}</span><span>${costHtml(ud.cost)}</span></button>`;
                })
                .join('');
            body += `<h4>Train</h4><div class="build-grid">${trains}</div>`;
        }
        if (b.queue.length) {
            body += `<div class="queue">${b.queue
                .map((q, i) => `<div data-action="cancel-train" data-id="${b.id}" data-index="${i}" title="Click to cancel">${unitPortrait(q.unit, 'Blue', 36)}</div>`)
                .join('')}</div>`;
            if (v && population(sim, v) >= popCap(sim, v) && b.queue.some((q) => UNITS[q.unit].unitClass !== 'civilian')) {
                body += '<div class="muted" style="color:#c0392b">Not enough housing! Build more houses.</div>';
            }
        }
        if (def.researches.length) {
            const techs = def.researches
                .map((t) => {
                    const td = TECHS[t];
                    const done = sim.hasTech(t);
                    const active = b.research?.tech === t;
                    const locked = td.requires && !sim.hasTech(td.requires);
                    return `<button class="btn tile ${done || locked ? 'disabled' : ''} ${active ? 'active' : ''}" data-action="research" data-id="${b.id}" data-tech="${t}" title="${esc(td.description)}${locked ? ` (needs ${TECHS[td.requires!].name})` : ''}">
                        <span>${done ? '✔ ' : ''}${td.name}</span><span>${active ? `${Math.round(b.research!.progress * 100)}%` : done ? 'Done' : costHtml(td.cost)}</span></button>`;
                })
                .join('');
            body += `<h4>Research</h4><div class="build-grid">${techs}</div>`;
        }
        if (b.kind === 'townCenter' && v) body += `<button class="btn small" data-action="open-village" data-id="${v.id}">Open ${esc(v.name)} ▸</button>`;
        if (b.kind !== 'townCenter') body += ` <button class="btn small red" data-action="demolish" data-id="${b.id}">Demolish</button>`;
    } else if (b.faction === KINGDOM && v) {
        body += `<div class="muted">Your explorer is too far away to give orders here.</div>
            <button class="btn small" data-action="messenger" data-id="${v.id}">✉ Send a messenger to ${esc(v.name)}</button>`;
    } else if (v) {
        body += `<div class="muted">${v.stage === 'camp' ? 'A small camp.' : 'An independent village.'} Opinion of you: ${Math.round(v.loyalty)}.</div>
            <button class="btn small" data-action="talk-to" data-id="${v.id}">Talk to ${esc(v.name)}</button>
            <button class="btn small" data-action="messenger" data-id="${v.id}">✉ Send a messenger</button>`;
    }
    const summary = `<div class="row">
        ${buildingArt(sim, b)}
        <div class="col" style="flex:1;min-width:0">
            <h3>${def.name}</h3>
            ${v ? `<div class="muted">${esc(v.name)}</div>` : ''}
            <div class="row wrap">${relationChip(sim, b.faction)}</div>
            ${b.built ? healthMeter(b.hp, max) : bar(b.progress * 100, '#5bc0ff', `${Math.round(b.progress * 100)}% built`)}
        </div>
    </div>`;
    return inspectCard(summary, `<div class="muted">${esc(def.description)}</div>${body}`, state.selectionExpanded);
};

// ---------- village panel ----------

export const panelVillage = (sim: Sim, state: PanelState): Village | undefined => {
    if (state.villagePanelId !== null) {
        const v = sim.village(state.villagePanelId);
        if (v) return v;
        state.villagePanelId = null;
    }
    if (state.villagePanelClosed) return undefined;
    return currentVillage(sim);
};

export const renderVillage = (sim: Sim, v: Village): string => {
    const pop = population(sim, v);
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const weights = needWeights(sim, v);
    const important = NEED_IDS.slice().sort((a, b) => weights[b] - weights[a]).slice(0, 3);
    const needs = NEED_IDS.map(
        (n: NeedId) => `<div class="${important.includes(n) ? 'need-important' : ''}" title="${important.includes(n) ? 'This matters most to these people' : ''}">${bar(v.needs[n], moodColor(v.needs[n]), `${NEED_LABELS[n]} ${Math.round(v.needs[n])}%`)}</div>`
    ).join('');
    const own = v.faction === KINGDOM;
    const present = v.playerPresent;
    const alignment = agendaAlignment(sim, v);
    const p = v.proposal;
    let vote = '';
    if (p && !p.resolved) {
        vote = `<div class="vote-box"><h4>🗳 The people vote: ${esc(p.title)}</h4>
            <div class="muted">${esc(p.reason)}</div>
            <div class="row"><span class="chip good">${p.yes} for</span><span class="chip bad">${p.no} against</span>
            <span class="muted">${p.decider === 'player' ? 'You decide.' : `${esc(leader?.person?.name ?? 'The leader')} will decide.`}</span></div>
            ${p.decider === 'player' && present ? `<div class="row"><button class="btn small" data-action="vote" data-id="${v.id}" data-approve="1">Approve</button><button class="btn small red" data-action="vote" data-id="${v.id}" data-approve="0">Reject</button></div>` : ''}
        </div>`;
    } else if (own && pop < VOTE_THRESHOLD) {
        vote = `<div class="muted">At ${VOTE_THRESHOLD} citizens the people will start voting on decisions (${pop}/${VOTE_THRESHOLD}).</div>`;
    }
    const citizens = sim
        .citizens(v.id)
        .sort((a, b) => popularity(b) - popularity(a))
        .map(
            (u) => `<div class="citizen" data-action="select-unit" data-id="${u.id}">
                ${personAvatar(u.person!.avatar, true)}
                <div style="flex:1"><b>${esc(u.person!.name)}</b>${u.id === v.leaderId ? ' <span class="chip politics">Leader</span>' : ''}
                <span class="muted">${UNITS[u.kind].name} · ${describeOrder(sim, u)}</span><br>${traitChips(u)}</div>
                <div style="width:60px">${bar(u.person!.mood, moodColor(u.person!.mood), `${Math.round(u.person!.mood)}`)}</div>
            </div>`
        )
        .join('');
    const promises = v.promises
        .filter((pr) => pr.kept === null)
        .map((pr) => `<li>Promised: ${esc(pr.text)} (due day ${Math.floor(pr.dueAt / 60) + 1})</li>`)
        .join('');
    const grievances = v.grievances
        .slice(-4)
        .map((g) => `<li>${esc(g)}</li>`)
        .join('');
    const friends = sim.state.villages.filter((o) => o.id !== v.id && o.stage === 'village' && sim.friendlyFactions(o.faction, v.faction));
    const focusBtn = (r: string | null, label: string) =>
        `<button class="btn small ${v.focus === r ? 'active' : ''}" data-action="focus" data-id="${v.id}" data-res="${r ?? ''}">${label}</button>`;
    return `<div class="row" style="justify-content:space-between"><h2>${esc(v.name)}</h2>
            <button class="btn small red" data-action="close-village">✕</button></div>
        <div class="muted">${BIOMES[v.biome].name} — ${esc(BIOMES[v.biome].description)}</div>
        <div class="row wrap">${relationChip(sim, v.faction)} ${v.culture.map((t) => `<span class="chip neutral" title="${esc(TRAITS[t].description)}">${TRAITS[t].name}</span>`).join('')}</div>
        <div class="row" style="margin-top:6px">
            ${leader?.person ? personAvatar(leader.person.avatar) : ''}
            <div class="col" style="flex:1">
                <b>${leader?.person ? `Leader: ${esc(leader.person.name)}` : 'No leader'}</b>
                <div>${leader ? traitChips(leader) : ''}</div>
                ${own && present ? '<button class="btn small" data-action="appoint-open" data-id="' + v.id + '">Choose a leader</button>' : ''}
            </div>
        </div>
        ${bar(v.happiness, moodColor(v.happiness), `Happiness ${Math.round(v.happiness)}%`)}
        ${bar(v.unrest, unrestColor(v.unrest), `Unrest ${Math.round(v.unrest)}%`)}
        ${bar(v.loyalty, moodColor(v.loyalty), `${own ? 'Loyalty' : 'Opinion of you'} ${Math.round(v.loyalty)}%`)}
        ${own ? `<div class="muted">Your agenda ${alignment > 0.2 ? 'pleases' : alignment < -0.2 ? 'upsets' : 'means little to'} these people (${alignment >= 0 ? '+' : ''}${Math.round(alignment * 100)}).</div>` : ''}
        ${vote}
        <h4>Needs <span class="muted">(★ = matters most here)</span></h4>
        <div class="needs">${needs}</div>
        ${promises ? `<h4>Promises</h4><ul>${promises}</ul>` : ''}
        ${grievances ? `<h4>Grievances</h4><ul style="color:#8b2a1f">${grievances}</ul>` : ''}
        ${own ? `<h4>Gathering focus</h4><div class="row wrap">${focusBtn(null, 'Balanced')}${focusBtn('food', 'Food')}${focusBtn('wood', 'Wood')}${focusBtn('gold', 'Gold')}${focusBtn('stone', 'Stone')}</div>` : ''}
        ${own && friends.length ? `<h4>Trade</h4><div class="row wrap">${friends.map((f) => `<button class="btn small" data-action="trade" data-from="${v.id}" data-to="${f.id}">🐪 Caravan to ${esc(f.name)}</button>`).join('')}</div>` : ''}
        ${!present ? `<div class="row wrap" style="margin-top:6px"><button class="btn small" data-action="messenger" data-id="${v.id}">✉ Send a messenger</button><button class="btn small" data-action="goto" data-x="${v.cx}" data-y="${v.cy}">Look</button></div>` : ''}
        <h4>People (${pop})</h4>
        <div>${citizens}</div>`;
};