import './ui.css';
import { TILE } from '../data/balance';
import type { Controller } from '../game/controller';
import type { WorldScene } from '../scenes/WorldScene';
import type { SoundManager } from '../audio/sound';
import { randomSeed } from '../sim/rng';
import { loadFromSlot, saveToSlot } from '../sim/save';
import { MAX_AGENDA } from '../data/techs';
import { cancelQueued } from '../sim/buildings';
import {
    createTradeRoute,
    declareWar,
    demolish,
    merchantDeal,
    playerAppoint,
    playerResearch,
    playerTrain,
    playerVote,
    sendMessenger,
    setAgenda,
    setFocus,
    setStance,
    stopUnits,
    talkAction
} from '../sim/commands';
import type { AgendaId, BuildingKind, MessengerOrder, NeedId, ResourceType, Stance, TechId, UnitKind } from '../sim/types';
import { cursorCss, denyCursorCss, esc, handCursorCss, icon, installNineSlices, setHtml } from './dom';
import { Minimap } from './minimap';
import { isLive, renderModal, type ModalView } from './modals';
import { panelVillage, renderSelection, renderTopbar, renderVillage, type PanelState } from './panels';

type Handler = (el: HTMLElement) => void;

export class GameUI {
    private root: HTMLElement;
    private els: Record<'topbar' | 'feed' | 'selection' | 'village' | 'modalLayer' | 'modal' | 'toast' | 'hint' | 'pauseMark', HTMLElement>;
    private minimap: Minimap;
    private cache = new Map<string, string>();
    private timer = 0;
    private modalTimer = 0;
    private modal: ModalView | null = null;
    private toastTimer: number | undefined;
    private state: PanelState = { buildTab: 'economy', villagePanelId: null, villagePanelClosed: false };
    private handlers: Record<string, Handler>;
    private seenLog = 0;
    /** True while the selection panel is being replaced, so a name field blur does not save a half-typed name. */
    private rewritingSelection = false;
    /** The saved hero name when the name field was focused, so Escape can revert. */
    private nameBeforeEdit: string | null = null;
    /** While false, a selection redraw leaves the name field unfocused (the player clicked away). */
    private keepHeroFocus = true;

    constructor(private readonly c: Controller, private readonly scene: WorldScene, private readonly sound: SoundManager) {
        void installNineSlices();
        const rootStyle = document.documentElement.style;
        rootStyle.setProperty('--cursor-hand', handCursorCss());
        rootStyle.setProperty('--cursor-deny', denyCursorCss());
        document.body.style.cursor = cursorCss();
        this.root = document.getElementById('ui') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'ui' }));
        this.root.innerHTML = `
            <div id="topbar" class="wood interactive"></div>
            <div id="menu-buttons">
                <button class="btn" data-action="open-screen" data-screen="kingdom" title="Your villages">👑 Kingdom</button>
                <button class="btn" data-action="open-screen" data-screen="diplomacy" title="Relations with other villages">🤝 Diplomacy</button>
                <button class="btn" data-action="open-screen" data-screen="agenda" title="Your goals for the kingdom">📜 Agenda</button>
                <button class="btn" data-action="open-screen" data-screen="log" title="Everything that has happened">📖</button>
                <button class="btn" data-action="open-screen" data-screen="menu" title="Save, load, settings">${icon('gear')}</button>
                <button class="btn" data-action="open-screen" data-screen="help" title="How to play">${icon('info')}</button>
            </div>
            <div id="feed"></div>
            <div id="toast"></div>
            <div id="hint"></div>
            <div id="pause-mark" title="The world is paused">
                <svg class="pause-glyph" viewBox="0 0 16 16" width="26" height="26" aria-hidden="true">
                    <g fill="#3b2a1e"><rect x="1" y="1" width="6" height="14"/><rect x="9" y="1" width="6" height="14"/></g>
                    <g fill="#ffd34d"><rect x="2" y="2" width="4" height="12"/><rect x="10" y="2" width="4" height="12"/></g>
                    <g fill="#fff4c4"><rect x="2" y="2" width="4" height="2"/><rect x="10" y="2" width="4" height="2"/></g>
                </svg>
            </div>
            <div id="minimap-wrap" class="wood interactive"><canvas id="minimap"></canvas></div>
            <div id="selection" class="console interactive"></div>
            <div id="village" class="scroll interactive"></div>
            <div id="modal-layer"><div id="modal" class="modal paper"></div></div>`;
        const q = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`)!;
        this.els = {
            topbar: q('topbar'),
            feed: q('feed'),
            selection: q('selection'),
            village: q('village'),
            modalLayer: q('modal-layer'),
            modal: q('modal'),
            toast: q('toast'),
            hint: q('hint'),
            pauseMark: q('pause-mark')
        };
        this.minimap = new Minimap(this.root.querySelector('#minimap')!, c, () => {
            const v = this.scene.cameras.main.worldView;
            return { x: v.x / TILE, y: v.y / TILE, w: v.width / TILE, h: v.height / TILE };
        });
        this.handlers = this.buildHandlers();
        this.root.addEventListener('pointerdown', (e) => this.onPointer(e));
        this.root.addEventListener('change', (e) => this.onChange(e));
        window.addEventListener(
            'pointerdown',
            (e) => {
                const input = document.getElementById('hero-name') as HTMLInputElement | null;
                if (!input || e.target === input) return;
                this.keepHeroFocus = false;
                this.finishHeroName(input.value);
            },
            true
        );
        this.root.addEventListener('focusin', (e) => {
            if ((e.target as HTMLElement).id !== 'hero-name') return;
            this.keepHeroFocus = true;
            this.nameBeforeEdit = this.c.sim.state.kingdom.heroName;
            this.scene.input.keyboard?.disableGlobalCapture();
        });
        this.root.addEventListener('focusout', (e) => {
            const input = e.target as HTMLInputElement;
            if (input.id !== 'hero-name' || this.rewritingSelection) return;
            this.scene.input.keyboard?.enableGlobalCapture();
            this.finishHeroName(input.value);
        });
        this.root.addEventListener('keydown', (e) => {
            const input = e.target as HTMLInputElement;
            if (input.id !== 'hero-name') return;
            if (e.key === 'Enter') {
                e.preventDefault();
                this.finishHeroName(input.value);
                input.blur();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                const prev = this.nameBeforeEdit ?? '';
                this.c.sim.state.kingdom.heroName = prev;
                this.nameBeforeEdit = prev;
                input.value = this.c.sim.heroName();
                input.blur();
            }
        });
        this.els.modalLayer.addEventListener('pointerdown', (e) => {
            if (e.target === this.els.modalLayer && this.modal?.kind !== 'request') this.closeModal();
        });
        c.addEventListener('toast', (e) => {
            const { text, tone } = (e as CustomEvent).detail;
            this.toast(text, tone);
        });
        c.addEventListener('selection', () => this.refresh(true));
        c.addEventListener('sim-changed', () => {
            this.seenLog = this.c.sim.state.log.length;
            this.closeModal();
            this.refresh(true);
        });
        window.addEventListener(
            'pointerdown',
            () => {
                this.sound.sfxVolume = this.c.sim.state.settings.sfxVolume;
                this.sound.setMusicVolume(this.c.sim.state.settings.musicVolume);
            },
            { once: true }
        );
        this.seenLog = 0;
    }

    /** True while a message popup has stopped the simulation. */
    simPaused(): boolean {
        return this.modal?.kind === 'request' && this.c.sim.state.settings.pauseOnPopup;
    }

    update(dt: number) {
        this.timer -= dt;
        this.modalTimer -= dt;
        if (this.timer <= 0) {
            this.timer = 0.25;
            this.refresh(false);
            this.minimap.draw();
        }
        this.pumpRequests();
        if (this.modal && this.modalTimer <= 0 && isLive(this.modal)) {
            this.modalTimer = 0.5;
            this.renderModal();
        }
    }

    // ---------- rendering ----------

    private set(el: HTMLElement, key: string, html: string) {
        if (this.cache.get(key) === html) return;
        const heroEdit = key === 'selection' && this.keepHeroFocus ? this.heroNameEdit() : null;
        this.cache.set(key, html);
        this.rewritingSelection = key === 'selection';
        // The log feed is replaced whole so a new line can play its slide-in. Everything else is patched
        // so portrait images stay put while stats and orders change.
        if (key === 'feed') el.innerHTML = html;
        else setHtml(el, html);
        this.rewritingSelection = false;
        if (heroEdit) this.restoreHeroNameEdit(heroEdit);
    }

    private heroNameEdit(): { value: string; start: number; end: number } | null {
        const input = document.activeElement;
        if (!(input instanceof HTMLInputElement) || input.id !== 'hero-name') return null;
        return {
            value: input.value,
            start: input.selectionStart ?? input.value.length,
            end: input.selectionEnd ?? input.value.length
        };
    }

    private restoreHeroNameEdit(edit: { value: string; start: number; end: number }) {
        const input = this.els.selection.querySelector<HTMLInputElement>('#hero-name');
        if (!input) return;
        input.value = edit.value;
        input.focus();
        input.setSelectionRange(edit.start, edit.end);
    }

    private finishHeroName(raw: string) {
        const cleaned = raw.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
        const name = cleaned.toLowerCase() === 'explorer' ? '' : cleaned;
        const before = this.nameBeforeEdit ?? this.c.sim.state.kingdom.heroName;
        this.c.sim.state.kingdom.heroName = name;
        this.nameBeforeEdit = name;
        if (name === before) return;
        this.toast(name ? `Your hero is now ${name}.` : 'Your hero is called Explorer again.', 'good');
        this.refresh(true);
    }

    private refresh(force: boolean) {
        if (force) this.cache.clear();
        const sim = this.c.sim;
        this.set(this.els.topbar, 'topbar', renderTopbar(sim));
        const sel = renderSelection(sim, this.c, this.state);
        this.els.selection.classList.toggle('open', sel !== '');
        this.set(this.els.selection, 'selection', sel);
        const v = panelVillage(sim, this.state);
        this.els.village.classList.toggle('open', !!v);
        this.set(this.els.village, 'village', v ? renderVillage(sim, v) : '');
        this.renderFeed();
        this.set(this.els.hint, 'hint', this.hintText());
    }

    private hintText(): string {
        const sim = this.c.sim;
        if (this.c.placing) return 'Click the map to place. Right-click or Esc to cancel.';
        const hasVillage = sim.state.villages.some((v) => v.faction === 'kingdom');
        if (!hasVillage && sim.state.time < 600) return 'Tip: select your explorer (H) and right-click to walk. Find a camp in the fog and right-click its people to talk.';
        return '';
    }

    private renderFeed() {
        const sim = this.c.sim;
        const now = sim.state.time;
        const recent = sim.state.log.filter((l) => now - l.t < 14).slice(-6);
        const html = recent
            .map((l) => {
                const i = sim.state.log.indexOf(l);
                return `<div class="feed-item ${l.tone} ${now - l.t > 10 ? 'fading' : ''}" data-action="log-goto" data-index="${i}">${esc(l.text)}</div>`;
            })
            .join('');
        this.set(this.els.feed, 'feed', html);
        const newest = sim.state.log.length;
        if (newest > this.seenLog) {
            const fresh = sim.state.log.slice(this.seenLog);
            if (fresh.some((l) => l.tone === 'bad')) this.sound.play('error');
            this.seenLog = newest;
        }
    }

    private pumpRequests() {
        const reqs = this.c.sim.state.requests;
        if (this.modal || !reqs.length) return;
        const req = reqs.shift()!;
        if (req.type === 'vote') {
            const v = this.c.sim.village(req.villageId);
            if (!v?.proposal || v.proposal.resolved || !v.playerPresent) return;
        }
        this.openModal({ kind: 'request', req });
    }

    private openModal(m: ModalView) {
        this.modal = m;
        this.els.modalLayer.classList.add('open');
        this.renderModal();
        this.syncPauseMark();
        this.sound.play('click');
    }

    private renderModal() {
        if (!this.modal) return;
        const { html, cls } = renderModal(this.c.sim, this.modal);
        this.els.modal.className = `modal ${cls}`;
        this.set(this.els.modal, 'modal', html);
    }

    private closeModal() {
        this.modal = null;
        this.cache.delete('modal');
        this.els.modalLayer.classList.remove('open');
        this.els.modal.innerHTML = '';
        this.syncPauseMark();
    }

    private syncPauseMark() {
        this.els.pauseMark.classList.toggle('show', this.simPaused());
    }

    toast(text: string, tone: string = 'info') {
        const t = this.els.toast;
        t.textContent = text;
        t.className = `show ${tone}`;
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => (t.className = ''), 2600);
    }

    // ---------- actions ----------

    private onPointer(e: PointerEvent) {
        if (e.button !== 0) return;
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
        if (!el || el.classList.contains('disabled')) return;
        const handler = this.handlers[el.dataset.action!];
        if (!handler) return;
        e.preventDefault();
        handler(el);
        this.refresh(true);
        if (this.modal && isLive(this.modal)) this.renderModal();
    }

    private onChange(e: Event) {
        const t = e.target as HTMLInputElement;
        const st = this.c.sim.state.settings;
        switch (t.id) {
            case 'opt-sightfog':
                st.sightFog = t.checked;
                break;
            case 'opt-music':
                st.musicVolume = Number(t.value);
                this.sound.setMusicVolume(st.musicVolume);
                break;
            case 'opt-sfx':
                st.sfxVolume = Number(t.value);
                this.sound.sfxVolume = st.sfxVolume;
                break;
            case 'opt-pausepopup':
                st.pauseOnPopup = t.checked;
                this.syncPauseMark();
                break;
            default:
                break;
        }
    }

    private report(err: string | null) {
        if (err) {
            this.toast(err, 'bad');
            this.sound.play('error');
        }
    }

    private buildHandlers(): Record<string, Handler> {
        const sim = () => this.c.sim;
        const num = (el: HTMLElement, key: string) => Number(el.dataset[key]);
        return {
            'close-modal': () => this.closeModal(),
            'open-screen': (el) => {
                const screen = el.dataset.screen!;
                switch (screen) {
                    case 'kingdom':
                    case 'diplomacy':
                    case 'log':
                    case 'menu':
                    case 'help':
                        this.openModal({ kind: screen });
                        break;
                    case 'agenda':
                        this.openModal({ kind: 'agenda', draft: [...sim().state.kingdom.agenda] });
                        break;
                    default:
                        break;
                }
            },
            stance: (el) => setStance(this.c.commandableSelection(), el.dataset.stance as Stance),
            stop: () => stopUnits(sim(), this.c.commandableSelection()),
            'build-tab': (el) => (this.state.buildTab = el.dataset.tab as PanelState['buildTab']),
            place: (el) => {
                this.c.startPlacing(el.dataset.kind as BuildingKind);
                this.sound.play('click');
            },
            'select-kind': (el) => {
                const kind = el.dataset.kind as UnitKind;
                this.c.selectUnits(this.c.selectedUnitList().filter((u) => u.kind === kind).map((u) => u.id));
            },
            'select-unit': (el) => {
                const u = sim().unitById.get(num(el, 'id'));
                if (u) {
                    this.c.selectUnits([u.id]);
                    this.c.focusCamera(u.x, u.y);
                }
            },
            train: (el) => {
                const b = sim().buildingById.get(num(el, 'id'));
                if (b) this.report(playerTrain(sim(), b, el.dataset.unit as UnitKind));
            },
            'cancel-train': (el) => {
                const b = sim().buildingById.get(num(el, 'id'));
                if (b) cancelQueued(sim(), b, num(el, 'index'));
            },
            research: (el) => {
                const b = sim().buildingById.get(num(el, 'id'));
                if (b) this.report(playerResearch(sim(), b, el.dataset.tech as TechId));
            },
            demolish: (el) => {
                const b = sim().buildingById.get(num(el, 'id'));
                if (b) {
                    demolish(sim(), b);
                    this.c.selectBuilding(null);
                }
            },
            'open-village': (el) => {
                this.state.villagePanelId = num(el, 'id');
                this.state.villagePanelClosed = false;
                if (this.modal && this.modal.kind !== 'request') this.closeModal();
            },
            'close-village': () => {
                this.state.villagePanelId = null;
                this.state.villagePanelClosed = true;
            },
            focus: (el) => {
                const v = sim().village(num(el, 'id'));
                if (v) setFocus(v, (el.dataset.res || null) as ResourceType | null);
            },
            trade: (el) => this.report(createTradeRoute(sim(), num(el, 'from'), num(el, 'to'))),
            vote: (el) => {
                playerVote(sim(), num(el, 'id'), el.dataset.approve === '1');
                if (this.modal?.kind === 'request' && this.modal.req.type === 'vote') this.closeModal();
            },
            'appoint-open': (el) => {
                this.closeModal();
                this.openModal({ kind: 'appoint', villageId: num(el, 'id') });
            },
            appoint: (el) => {
                playerAppoint(sim(), num(el, 'id'), num(el, 'unit'));
                this.closeModal();
            },
            messenger: (el) => {
                this.closeModal();
                this.openModal({ kind: 'messenger', villageId: num(el, 'id') });
            },
            send: (el) => {
                const id = num(el, 'id');
                const d = el.dataset;
                let msg: MessengerOrder;
                switch (d.msg) {
                    case 'build':
                        msg = { type: 'build', building: d.kind as BuildingKind };
                        break;
                    case 'train':
                        msg = { type: 'train', unit: d.unit as UnitKind, count: 3 };
                        break;
                    case 'focus':
                        msg = { type: 'focus', resource: d.res as ResourceType };
                        break;
                    case 'gift':
                        msg = { type: 'gift', resource: d.res as ResourceType, amount: Number(d.amount) };
                        break;
                    case 'sendTroops':
                    case 'alliance':
                    case 'peace':
                    case 'invite':
                        msg = { type: d.msg };
                        break;
                    default:
                        return;
                }
                const err = sendMessenger(sim(), id, msg);
                this.report(err);
                if (!err) this.closeModal();
            },
            'talk-to': (el) => {
                const v = sim().village(num(el, 'id'));
                const e = sim().explorer();
                if (v && e) {
                    e.order = { type: 'talk', villageId: v.id };
                    this.toast(`${sim().heroName()} heads to ${v.name} to talk.`);
                }
            },
            talk: (el) => {
                const id = num(el, 'id');
                const d = el.dataset;
                let err: string | null;
                if (d.do === 'join') err = talkAction(sim(), id, { type: 'join', promise: (d.promise || null) as NeedId | null });
                else if (d.do === 'gift') err = talkAction(sim(), id, { type: 'gift', resource: d.res as ResourceType, amount: Number(d.amount) });
                else err = talkAction(sim(), id, { type: d.do as 'alliance' | 'peace' | 'invite' | 'sendTroops' });
                this.report(err);
                const v = sim().village(id);
                if (d.do === 'join' && v?.faction === 'kingdom') {
                    this.closeModal();
                    this.state.villagePanelId = null;
                    this.state.villagePanelClosed = false;
                }
            },
            'declare-war': (el) => {
                declareWar(sim(), num(el, 'id'));
                this.closeModal();
            },
            merchant: (el) => this.report(merchantDeal(sim(), num(el, 'id'), num(el, 'index'))),
            goto: (el) => {
                this.c.follow = false;
                this.c.focusCamera(num(el, 'x'), num(el, 'y'));
                if (this.modal && this.modal.kind !== 'request') this.closeModal();
            },
            'log-goto': (el) => {
                const l = sim().state.log[num(el, 'index')];
                if (l?.x !== undefined && l.y !== undefined) this.c.focusCamera(l.x, l.y);
            },
            'agenda-toggle': (el) => {
                if (this.modal?.kind !== 'agenda') return;
                const a = el.dataset.agenda as AgendaId;
                const draft = this.modal.draft;
                const i = draft.indexOf(a);
                if (i >= 0) draft.splice(i, 1);
                else if (draft.length < MAX_AGENDA) draft.push(a);
                else this.toast(`You can only pursue ${MAX_AGENDA} goals at once.`, 'bad');
            },
            'agenda-save': () => {
                if (this.modal?.kind !== 'agenda') return;
                setAgenda(sim(), this.modal.draft);
                this.c.sim.log(`You proclaimed a new agenda for the kingdom.`, 'politics');
                this.closeModal();
            },
            save: (el) => {
                saveToSlot(sim(), num(el, 'slot'));
                this.toast(`Saved to slot ${el.dataset.slot}.`, 'good');
                this.renderModalForce();
            },
            load: (el) => {
                const loaded = loadFromSlot(num(el, 'slot'));
                if (loaded) {
                    this.c.setSim(loaded);
                    this.toast('Game loaded.', 'good');
                }
            },
            'new-game': () => {
                const input = this.root.querySelector<HTMLInputElement>('#seed-input');
                this.scene.startNewGame(Number(input?.value) || randomSeed());
            },
            'new-random': () => this.scene.startNewGame(randomSeed())
        };
    }

    private renderModalForce() {
        this.cache.delete('modal');
        this.renderModal();
    }
}
