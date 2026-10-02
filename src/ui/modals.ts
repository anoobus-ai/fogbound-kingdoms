import { BIOMES, NEED_LABELS } from '../data/biomes';
import { BUILDINGS, BUILD_MENU } from '../data/buildings';
import { COMMAND_RADIUS, PRESENCE_RADIUS, REBELLION_AFTER, UNREST_HIGH, VOTE_THRESHOLD } from '../data/balance';
import { AGENDAS, MAX_AGENDA, TECHS } from '../data/techs';
import { TRAITS } from '../data/traits';
import { FIGHTER_KINDS, UNITS } from '../data/units';
import type { Sim } from '../sim/sim';
import { pairKey } from '../sim/state';
import { KINGDOM, type AgendaId, type NeedId, type UiRequest, type Village } from '../sim/types';
import { popCap, population } from '../sim/buildings';
import { NEED_IDS, needWeights } from '../sim/villages';
import { agendaAlignment, factionName } from '../sim/politics';
import { independentFactions } from '../sim/diplomacy';
import { popularity } from '../sim/people';
import { slotInfo } from '../sim/save';
import { MERCHANT_DEALS } from '../sim/world';
import { bar, costHtml, esc, moodColor, personAvatar, unitPortrait, unrestColor } from './dom';
import { cap, clockText, votePreviewHtml } from './panels';
import { unrestReadout } from '../sim/politics';

export type ModalView =
    | { kind: 'request'; req: UiRequest }
    | { kind: 'appoint'; villageId: number }
    | { kind: 'messenger'; villageId: number }
    | { kind: 'talk'; villageId: number }
    | { kind: 'kingdom' }
    | { kind: 'diplomacy' }
    | { kind: 'agenda'; draft: AgendaId[] }
    | { kind: 'log' }
    | { kind: 'menu' }
    | { kind: 'help' };

/** Modals that contain inputs are drawn once; the rest refresh live. */
export const isLive = (m: ModalView): boolean => m.kind !== 'menu' && m.kind !== 'help';

const close = '<button class="btn small red close" data-action="close-modal">✕</button>';
const statusSpan = (s: string) => `<span class="status-${s}">${s}</span>`;
const traitList = (traits: string[]) =>
    traits.map((t) => `<span class="chip" title="${esc(TRAITS[t as keyof typeof TRAITS].description)}">${TRAITS[t as keyof typeof TRAITS].name}</span>`).join('');

export const renderModal = (sim: Sim, m: ModalView): { html: string; cls: string } => {
    switch (m.kind) {
        case 'request':
            return renderRequest(sim, m.req);
        case 'appoint':
            return { html: appointHtml(sim, m.villageId, false), cls: 'scroll' };
        case 'messenger':
            return { html: messengerHtml(sim, m.villageId), cls: 'scroll' };
        case 'talk':
            return { html: talkHtml(sim, m.villageId), cls: 'scroll' };
        case 'kingdom':
            return { html: kingdomHtml(sim), cls: 'scroll wide' };
        case 'diplomacy':
            return { html: diplomacyHtml(sim), cls: 'scroll wide' };
        case 'agenda':
            return { html: agendaHtml(sim, m.draft), cls: 'scroll wide' };
        case 'log':
            return { html: logHtml(sim), cls: 'scroll wide' };
        case 'menu':
            return { html: menuHtml(sim), cls: 'scroll wide' };
        case 'help':
            return { html: helpHtml(), cls: 'scroll wide' };
        default: {
            const never: never = m;
            throw new Error(`Unknown modal ${JSON.stringify(never)}`);
        }
    }
};

const renderRequest = (sim: Sim, req: UiRequest): { html: string; cls: string } => {
    switch (req.type) {
        case 'appointLeader':
            return { html: appointHtml(sim, req.villageId, true), cls: 'scroll' };
        case 'vote':
            return { html: voteHtml(sim, req.villageId), cls: 'scroll' };
        case 'exiled': {
            const v = sim.village(req.villageId);
            return {
                cls: 'scroll exiled',
                html: `${close}<h2>Exiled from ${esc(v?.name ?? 'the village')}!</h2>
                    <p>The people have turned against you. Their reasons:</p>
                    <ul>${req.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
                    <p><b>How to take it back:</b> find an ally — another village of yours, or an independent village that likes you —
                    build an army, then march on their Town Center. Knock it down and the village is yours again.
                    Allied villages can lend you soldiers (Diplomacy → Ask for soldiers).</p>
                    <div class="modal-actions"><button class="btn" data-action="open-screen" data-screen="diplomacy">Open Diplomacy</button>
                    <button class="btn red" data-action="close-modal">I will return...</button></div>`
            };
        }
        case 'returnReport': {
            const v = sim.village(req.villageId);
            const leader = v ? sim.unitById.get(v.leaderId ?? -1) : undefined;
            return {
                cls: 'scroll',
                html: `${close}<h2>Welcome back to ${esc(v?.name ?? '')}</h2>
                    ${leader?.person ? `<div class="row">${personAvatar(leader.person.avatar)}<div><b>${esc(leader.person.name)}</b> ruled while you were away.<br>${traitList(leader.person.traits)}</div></div>` : ''}
                    <h4>What happened</h4><ul>${req.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                    <div class="modal-actions"><button class="btn" data-action="close-modal">Well done — keep ruling</button>
                    <button class="btn red" data-action="appoint-open" data-id="${req.villageId}">I disagree — choose a new leader</button></div>
                    <div class="muted">Replacing a popular leader will upset the people.</div>`
            };
        }
        case 'talk':
            return { html: talkHtml(sim, req.villageId), cls: 'scroll' };
        case 'event':
            return { cls: 'scroll', html: `${close}<h2>${esc(req.title)}</h2><p>${esc(req.text)}</p><div class="modal-actions"><button class="btn" data-action="close-modal">OK</button></div>` };
        case 'merchant': {
            const v = sim.village(req.villageId);
            const deals = MERCHANT_DEALS.map((d, i) => `<button class="btn" data-action="merchant" data-id="${req.villageId}" data-index="${i}">${esc(d.label)}</button>`).join('');
            return {
                cls: 'scroll',
                html: `${close}<h2>A traveling merchant</h2><p>A merchant has set up a stall in ${esc(v?.name ?? '')}. Trades use ${esc(v?.name ?? '')}'s stores.</p>
                    ${v ? `<div class="row">${costHtml(v.stock)}</div>` : ''}
                    <div class="modal-actions">${deals}</div><div class="modal-actions"><button class="btn red" data-action="close-modal">Send them on their way</button></div>`
            };
        }
        default: {
            const never: never = req;
            throw new Error(`Unknown request ${JSON.stringify(never)}`);
        }
    }
};

const voteHtml = (sim: Sim, villageId: number): string => {
    const v = sim.village(villageId);
    const p = v?.proposal;
    if (!v || !p) return `${close}<p>The vote is over.</p>`;
    const total = Math.max(1, p.yes + p.no);
    return `${close}<h2>🗳 ${esc(v.name)} has voted</h2>
        <h3>"${esc(p.title)}"</h3>
        <p>${esc(p.reason)}</p>
        ${bar((p.yes / total) * 100, '#5fd35a', `${p.yes} for`)}
        ${bar((p.no / total) * 100, '#e0463c', `${p.no} against`)}
        <p>You are here, so the final say is yours. The numbers below are what each choice changes.</p>
        ${votePreviewHtml(sim, v, p, 'player')}
        <div class="modal-actions">
            <button class="btn" data-action="vote" data-id="${v.id}" data-approve="1">Approve</button>
            <button class="btn red" data-action="vote" data-id="${v.id}" data-approve="0">Reject</button>
        </div>`;
};

const appointHtml = (sim: Sim, villageId: number, leaving: boolean): string => {
    const v = sim.village(villageId);
    if (!v) return close;
    const current = sim.unitById.get(v.leaderId ?? -1);
    const people = sim.citizens(v.id).sort((a, b) => popularity(b) - popularity(a));
    const rows = people
        .map((u, i) => {
            const p = u.person!;
            const hint = p.traits.includes('stubborn') || p.traits.includes('ambitious') ? 'May ignore the people' : p.traits.includes('loyal') ? 'Follows your orders' : '';
            return `<tr><td>${personAvatar(p.avatar, true)}</td><td><b>${esc(p.name)}</b>${i === 0 ? ' <span class="chip good">People\'s favourite</span>' : ''}${u.id === v.leaderId ? ' <span class="chip politics">Leader</span>' : ''}<br>${traitList(p.traits)}</td>
                <td class="muted">${hint}</td><td><button class="btn small" data-action="appoint" data-id="${v.id}" data-unit="${u.id}">Appoint</button></td></tr>`;
        })
        .join('');
    return `${close}<h2>${leaving ? `Who leads ${esc(v.name)} while you are away?` : `Choose a leader for ${esc(v.name)}`}</h2>
        <p class="muted">The leader makes decisions while you are gone: what to build, whether to follow the people's votes, and whether to obey your messengers.
        Their personality matters! ${current?.person ? `Right now: <b>${esc(current.person.name)}</b>.` : ''}</p>
        <table class="grid">${rows}</table>
        <div class="modal-actions"><button class="btn" data-action="close-modal">Keep ${esc(current?.person?.name ?? 'things as they are')}</button></div>`;
};

const topNeeds = (sim: Sim, v: Village): NeedId[] => {
    const w = needWeights(sim, v);
    return NEED_IDS.slice().sort((a, b) => w[b] * (100 - v.needs[b]) - w[a] * (100 - v.needs[a])).slice(0, 3);
};

const talkHtml = (sim: Sim, villageId: number): string => {
    const v = sim.village(villageId);
    if (!v) return close;
    const people = sim.citizens(v.id);
    const leader = sim.unitById.get(v.leaderId ?? -1);
    const faces = people
        .slice(0, 8)
        .map((u) => personAvatar(u.person!.avatar, true, `${u.person!.name}: ${u.person!.traits.map((t) => TRAITS[t].name).join(', ')}`))
        .join('');
    const culture = traitList(v.culture);
    const explorer = sim.explorer();
    const near = explorer && Math.hypot(explorer.x - v.cx, explorer.y - v.cy) < 8;
    const intro = `${close}<h2>${esc(v.name)}</h2>
        <div class="muted">${BIOMES[v.biome].name}: ${esc(BIOMES[v.biome].description)}</div>
        <div class="row wrap" style="margin:6px 0">${faces}</div>
        <div>What they value: ${culture}</div>
        ${bar(v.loyalty, moodColor(v.loyalty), `Opinion of you ${Math.round(v.loyalty)}`)}`;
    if (!near) return `${intro}<p>You need to be in the village to talk. Walk closer, or send a messenger.</p>`;
    if (v.stage === 'camp') {
        const needs = topNeeds(sim, v);
        const promises = needs
            .map((n) => `<button class="btn" data-action="talk" data-id="${v.id}" data-do="join" data-promise="${n}">Join me — I promise ${NEED_LABELS[n].toLowerCase()}</button>`)
            .join('');
        return `${intro}
            <p>"We are only ${people.length}, living off the land. Life here is hard: we worry most about <b>${needs.map((n) => NEED_LABELS[n].toLowerCase()).join(', ')}</b>."</p>
            <p class="muted">If they join, they become a village of your kingdom and start building a Town Center. A promise makes them more willing,
            but they will check in 5 days whether you kept it.</p>
            <div class="modal-actions">
                <button class="btn" data-action="talk" data-id="${v.id}" data-do="join" data-promise="">Invite them to join your kingdom</button>
                ${promises}
                <button class="btn" data-action="talk" data-id="${v.id}" data-do="gift" data-res="food" data-amount="50">Share 50 food</button>
            </div>`;
    }
    const status = sim.status(KINGDOM, v.faction);
    return `${intro}
        <p>Status: ${statusSpan(status)} · Leader: ${leader?.person ? `<b>${esc(leader.person.name)}</b> ${traitList(leader.person.traits)}` : 'none'} · ${population(sim, v)} people</p>
        <p class="muted">Gifts raise their opinion. At 55 they accept an alliance, at 70 they will join your kingdom. Allies can lend you soldiers.</p>
        <div class="modal-actions">
            <button class="btn" data-action="talk" data-id="${v.id}" data-do="gift" data-res="food" data-amount="100">Gift 100 food</button>
            <button class="btn" data-action="talk" data-id="${v.id}" data-do="gift" data-res="wood" data-amount="100">Gift 100 wood</button>
            <button class="btn" data-action="talk" data-id="${v.id}" data-do="gift" data-res="gold" data-amount="50">Gift 50 gold</button>
            ${status === 'war' ? `<button class="btn" data-action="talk" data-id="${v.id}" data-do="peace">Offer peace</button>` : `<button class="btn" data-action="talk" data-id="${v.id}" data-do="alliance">Propose alliance</button>`}
            <button class="btn" data-action="talk" data-id="${v.id}" data-do="invite">Invite to join your kingdom</button>
            ${status === 'allied' ? `<button class="btn" data-action="talk" data-id="${v.id}" data-do="sendTroops">Ask for soldiers</button>` : ''}
            ${status !== 'war' ? `<button class="btn red" data-action="declare-war" data-id="${v.id}">Declare war</button>` : ''}
        </div>`;
};

const messengerHtml = (sim: Sim, villageId: number): string => {
    const v = sim.village(villageId);
    if (!v) return close;
    const head = `${close}<h2>✉ Messenger to ${esc(v.name)}</h2>
        <p class="muted">A messenger runs from your explorer to the village. It takes time and can be ambushed.
        ${v.faction === KINGDOM ? 'The leader decides whether to obey, depending on their loyalty and personality.' : 'They will consider your offer.'}</p>`;
    if (v.faction !== KINGDOM) {
        const status = sim.status(KINGDOM, v.faction);
        return `${head}<div class="modal-actions">
            <button class="btn" data-action="send" data-id="${v.id}" data-msg="gift" data-res="food" data-amount="100">Gift 100 food</button>
            <button class="btn" data-action="send" data-id="${v.id}" data-msg="gift" data-res="gold" data-amount="50">Gift 50 gold</button>
            ${status === 'war' ? `<button class="btn" data-action="send" data-id="${v.id}" data-msg="peace">Offer peace</button>` : `<button class="btn" data-action="send" data-id="${v.id}" data-msg="alliance">Propose alliance</button>`}
            <button class="btn" data-action="send" data-id="${v.id}" data-msg="invite">Invite to join</button>
            ${status === 'allied' ? `<button class="btn" data-action="send" data-id="${v.id}" data-msg="sendTroops">Ask for soldiers</button>` : ''}
        </div>`;
    }
    const builds = [...BUILD_MENU.economy, ...BUILD_MENU.military.filter((k) => k !== 'wall' && k !== 'gate'), ...BUILD_MENU.grand]
        .map((k) => `<button class="btn tile" data-action="send" data-id="${v.id}" data-msg="build" data-kind="${k}" title="${esc(BUILDINGS[k].description)}"><span>${BUILDINGS[k].name}</span><span>${costHtml(BUILDINGS[k].cost)}</span></button>`)
        .join('');
    const trains = FIGHTER_KINDS.map(
        (k) => `<button class="btn tile" data-action="send" data-id="${v.id}" data-msg="train" data-unit="${k}">${unitPortrait(k, 'Blue', 30)}<span>3 ${UNITS[k].name}s</span></button>`
    ).join('');
    return `${head}
        <div class="row">${costHtml(v.stock)} <span class="muted">(${esc(v.name)}'s stores)</span></div>
        <h4>Build</h4><div class="build-grid">${builds}</div>
        <h4>Train soldiers</h4><div class="build-grid">${trains}</div>
        <h4>Other orders</h4><div class="modal-actions">
            ${(['food', 'wood', 'gold', 'stone'] as const).map((r) => `<button class="btn small" data-action="send" data-id="${v.id}" data-msg="focus" data-res="${r}">Focus on ${r}</button>`).join('')}
            <button class="btn small" data-action="send" data-id="${v.id}" data-msg="sendTroops">Send soldiers to me</button>
        </div>`;
};

const kingdomHtml = (sim: Sim): string => {
    const villages = sim.state.villages.filter((v) => v.faction === KINGDOM && v.stage === 'village');
    const rows = villages
        .map((v) => {
            const leader = sim.unitById.get(v.leaderId ?? -1);
            const left = unrestReadout(v, sim.state.time).rebellionIn;
            const clock = left == null ? '' : `<div class="rebellion-clock tight">Rebels in ${clockText(left)}</div>`;
            return `<tr>
                <td><b>${esc(v.name)}</b><br><span class="muted">${BIOMES[v.biome].name}</span></td>
                <td>${population(sim, v)}/${popCap(sim, v)}</td>
                <td style="width:90px">${bar(v.happiness, moodColor(v.happiness), `${Math.round(v.happiness)}`)}</td>
                <td style="width:110px">${bar(v.unrest, unrestColor(v.unrest), `${Math.round(v.unrest)}`)}${clock}</td>
                <td style="width:90px">${bar(v.loyalty, moodColor(v.loyalty), `${Math.round(v.loyalty)}`)}</td>
                <td>${v.playerPresent ? '<span class="chip good">You are here</span>' : esc(leader?.person?.name ?? '—')}</td>
                <td>${costHtml(v.stock)}</td>
                <td><div class="row"><button class="btn small" data-action="goto" data-x="${v.cx}" data-y="${v.cy}">Look</button>
                <button class="btn small" data-action="open-village" data-id="${v.id}">Open</button>
                ${v.playerPresent ? '' : `<button class="btn small" data-action="messenger" data-id="${v.id}">✉</button>`}</div></td>
            </tr>`;
        })
        .join('');
    const techs = (Object.keys(TECHS) as (keyof typeof TECHS)[])
        .map((t) => `<span class="chip ${sim.hasTech(t) ? 'good' : 'neutral'}" title="${esc(TECHS[t].description)}">${sim.hasTech(t) ? '✔ ' : ''}${TECHS[t].name}</span>`)
        .join('');
    const agenda = sim.state.kingdom.agenda.map((a) => `<span class="chip politics">${AGENDAS[a].name}</span>`).join('') || '<span class="muted">none chosen</span>';
    const ruler = sim.state.kingdom.heroName?.trim() ? `${esc(sim.heroName())}'s Kingdom` : 'Your Kingdom';
    return `${close}<h2>👑 ${ruler}</h2>
        ${villages.length ? `<table class="grid"><tr><th>Village</th><th>People</th><th>Happy</th><th>Unrest</th><th>Loyalty</th><th>Leader</th><th>Stores</th><th></th></tr>${rows}</table>` : '<p>You have no villages yet. Explore and talk to the people living in camps.</p>'}
        <h4>Agenda</h4><div>${agenda} <button class="btn small" data-action="open-screen" data-screen="agenda">Change</button></div>
        <h4>Technologies</h4><div class="row wrap">${techs}</div>
        <p class="muted">Villages with ${VOTE_THRESHOLD}+ people vote on decisions. You command villages within ${PRESENCE_RADIUS} tiles and units within ${COMMAND_RADIUS} tiles of your explorer; send messengers to the rest.</p>`;
};

const diplomacyHtml = (sim: Sim): string => {
    const known = sim.state.villages.filter((v) => v.discovered && v.faction !== KINGDOM);
    const rows = known
        .map((v) => {
            const status = v.stage === 'camp' ? 'neutral' : sim.status(KINGDOM, v.faction);
            return `<tr><td><b>${esc(v.name)}</b><br><span class="muted">${v.stage === 'camp' ? 'Camp' : 'Village'} · ${BIOMES[v.biome].name}</span></td>
                <td>${statusSpan(status)}</td>
                <td style="width:120px">${bar(v.loyalty, moodColor(v.loyalty), `Opinion ${Math.round(v.loyalty)}`)}</td>
                <td>${traitList(v.culture)}</td>
                <td><div class="row"><button class="btn small" data-action="goto" data-x="${v.cx}" data-y="${v.cy}">Look</button>
                <button class="btn small" data-action="messenger" data-id="${v.id}">✉ Messenger</button></div></td></tr>`;
        })
        .join('');
    const factions = independentFactions(sim).filter((f) => sim.state.villages.some((v) => v.faction === f && v.discovered && v.stage === 'village'));
    let matrix = '';
    if (factions.length > 1) {
        const head = factions.map((f) => `<th>${esc(factionName(sim, f))}</th>`).join('');
        const body = factions
            .map(
                (a) =>
                    `<tr><th>${esc(factionName(sim, a))}</th>${factions
                        .map((b) => (a === b ? '<td>—</td>' : `<td>${statusSpan(sim.status(a, b))} <span class="muted">${Math.round(sim.state.diplomacy.relations[pairKey(a, b)] ?? 0)}</span></td>`))
                        .join('')}</tr>`
            )
            .join('');
        matrix = `<h4>How the villages feel about each other</h4><p class="muted">Villages with shared values become friends; clashing values and close borders breed rivalry and war.</p>
            <table class="grid"><tr><th></th>${head}</tr>${body}</table>`;
    }
    return `${close}<h2>🤝 Diplomacy</h2>
        ${known.length ? `<table class="grid"><tr><th>Village</th><th>With you</th><th>Opinion</th><th>Values</th><th></th></tr>${rows}</table>` : '<p>You have not met anyone yet.</p>'}
        ${matrix}`;
};

const agendaHtml = (sim: Sim, draft: AgendaId[]): string => {
    const cards = (Object.keys(AGENDAS) as AgendaId[])
        .map(
            (a) => `<div class="agenda-card ${draft.includes(a) ? 'on' : ''}" data-action="agenda-toggle" data-agenda="${a}">
                <b>${AGENDAS[a].name}</b><div class="muted">${esc(AGENDAS[a].description)}</div></div>`
        )
        .join('');
    const saved = sim.state.kingdom.agenda;
    sim.state.kingdom.agenda = draft;
    const reactions = sim.state.villages
        .filter((v) => v.faction === KINGDOM && v.stage === 'village')
        .map((v) => {
            const a = agendaAlignment(sim, v);
            return `<tr><td>${esc(v.name)}</td><td style="width:160px">${bar((a + 1) * 50, a > 0.15 ? '#5fd35a' : a < -0.15 ? '#e0463c' : '#e8c547', a > 0.15 ? 'Pleased' : a < -0.15 ? 'Upset' : 'Indifferent')}</td></tr>`;
        })
        .join('');
    sim.state.kingdom.agenda = saved;
    return `${close}<h2>📜 Your Agenda</h2>
        <p>Pick up to ${MAX_AGENDA} goals for your kingdom. Villagers whose values match will love you; others will grow resentful —
        and a village that disagrees with you for too long may exile you.</p>
        <div class="row wrap">${cards}</div>
        ${reactions ? `<h4>How your villages would react</h4><table class="grid">${reactions}</table>` : ''}
        <div class="modal-actions"><button class="btn" data-action="agenda-save">Proclaim this agenda</button></div>`;
};

const logHtml = (sim: Sim): string => {
    const items = sim.state.log
        .slice()
        .reverse()
        .map((l) => `<div class="${l.tone}"><span class="muted">Day ${Math.floor(l.t / 60) + 1}</span> — ${esc(l.text)}</div>`)
        .join('');
    return `${close}<h2>📖 Chronicle</h2><div class="log-list">${items}</div>`;
};

const menuHtml = (sim: Sim): string => {
    const slots = [1, 2, 3]
        .map((s) => {
            const info = slotInfo(s);
            return `<tr><td><b>Slot ${s}</b><br><span class="muted">${info ? `Day ${info.day}, ${info.villages} villages — ${esc(info.savedAt)}` : 'Empty'}</span></td>
                <td><div class="row wrap">
                    <button class="btn small" data-action="save" data-slot="${s}">Save</button>
                    <button class="btn small ${info ? '' : 'disabled'}" data-action="load" data-slot="${s}">Load</button>
                    <button class="btn small ${info ? '' : 'disabled'}" data-action="download" data-slot="${s}" title="Download this save to open it on another computer">Download</button>
                </div></td></tr>`;
        })
        .join('');
    const st = sim.state.settings;
    return `${close}<h2>⚙ Menu</h2>
        <h4>Save & load</h4><table class="grid">${slots}</table>
        <div class="row wrap" style="margin-top:8px">
            <button class="btn small" data-action="download-current" title="Download the game you are playing right now">Download this game</button>
            <label class="btn small" title="Open a save file from this or another computer">Open a save file
                <input id="import-save" type="file" accept=".json,application/json" hidden>
            </label>
        </div>
        <div class="muted">Download a save, then use Open a save file on another computer to keep playing it.</div>
        <h4>New world</h4>
        <div class="row"><span>Seed</span><input id="seed-input" type="number" value="${sim.state.seed}" style="width:120px">
        <button class="btn small" data-action="new-game">Start</button><button class="btn small" data-action="new-random">Random world</button></div>
        <div class="muted">This world's seed is <b>${sim.state.seed}</b> — write it down to play the same map again.</div>
        <h4>Settings</h4>
        <label class="row interactive"><input type="checkbox" id="opt-sightfog" ${st.sightFog ? 'checked' : ''}> Fog of sight: hide enemies you can't currently see</label>
        <label class="row interactive"><input type="checkbox" id="opt-pausepopup" ${st.pauseOnPopup ? 'checked' : ''}> Pause the world when a message pops up</label>
        <label class="row interactive">Music <input type="range" id="opt-music" min="0" max="1" step="0.05" value="${st.musicVolume}"></label>
        <label class="row interactive">Sounds <input type="range" id="opt-sfx" min="0" max="1" step="0.05" value="${st.sfxVolume}"></label>
        <div class="modal-actions"><button class="btn" data-action="open-screen" data-screen="help">How to play</button></div>`;
};

const helpHtml = (): string => `${close}<h2>How to play Fogbound Kingdoms</h2>
    <p>You are an explorer in a world hidden by fog. Find the people living in small camps, invite them into your kingdom,
    and help them grow into prosperous villages. But villagers have minds of their own…</p>
    <table class="grid help-keys">
        <tr><td>Left click / drag</td><td>Select a unit or building / box-select your units</td></tr>
        <tr><td>Right click</td><td>Move, attack, gather, build, or talk (depends on what you click)</td></tr>
        <tr><td>Ctrl + right click</td><td>March and attack anything on the way</td></tr>
        <tr><td>Double click</td><td>Select all units of that type on screen</td></tr>
        <tr><td>WASD / arrows / screen edge</td><td>Move the camera</td></tr>
        <tr><td>Right or middle drag</td><td>Drag the map</td></tr>
        <tr><td>Mouse wheel</td><td>Zoom</td></tr>
        <tr><td>F</td><td>Camera follows your explorer</td></tr>
        <tr><td>Space / H</td><td>Jump to / select your explorer</td></tr>
        <tr><td>Shift</td><td>Add to selection, or keep placing buildings</td></tr>
        <tr><td>Esc</td><td>Cancel / deselect</td></tr>
    </table>
    <h4>The big ideas</h4>
    <ul>
        <li><b>Presence:</b> you directly control villages near your explorer. Far villages get orders by messenger, and their leader may refuse.</li>
        <li><b>Leaders:</b> when you leave a village, someone rules in your place. Their personality decides what they build.</li>
        <li><b>Votes:</b> at ${VOTE_THRESHOLD} people, villagers vote on decisions. You have the final say. Each choice shows the unrest and loyalty it will change before you pick.</li>
        <li><b>Unrest:</b> the village panel lists what is pushing it. At ${UNREST_HIGH}% a rebellion clock starts and runs for ${clockText(REBELLION_AFTER)}. Drop unrest below ${UNREST_HIGH}% and the clock stops. If it runs out, the village rebels.</li>
        <li><b>Exile:</b> return to a village that disagrees with you (your agenda, broken promises, ignored votes, expensive projects) and they may throw you out.
        Rally allies, build an army and capture their Town Center to take it back.</li>
        <li><b>Needs:</b> each village's land shapes its needs — snowy villages crave food and warmth, forest villages want walls, desert villages need water.</li>
        <li><b>Soldiers</b> cost food. Warriors beat Archers, Lancers beat Warriors, Archers beat Lancers. Militia are cheap; Monks heal and convert.</li>
        <li><b>Death is permanent</b> for everyone except your explorer, who returns at the last friendly village he visited.</li>
    </ul>`;

export const needName = (n: NeedId) => cap(NEED_LABELS[n]);
