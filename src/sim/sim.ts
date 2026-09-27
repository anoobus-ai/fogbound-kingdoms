import { BUILDINGS } from '../data/buildings';
import { DAY_SECONDS, DAYS_PER_SEASON, NIGHT_END, NIGHT_START } from '../data/balance';
import { TECHS } from '../data/techs';
import { UNITS } from '../data/units';
import { idx, inBounds } from './map';
import { Pathfinder } from './pathfinding';
import { Rng } from './rng';
import { pairKey, type GameState } from './state';
import {
    BANDIT,
    Ground,
    KINGDOM,
    WILD,
    type Building,
    type BuildingKind,
    type DiplomacyStatus,
    type FactionId,
    type FxEvent,
    type LogEntry,
    type Person,
    type ResourceNode,
    type Stock,
    type TechId,
    type UiRequest,
    type Unit,
    type UnitKind,
    type Village
} from './types';
import { updateUnits } from './units';
import { updateBuildings } from './buildings';
import { updateVillages } from './villages';
import { updatePolitics } from './politics';
import { updateDiplomacy } from './diplomacy';
import { updateWorld } from './world';
import { updateFog } from './fog';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

type UiRequestInput = UiRequest extends infer R ? (R extends UiRequest ? Omit<R, 'id'> : never) : never;

const SOLID = 1;
const GATE = 2;

/** Buckets units by area so "who is near me" questions are fast. */
class SpatialHash {
    private cells = new Map<number, Unit[]>();
    constructor(private readonly size: number) {}
    clear() {
        this.cells.clear();
    }
    insert(u: Unit) {
        const k = this.key(Math.floor(u.x / this.size), Math.floor(u.y / this.size));
        const list = this.cells.get(k);
        if (list) list.push(u);
        else this.cells.set(k, [u]);
    }
    query(x: number, y: number, r: number, out: Unit[] = []): Unit[] {
        const x0 = Math.floor((x - r) / this.size);
        const x1 = Math.floor((x + r) / this.size);
        const y0 = Math.floor((y - r) / this.size);
        const y1 = Math.floor((y + r) / this.size);
        const r2 = r * r;
        for (let cy = y0; cy <= y1; cy++) {
            for (let cx = x0; cx <= x1; cx++) {
                const list = this.cells.get(this.key(cx, cy));
                if (!list) continue;
                for (const u of list) {
                    const dx = u.x - x;
                    const dy = u.y - y;
                    if (dx * dx + dy * dy <= r2) out.push(u);
                }
            }
        }
        return out;
    }
    private key(cx: number, cy: number) {
        return (cy + 1000) * 4096 + (cx + 1000);
    }
}

export class Sim {
    readonly rng: Rng;
    readonly pathfinder: Pathfinder;
    readonly unitById = new Map<number, Unit>();
    readonly buildingById = new Map<number, Building>();
    readonly resourceById = new Map<number, ResourceNode>();
    readonly villageById = new Map<number, Village>();
    readonly spatial = new SpatialHash(4);
    /** How many of the player's eyes see each tile right now. */
    readonly visible: Uint16Array;
    /** 0 = walkable, 1 = blocked, 2 = gate. */
    readonly solid: Uint8Array;
    readonly gateFaction = new Map<number, FactionId>();
    /** Next time each unit looks around for enemies (not saved; just spreads the work out). */
    readonly scanAt = new Map<number, number>();
    fx: FxEvent[] = [];
    private fogTimer = 0;
    /** Bumped when buildings or resources appear/disappear so the renderer can refresh. */
    entityVersion = 0;

    constructor(readonly state: GameState) {
        this.rng = new Rng(state.rngState);
        this.pathfinder = new Pathfinder(state.map.w, state.map.h);
        this.visible = new Uint16Array(state.map.w * state.map.h);
        this.solid = new Uint8Array(state.map.w * state.map.h);
        for (const u of state.units) this.unitById.set(u.id, u);
        for (const b of state.buildings) this.buildingById.set(b.id, b);
        for (const r of state.resources) this.resourceById.set(r.id, r);
        for (const v of state.villages) this.villageById.set(v.id, v);
        this.rebuildSolid();
        updateFog(this);
    }

    update(dt: number) {
        const s = this.state;
        s.time += dt;
        this.spatial.clear();
        for (const u of s.units) this.spatial.insert(u);

        updateUnits(this, dt);
        updateBuildings(this, dt);
        updateVillages(this, dt);
        updatePolitics(this);
        updateDiplomacy(this);
        updateWorld(this, dt);

        this.fogTimer -= dt;
        if (this.fogTimer <= 0) {
            this.fogTimer = 0.2;
            updateFog(this);
        }
        this.state.rngState = this.rng.state;
        if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
    }

    // ---------- time ----------

    get day(): number {
        return Math.floor(this.state.time / DAY_SECONDS) + 1;
    }
    get timeOfDay(): number {
        return (this.state.time / DAY_SECONDS) % 1;
    }
    get isNight(): boolean {
        const t = this.timeOfDay;
        return t > NIGHT_START || t < NIGHT_END;
    }
    get season(): Season {
        return SEASONS[Math.floor((this.day - 1) / DAYS_PER_SEASON) % 4];
    }

    // ---------- ids & lookups ----------

    nextId(): number {
        return this.state.nextId++;
    }

    explorer(): Unit | undefined {
        return this.unitById.get(this.state.kingdom.explorerId);
    }

    village(id: number | null | undefined): Village | undefined {
        return id == null ? undefined : this.villageById.get(id);
    }

    hasTech(t: TechId): boolean {
        return this.state.kingdom.techs.includes(t);
    }

    // ---------- factions ----------

    status(a: FactionId, b: FactionId): DiplomacyStatus {
        if (a === b) return 'allied';
        return this.state.diplomacy.status[pairKey(a, b)] ?? 'neutral';
    }

    hostileFactions(a: FactionId, b: FactionId): boolean {
        if (a === b) return false;
        if (a === BANDIT || b === BANDIT) return true;
        if (a === WILD || b === WILD) return true;
        return this.status(a, b) === 'war';
    }

    friendlyFactions(a: FactionId, b: FactionId): boolean {
        return a === b || this.status(a, b) === 'allied';
    }

    /** Would `u` fight `other` on its own (without being ordered)? */
    wantsToFight(u: Unit, other: Unit): boolean {
        if (other.kind === 'sheep' || u.kind === 'sheep') return false;
        if (u.faction === WILD && other.faction === WILD) return false;
        if (u.faction === WILD && u.kind === 'bear' && u.lastAttackerId !== other.id) {
            return Math.hypot(u.x - other.x, u.y - other.y) < 2.5;
        }
        return this.hostileFactions(u.faction, other.faction);
    }

    // ---------- passability ----------

    rebuildSolid() {
        const { map } = this.state;
        this.solid.fill(0);
        this.gateFaction.clear();
        for (let i = 0; i < map.w * map.h; i++) {
            if (map.ground[i] === Ground.Water || map.elev[i] || map.cliff[i]) this.solid[i] = SOLID;
        }
        for (const r of this.state.resources) {
            if (r.kind !== 'carcass') this.solid[idx(map, r.x, r.y)] = SOLID;
        }
        for (const b of this.state.buildings) this.markBuildingSolid(b, true);
    }

    private markBuildingSolid(b: Building, on: boolean) {
        const def = BUILDINGS[b.kind];
        if (!def.blocksMovement) return;
        const { map } = this.state;
        for (let y = b.y; y < b.y + b.h; y++) {
            for (let x = b.x; x < b.x + b.w; x++) {
                if (!inBounds(map, x, y)) continue;
                const i = idx(map, x, y);
                if (on) {
                    this.solid[i] = b.kind === 'gate' ? GATE : SOLID;
                    if (b.kind === 'gate') this.gateFaction.set(i, b.faction);
                } else {
                    const t = map.ground[i] === Ground.Water || map.elev[i] || map.cliff[i];
                    this.solid[i] = t ? SOLID : 0;
                    this.gateFaction.delete(i);
                }
            }
        }
    }

    passableFor(faction: FactionId): (x: number, y: number) => boolean {
        const { w, h } = this.state.map;
        return (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return false;
            const i = y * w + x;
            const s = this.solid[i];
            if (s === 0) return true;
            if (s === GATE) return this.friendlyFactions(faction, this.gateFaction.get(i) ?? '');
            return false;
        };
    }

    isSolidAt(x: number, y: number): boolean {
        const { map } = this.state;
        if (!inBounds(map, x, y)) return true;
        return this.solid[idx(map, x, y)] === SOLID;
    }

    // ---------- entities ----------

    spawnUnit(kind: UnitKind, faction: FactionId, villageId: number | null, x: number, y: number, person: Person | null = null): Unit {
        const u: Unit = {
            id: this.nextId(),
            kind,
            faction,
            villageId,
            x,
            y,
            hp: this.maxHp(kind, faction),
            stance: kind === 'explorer' ? 'aggressive' : 'passive',
            order: { type: 'idle' },
            path: [],
            pathTarget: '',
            repathAt: 0,
            cooldown: 0,
            carry: null,
            person,
            facing: 1,
            anim: 'idle',
            animUntil: 0,
            lastAttackerId: null,
            lastHurtAt: -999,
            engageId: null,
            idleSince: this.state.time,
            homeX: x,
            homeY: y,
            cargo: null,
            convertCooldownUntil: 0
        };
        if (UNITS[kind].unitClass === 'bandit' || kind === 'wolf') u.stance = 'aggressive';
        this.state.units.push(u);
        this.unitById.set(u.id, u);
        return u;
    }

    maxHp(kind: UnitKind, _faction?: FactionId): number {
        return UNITS[kind].hp;
    }

    armorOf(u: Unit): number {
        let a = UNITS[u.kind].armor;
        if (u.faction === KINGDOM && this.hasTech('ironArmor') && UNITS[u.kind].unitClass === 'soldier') a += 2;
        return a;
    }

    buildingMaxHp(b: Building): number {
        const base = BUILDINGS[b.kind].hp;
        return b.faction === KINGDOM && this.hasTech('masonry') ? Math.round(base * 1.3) : base;
    }

    removeUnit(u: Unit) {
        const i = this.state.units.indexOf(u);
        if (i >= 0) this.state.units.splice(i, 1);
        this.unitById.delete(u.id);
    }

    addBuilding(kind: BuildingKind, faction: FactionId, villageId: number | null, x: number, y: number, built: boolean): Building {
        const def = BUILDINGS[kind];
        const b: Building = {
            id: this.nextId(),
            kind,
            faction,
            villageId,
            x,
            y,
            w: def.w,
            h: def.h,
            hp: built ? def.hp : Math.max(1, def.hp * 0.1),
            built,
            progress: built ? 1 : 0,
            queue: [],
            research: null,
            cooldown: 0,
            variant: this.rng.int(0, 2),
            orderedByPlayer: false
        };
        this.state.buildings.push(b);
        this.buildingById.set(b.id, b);
        const { map } = this.state;
        for (let ty = y; ty < y + def.h; ty++) {
            for (let tx = x; tx < x + def.w; tx++) {
                if (inBounds(map, tx, ty)) map.block[idx(map, tx, ty)] = b.id;
            }
        }
        this.markBuildingSolid(b, true);
        this.entityVersion++;
        return b;
    }

    removeBuilding(b: Building) {
        const i = this.state.buildings.indexOf(b);
        if (i >= 0) this.state.buildings.splice(i, 1);
        this.buildingById.delete(b.id);
        const { map } = this.state;
        for (let ty = b.y; ty < b.y + b.h; ty++) {
            for (let tx = b.x; tx < b.x + b.w; tx++) {
                if (inBounds(map, tx, ty) && map.block[idx(map, tx, ty)] === b.id) map.block[idx(map, tx, ty)] = 0;
            }
        }
        this.markBuildingSolid(b, false);
        this.entityVersion++;
    }

    addResource(kind: ResourceNode['kind'], x: number, y: number, amount: number, variant = 0, expiresAt: number | null = null): ResourceNode {
        const r: ResourceNode = { id: this.nextId(), kind, x, y, amount, variant, expiresAt };
        this.state.resources.push(r);
        this.resourceById.set(r.id, r);
        const { map } = this.state;
        if (kind !== 'carcass') {
            map.block[idx(map, x, y)] = r.id;
            this.solid[idx(map, x, y)] = SOLID;
        }
        this.entityVersion++;
        return r;
    }

    removeResource(r: ResourceNode) {
        const i = this.state.resources.indexOf(r);
        if (i >= 0) this.state.resources.splice(i, 1);
        this.resourceById.delete(r.id);
        const { map } = this.state;
        if (r.kind !== 'carcass' && map.block[idx(map, r.x, r.y)] === r.id) {
            map.block[idx(map, r.x, r.y)] = 0;
            const t = idx(map, r.x, r.y);
            this.solid[t] = map.ground[t] === Ground.Water || map.elev[t] || map.cliff[t] ? SOLID : 0;
        }
        this.entityVersion++;
    }

    // ---------- economy helpers ----------

    canAfford(stock: Stock, cost: Partial<Stock>): boolean {
        return (Object.keys(cost) as (keyof Stock)[]).every((k) => stock[k] >= (cost[k] ?? 0));
    }

    pay(stock: Stock, cost: Partial<Stock>) {
        for (const k of Object.keys(cost) as (keyof Stock)[]) stock[k] -= cost[k] ?? 0;
    }

    refund(stock: Stock, cost: Partial<Stock>, fraction = 1) {
        for (const k of Object.keys(cost) as (keyof Stock)[]) stock[k] += Math.floor((cost[k] ?? 0) * fraction);
    }

    techCost(t: TechId) {
        return TECHS[t].cost;
    }

    citizens(villageId: number): Unit[] {
        return this.state.units.filter((u) => u.villageId === villageId && u.person !== null);
    }

    villageBuildings(villageId: number): Building[] {
        return this.state.buildings.filter((b) => b.villageId === villageId);
    }

    townCenter(v: Village): Building | undefined {
        return this.state.buildings.find(
            (b) => b.villageId === v.id && (b.kind === 'townCenter' || (v.stage === 'camp' && b.kind === 'campHut'))
        );
    }

    // ---------- messaging ----------

    log(text: string, tone: LogEntry['tone'] = 'info', at?: { x: number; y: number }) {
        this.state.log.push({ t: this.state.time, text, tone, x: at?.x, y: at?.y });
    }

    request(req: UiRequestInput) {
        this.state.requests.push({ ...req, id: this.nextId() } as UiRequest);
    }

    emit(e: FxEvent) {
        this.fx.push(e);
    }
}
