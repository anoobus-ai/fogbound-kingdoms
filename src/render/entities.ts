import Phaser from 'phaser';
import { BUILDINGS } from '../data/buildings';
import { TILE } from '../data/balance';
import { UNIT_ART, unitHit, unitOriginY } from '../data/unitArt';
import { biomeAt, idx } from '../sim/map';
import type { Sim } from '../sim/sim';
import {
    KINGDOM,
    type Building,
    type FactionId,
    type ResourceNode,
    type TeamColor,
    type Unit
} from '../sim/types';
import { autotile, COLS, DEPTH, ROW } from './terrain';

const BAR_DEPTH = DEPTH.fog - 10;
const BAR_H = 9;

const lerpColor = (a: number, b: number, t: number): number => {
    const mix = (from: number, to: number) => Math.round(from + (to - from) * t);
    return (mix((a >> 16) & 255, (b >> 16) & 255) << 16) | (mix((a >> 8) & 255, (b >> 8) & 255) << 8) | mix(a & 255, b & 255);
};

/** Vivid red while healthy, hotter once wounded, flashing brighter when about to die. */
const hpLook = (frac: number, now: number): { color: number; critical: boolean } => {
    if (frac > 0.65) return { color: 0xff1f1f, critical: false };
    if (frac > 0.35) return { color: 0xff5a22, critical: false };
    const pulse = 0.5 + 0.5 * Math.sin(now * (frac < 0.15 ? 0.022 : 0.013));
    return { color: lerpColor(0xff120c, 0xff6a55, pulse), critical: true };
};

interface UnitView {
    sprite: Phaser.GameObjects.Sprite;
    key: string;
}

interface BuildingView {
    container: Phaser.GameObjects.Container;
    flat: Phaser.GameObjects.Image[];
    signature: string;
    fires: Phaser.GameObjects.Sprite[];
}

export interface RenderSelection {
    units: Set<number>;
    building: number | null;
    hover: number | null;
}

export const factionColor = (sim: Sim, faction: FactionId): TeamColor => {
    if (faction === KINGDOM) return 'Blue';
    if (faction.startsWith('v')) return sim.village(Number(faction.slice(1)))?.color ?? 'Red';
    return 'Red';
};

export class EntityRenderer {
    private units = new Map<number, UnitView>();
    private buildings = new Map<number, BuildingView>();
    private resources = new Map<number, Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>();
    private resourceKinds = new Map<number, ResourceNode>();
    private entityVersion = -1;
    private bars: Phaser.GameObjects.Graphics;
    private rings: Phaser.GameObjects.Graphics;
    private camp = new Map<number, Phaser.GameObjects.Sprite>();

    constructor(private readonly scene: Phaser.Scene, private sim: Sim) {
        this.bars = scene.add.graphics().setDepth(BAR_DEPTH + 2);
        this.rings = scene.add.graphics().setDepth(DEPTH.decals + 1);
    }

    setSim(sim: Sim) {
        for (const v of this.units.values()) v.sprite.destroy();
        for (const v of this.buildings.values()) this.destroyBuildingView(v);
        for (const r of this.resources.values()) r.destroy();
        for (const c of this.camp.values()) c.destroy();
        this.units.clear();
        this.buildings.clear();
        this.resources.clear();
        this.resourceKinds.clear();
        this.camp.clear();
        this.sim = sim;
        this.entityVersion = -1;
    }

    update(selection: RenderSelection) {
        const sim = this.sim;
        if (sim.entityVersion !== this.entityVersion) {
            this.entityVersion = sim.entityVersion;
            this.syncResources();
        }
        this.syncBuildings();
        this.syncUnits();
        this.drawOverlays(selection);
    }

    // ---------- visibility ----------

    private explored(x: number, y: number) {
        const { map, explored } = this.sim.state;
        const tx = Math.max(0, Math.min(map.w - 1, Math.floor(x)));
        const ty = Math.max(0, Math.min(map.h - 1, Math.floor(y)));
        return explored[idx(map, tx, ty)] === 1;
    }

    unitShown(u: Unit): boolean {
        if (u.faction === KINGDOM) return true;
        if (!this.explored(u.x, u.y)) return false;
        if (!this.sim.state.settings.sightFog) return true;
        const { map } = this.sim.state;
        return this.sim.visible[idx(map, Math.max(0, Math.min(map.w - 1, Math.floor(u.x))), Math.max(0, Math.min(map.h - 1, Math.floor(u.y))))] > 0;
    }

    private buildingShown(b: Building): boolean {
        return this.explored(b.x + b.w / 2, b.y + b.h / 2) || this.explored(b.x, b.y) || this.explored(b.x + b.w - 1, b.y + b.h - 1);
    }

    // ---------- units ----------

    private unitAnim(u: Unit, color: TeamColor): string {
        const state = u.anim;
        const moving = state === 'run' || state === 'carry';
        const fighting = state === 'attack';
        switch (u.kind) {
            case 'explorer':
                // Gold horned-helmet warrior, unused by the blue kingdom army.
                return `warrior-${fighting ? 'attack' : moving ? 'run' : 'idle'}-Yellow`;
            case 'warrior':
            case 'archer':
            case 'lancer':
                return `${u.kind}-${fighting ? 'attack' : moving ? 'run' : 'idle'}-${color}`;
            case 'monk':
                return `monk-${state === 'heal' || fighting ? 'heal' : moving ? 'run' : 'idle'}-${color}`;
            case 'militia':
                return `pawn-${fighting ? 'knife' : moving ? 'runknife' : 'idleknife'}-${color}`;
            case 'messenger':
                return `pawn-${moving ? 'run' : 'idle'}-${color}`;
            case 'caravan':
                return `pawn-${moving ? 'gold' : 'idle'}-${color}`;
            case 'pawn': {
                if (fighting) return `pawn-knife-${color}`;
                if (state === 'carry' && u.carry) {
                    const k = u.carry.type === 'wood' ? 'wood' : u.carry.type === 'food' ? 'meat' : 'gold';
                    return `pawn-${k}-${color}`;
                }
                if (moving) return `pawn-run-${color}`;
                if (state === 'work') return `pawn-${this.workTool(u)}-${color}`;
                return `pawn-idle-${color}`;
            }
            case 'goblinTorch':
            case 'goblinTnt':
            case 'goblinBarrel':
                return `${u.kind}-${fighting ? 'attack' : moving ? 'run' : 'idle'}`;
            case 'sheep':
                return moving ? 'sheep-run' : u.id % 3 === 0 ? 'sheep-graze' : 'sheep-idle';
            case 'wolf':
            case 'bear':
                return u.kind;
            default: {
                const never: never = u.kind;
                throw new Error(`Unknown unit ${String(never)}`);
            }
        }
    }

    private workTool(u: Unit): string {
        const o = u.order;
        if (o.type === 'build') return 'hammer';
        if (o.type === 'farm') return 'pickaxe';
        if (o.type === 'gather') {
            const r = this.sim.resourceById.get(o.resourceId);
            if (r?.kind === 'tree') return 'axe';
            if (r?.kind === 'carcass') return 'knife';
            return 'pickaxe';
        }
        return 'hammer';
    }

    private syncUnits() {
        const sim = this.sim;
        const seen = new Set<number>();
        const t = sim.state.time;
        for (const u of sim.state.units) {
            seen.add(u.id);
            let view = this.units.get(u.id);
            const color = factionColor(sim, u.faction);
            const key = u.kind === 'wolf' ? 'wolf' : u.kind === 'bear' ? (biomeAt(sim.state.map, u.x, u.y) === 'snow' ? 'polar-bear' : 'bear') : this.unitAnim(u, color);
            if (!view) {
                const art = UNIT_ART[u.kind];
                const sprite = this.scene.add.sprite(0, 0, key === 'wolf' || key.includes('bear') ? key : '__DEFAULT');
                sprite.setOrigin(0.5, unitOriginY(u.kind)).setScale(art.scale);
                view = { sprite, key: '' };
                this.units.set(u.id, view);
            }
            if (view.key !== key) {
                view.key = key;
                if (u.kind === 'wolf' || u.kind === 'bear') view.sprite.setTexture(key);
                else {
                    const frames = this.scene.anims.get(key)?.frames.length ?? 0;
                    if (frames > 0) view.sprite.play({ key, startFrame: u.id % frames }, true);
                }
            }
            const shown = this.unitShown(u);
            view.sprite.setVisible(shown);
            if (!shown) continue;
            let bob = 0;
            if ((u.kind === 'wolf' || u.kind === 'bear') && (u.anim === 'run' || u.anim === 'attack')) bob = Math.abs(Math.sin(t * 12 + u.id)) * -5;
            view.sprite.setPosition(u.x * TILE, u.y * TILE + bob);
            view.sprite.setFlipX(u.kind === 'wolf' || u.kind === 'bear' ? u.facing > 0 : u.facing < 0);
            view.sprite.setDepth(u.y * TILE + 20);
        }
        for (const [id, view] of this.units) {
            if (!seen.has(id)) {
                view.sprite.destroy();
                this.units.delete(id);
            }
        }
    }

    // ---------- buildings ----------

    private wallMask(b: Building): string {
        if (b.kind !== 'wall' && b.kind !== 'gate') return '';
        const { map } = this.sim.state;
        const isWall = (x: number, y: number) => {
            if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
            const o = this.sim.buildingById.get(map.block[idx(map, x, y)]);
            return !!o && (o.kind === 'wall' || o.kind === 'gate');
        };
        return [isWall(b.x, b.y - 1), isWall(b.x + 1, b.y), isWall(b.x, b.y + 1), isWall(b.x - 1, b.y)].map(Number).join('');
    }

    private buildingSignature(b: Building): string {
        const v = this.sim.village(b.villageId);
        return `${b.kind}|${b.built}|${factionColor(this.sim, b.faction)}|${b.variant}|${this.wallMask(b)}|${v?.stage ?? ''}`;
    }

    private syncBuildings() {
        const sim = this.sim;
        const seen = new Set<number>();
        for (const b of sim.state.buildings) {
            seen.add(b.id);
            const sig = this.buildingSignature(b);
            let view = this.buildings.get(b.id);
            if (!view || view.signature !== sig) {
                if (view) this.destroyBuildingView(view);
                view = this.createBuildingView(b, sig);
                this.buildings.set(b.id, view);
            }
            const shown = this.buildingShown(b);
            view.container.setVisible(shown);
            view.flat.forEach((f) => f.setVisible(shown));
            this.updateFires(b, view, shown);
        }
        for (const [id, view] of this.buildings) {
            if (!seen.has(id)) {
                this.destroyBuildingView(view);
                this.buildings.delete(id);
            }
        }
        for (const v of sim.state.villages) {
            const fire = this.camp.get(v.id);
            const wantFire = v.stage === 'camp';
            if (wantFire && !fire) {
                const s = this.scene.add.sprite((v.cx + 1.5) * TILE, (v.cy + 1.4) * TILE, 'fx-fire').play('fx-fire').setDepth((v.cy + 1.5) * TILE);
                this.camp.set(v.id, s);
            } else if (!wantFire && fire) {
                fire.destroy();
                this.camp.delete(v.id);
            }
            if (fire) fire.setVisible(this.explored(v.cx, v.cy));
        }
    }

    private updateFires(b: Building, view: BuildingView, shown: boolean) {
        const max = this.sim.buildingMaxHp(b);
        const want = b.built && b.hp < max * 0.5 && b.w > 1 ? (b.hp < max * 0.25 ? 2 : 1) : 0;
        while (view.fires.length < want) {
            const f = this.scene.add
                .sprite((b.x + 0.5 + Math.random() * (b.w - 1)) * TILE, (b.y + 0.3 + Math.random() * (b.h - 0.8)) * TILE - 40, 'fx-fire')
                .play('fx-fire')
                .setScale(1.3)
                .setDepth((b.y + b.h) * TILE + 5);
            view.fires.push(f);
        }
        while (view.fires.length > want) view.fires.pop()!.destroy();
        view.fires.forEach((f) => f.setVisible(shown));
    }

    private destroyBuildingView(view: BuildingView) {
        view.container.destroy();
        view.flat.forEach((f) => f.destroy());
        view.fires.forEach((f) => f.destroy());
    }

    private createBuildingView(b: Building, signature: string): BuildingView {
        const scene = this.scene;
        const color = factionColor(this.sim, b.faction);
        const baseX = (b.x + b.w / 2) * TILE;
        const baseY = (b.y + b.h) * TILE;
        const container = scene.add.container(0, 0);
        const flat: Phaser.GameObjects.Image[] = [];
        const bottomDepth = (b.y + b.h) * TILE;
        container.setDepth(bottomDepth);

        const main = (key: string, offsetY = 12, scale = 1) => {
            const img = scene.add.image(baseX, baseY + offsetY, key).setOrigin(0.5, 1).setScale(scale);
            if (!b.built && !key.includes('construction')) img.setAlpha(0.5);
            container.add(img);
            return img;
        };
        const prop = (key: string, x: number, y: number, scale = 1) => {
            const img = scene.add.image(x * TILE, y * TILE, key).setScale(scale).setOrigin(0.5, 0.8);
            if (!b.built) img.setAlpha(0.5);
            container.add(img);
            return img;
        };
        const tile = (index: number, x: number, y: number, depth: number = DEPTH.decals) => {
            const img = scene.add.image((x + 0.5) * TILE, (y + 0.5) * TILE, 'terrain-atlas', index).setDepth(depth);
            if (!b.built) img.setAlpha(0.5);
            flat.push(img);
            return img;
        };

        switch (b.kind) {
            case 'townCenter':
                main(b.built ? `Castle-${color}` : 'Castle-construction', 16);
                break;
            case 'palace':
                main(b.built ? 'Palace' : 'Castle-construction', 16);
                break;
            case 'house':
                main(b.built ? `House${b.variant + 1}-${color}` : 'House-construction', 30);
                break;
            case 'campHut':
                main(`House1-${color}`, 30);
                break;
            case 'tower':
                main(b.built ? `Tower-${color}` : 'Tower-construction', 30);
                break;
            case 'barracks':
                main(`Barracks-${color}`, 24);
                break;
            case 'archery':
                main(`Archery-${color}`, 24);
                break;
            case 'monastery':
                main(`Monastery-${color}`, 24);
                break;
            case 'granary':
                main(b.built ? `House2-${color}` : 'House-construction', 30);
                prop('meat-pile', b.x + 1.9, b.y + 2.1, 0.6);
                prop('deco13', b.x + 0.2, b.y + 2.1);
                break;
            case 'market':
                main(`House3-${color}`, 24, 1);
                prop('gold-pile', b.x + 0.3, b.y + 2.2, 0.6);
                prop('meat-pile', b.x + 2.7, b.y + 2.2, 0.6);
                prop('wood-pile', b.x + 2.6, b.y + 1.3, 0.6);
                prop('deco17', b.x + 0.4, b.y + 1.2);
                break;
            case 'lumberCamp':
                prop('stump1', b.x + 0.8, b.y + 1.6, 0.6);
                prop('wood-pile', b.x + 1.4, b.y + 1.9, 0.9);
                prop('wood-pile', b.x + 0.6, b.y + 2.0, 0.9);
                prop('tool1', b.x + 1.6, b.y + 1.1);
                break;
            case 'mine':
                main('gold-mine', 8);
                break;
            case 'farm': {
                for (let dy = 0; dy < 3; dy++) {
                    for (let dx = 0; dx < 3; dx++) tile(ROW.sand * COLS + autotile(dy > 0, dx < 2, dy < 2, dx > 0), b.x + dx, b.y + dy);
                }
                if (b.built) {
                    const spots = [[0.6, 0.9], [1.5, 0.8], [2.4, 1.0], [0.8, 1.9], [1.9, 2.1], [2.5, 2.4], [1.2, 2.6]];
                    spots.forEach(([dx, dy], i) => prop(`deco${12 + (i % 2)}`, b.x + dx, b.y + dy));
                    prop('deco18', b.x + 0.5, b.y + 2.8, 0.55);
                } else prop('tool3', b.x + 1.5, b.y + 1.6);
                break;
            }
            case 'garden':
                prop('bush1', b.x + 0.6, b.y + 1.0, 0.5);
                prop('bush3', b.x + 1.5, b.y + 1.9, 0.5);
                prop('deco3', b.x + 1.5, b.y + 0.9);
                prop('deco12', b.x + 0.5, b.y + 1.9);
                prop('deco2', b.x + 1.0, b.y + 1.4);
                break;
            case 'well':
                tile(ROW.misc * COLS, b.x, b.y);
                if (b.built) {
                    const s = scene.add.sprite((b.x + 0.5) * TILE, (b.y + 0.5) * TILE, 'waterrock1').play('waterrock1');
                    container.add(s);
                }
                break;
            case 'oasis':
                for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) tile(b.built ? ROW.misc * COLS : ROW.sand * COLS + 5, b.x + dx, b.y + dy);
                if (b.built) {
                    const s = scene.add.sprite((b.x + 1.5) * TILE, (b.y + 1.5) * TILE, 'waterrock2').play('waterrock2');
                    container.add(s);
                    prop('bush2', b.x - 0.1, b.y + 0.4, 0.55);
                    prop('bush4', b.x + 3.1, b.y + 0.5, 0.55);
                    prop('bush1', b.x - 0.1, b.y + 3.1, 0.55);
                    prop('bush3', b.x + 3.1, b.y + 3.0, 0.55);
                }
                break;
            case 'wall': {
                const m = this.wallMask(b).split('').map((c) => c === '1');
                tile(ROW.elevStone * COLS + autotile(m[0], m[1], m[2], m[3]), b.x, b.y, bottomDepth);
                if (!m[2]) {
                    const col = !m[3] && m[1] ? 0 : m[3] && m[1] ? 1 : m[3] && !m[1] ? 2 : 3;
                    tile(ROW.cliffs * COLS + 12 + col, b.x, b.y + 1, bottomDepth);
                }
                break;
            }
            case 'gate': {
                const img = scene.add.image((b.x + 0.5) * TILE, (b.y + 0.5) * TILE, 'bridge', 1).setDepth(bottomDepth);
                if (!b.built) img.setAlpha(0.5);
                flat.push(img);
                break;
            }
            case 'goblinHut':
                main('goblin-hut', 30);
                break;
            case 'goblinTower': {
                const s = scene.add.sprite(baseX, baseY + 16, 'goblin-tower').setOrigin(0.5, 1).play('goblin-tower');
                container.add(s);
                break;
            }
            case 'road':
                tile(ROW.sand * COLS + 15, b.x, b.y).setAlpha(0.5);
                break;
            case 'pond':
                tile(ROW.misc * COLS, b.x, b.y).setAlpha(0.45);
                prop('tool3', b.x + 0.5, b.y + 0.7);
                break;
            case 'landfill':
                tile(ROW.sand * COLS + 15, b.x, b.y).setAlpha(0.5);
                prop('rock2', b.x + 0.5, b.y + 0.7);
                break;
            case 'sapling':
                prop('deco11', b.x + 0.5, b.y + 0.8, 1.4);
                break;
            default: {
                const never: never = b.kind;
                throw new Error(`Unknown building ${String(never)}`);
            }
        }
        return { container, flat, signature, fires: [] };
    }

    // ---------- resources ----------

    private syncResources() {
        const sim = this.sim;
        const seen = new Set<number>();
        for (const r of sim.state.resources) {
            seen.add(r.id);
            if (this.resources.has(r.id)) continue;
            this.resources.set(r.id, this.createResource(r));
            this.resourceKinds.set(r.id, r);
        }
        for (const [id, obj] of this.resources) {
            if (seen.has(id)) continue;
            const r = this.resourceKinds.get(id);
            if (r?.kind === 'tree') {
                const stump = this.scene.add
                    .image((r.x + 0.5) * TILE, (r.y + 1) * TILE, `stump${(r.variant % 4) + 1}`)
                    .setOrigin(0.5, 0.85)
                    .setDepth((r.y + 1) * TILE - 1);
                this.scene.time.delayedCall(90_000, () => stump.destroy());
            }
            obj.destroy();
            this.resources.delete(id);
            this.resourceKinds.delete(id);
        }
    }

    private createResource(r: ResourceNode): Phaser.GameObjects.Sprite | Phaser.GameObjects.Image {
        const px = (r.x + 0.5) * TILE;
        const py = (r.y + 0.5) * TILE;
        switch (r.kind) {
            case 'tree': {
                const key = `tree${(r.variant % 4) + 1}`;
                const s = this.scene.add.sprite(px, (r.y + 1) * TILE, key).setOrigin(0.5, 0.88).setDepth((r.y + 1) * TILE);
                s.play({ key, startFrame: (r.x * 5 + r.y * 3) % 8 });
                const biome = biomeAt(this.sim.state.map, r.x, r.y);
                if (biome === 'snow') s.setTint(0xe6eeff);
                else if (biome === 'desert') s.setTint(0xf2e2b6);
                return s;
            }
            case 'gold':
                return this.scene.add.image(px, py, `goldstone${(r.variant % 6) + 1}`).setDepth(py + 20).setScale(0.8);
            case 'stone':
                return this.scene.add.image(px, py, `rock${(r.variant % 4) + 1}`).setDepth(py + 20).setScale(1.7).setTint(0xc8ccd4);
            case 'carcass':
                return this.scene.add.image(px, py, 'meat').setDepth(DEPTH.decals + 2);
            default: {
                const never: never = r.kind;
                throw new Error(`Unknown resource ${String(never)}`);
            }
        }
    }

    // ---------- health bars, selection rings ----------

    private drawOverlays(sel: RenderSelection) {
        const sim = this.sim;
        const g = this.bars;
        const rings = this.rings;
        g.clear();
        rings.clear();
        const cam = this.scene.cameras.main;
        const view = cam.worldView;
        const margin = 128;
        const inView = (x: number, y: number) => x > view.x - margin && x < view.right + margin && y > view.y - margin && y < view.bottom + margin;

        const explorer = sim.explorer();
        if (explorer) {
            rings.lineStyle(3, 0xffd34d, 0.95);
            rings.strokeEllipse(explorer.x * TILE, explorer.y * TILE, 52, 18);
        }

        for (const u of sim.state.units) {
            const px = u.x * TILE;
            const py = u.y * TILE;
            if (!inView(px, py) || !this.unitShown(u)) continue;
            const hit = unitHit(u.kind);
            const max = sim.maxHp(u.kind);
            const selected = sel.units.has(u.id);
            if (selected) {
                const col = u.faction === KINGDOM ? 0x7cff6b : sim.hostileFactions(KINGDOM, u.faction) ? 0xff5a4d : 0xffe066;
                rings.lineStyle(2, col, 1);
                rings.strokeEllipse(px, py, Math.max(28, hit.halfW * TILE * 2.2), 16);
            }
            if (u.hp < max || selected || sel.hover === u.id) {
                const head = py - (hit.lift + hit.halfH) * TILE;
                this.bar(g, px, head - 8, 50, u.hp / max, 'health');
            }
        }

        for (const b of sim.state.buildings) {
            const cx = (b.x + b.w / 2) * TILE;
            const cy = b.y * TILE;
            if (!inView(cx, cy) || !this.buildingShown(b)) continue;
            const max = sim.buildingMaxHp(b);
            const selected = sel.building === b.id;
            if (selected) {
                rings.lineStyle(2, b.faction === KINGDOM ? 0x7cff6b : 0xffe066, 1);
                rings.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
            }
            const def = BUILDINGS[b.kind];
            if (def.category === 'terrain' && b.built) continue;
            const w = Math.min(120, b.w * TILE * 0.6);
            const top = cy - (b.kind === 'wall' || b.kind === 'gate' || b.kind === 'farm' || def.category === 'terrain' ? 8 : b.kind === 'monastery' ? 150 : 90);
            if (!b.built) {
                this.bar(g, cx, top, w, b.progress, 0x5bc0ff);
            } else if (b.hp < max || selected || sel.hover === b.id) {
                this.bar(g, cx, top, w, b.hp / max, 'health');
            }
            if (b.queue.length && b.faction === KINGDOM) this.bar(g, cx, top + 14, w * 0.8, b.queue[0].progress, 0xffd34d);
        }
    }

    /**
     * Flat bar with a dark track so the missing portion is obvious.
     * Health bars stay red and flash once the subject is close to dying.
     */
    private bar(g: Phaser.GameObjects.Graphics, cx: number, y: number, w: number, frac: number, color: number | 'health') {
        const f = Math.max(0, Math.min(1, frac));
        const now = this.scene.time.now;
        let fill: number;
        let critical = false;
        if (color === 'health') {
            const look = hpLook(f, now);
            fill = look.color;
            critical = look.critical;
        } else {
            fill = color;
        }
        const health = color === 'health';
        const h = BAR_H;
        const x = Math.round(cx - w / 2);
        const top = Math.round(y);

        if (critical) {
            const pulse = 0.5 + 0.5 * Math.sin(now * (f < 0.15 ? 0.022 : 0.013));
            g.fillStyle(0xff2020, 0.18 + pulse * 0.55);
            g.fillRect(x - 3, top - 3, w + 6, h + 6);
        }
        g.fillStyle(0x000000, 0.55);
        g.fillRect(x - 1, top + 1, w + 2, h + 2);
        g.fillStyle(0x0c0606, 1);
        g.fillRect(x - 1, top - 1, w + 2, h + 2);
        g.fillStyle(health ? 0x5c1a1a : 0x24160f, 1);
        g.fillRect(x, top, w, h);
        const fw = f <= 0 ? 0 : Math.min(w, Math.max(health ? 2 : 1, Math.round(f * w)));
        if (fw <= 0) return;
        g.fillStyle(fill, 1);
        g.fillRect(x, top, fw, h);
        g.fillStyle(0xffffff, critical ? 0.28 : 0.4);
        g.fillRect(x, top, fw, 2);
    }
}
