import Phaser from 'phaser';
import { BUILDINGS } from '../data/buildings';
import { COMMAND_RADIUS, TILE } from '../data/balance';
import { Controller } from '../game/controller';
import { EntityRenderer } from '../render/entities';
import { FogRenderer } from '../render/fog';
import { FxRenderer } from '../render/fx';
import { DEPTH, TerrainRenderer } from '../render/terrain';
import { SoundManager } from '../audio/sound';
import { newGame } from '../sim/create';
import { randomSeed } from '../sim/rng';
import type { Sim } from '../sim/sim';
import { KINGDOM, type BuildingKind } from '../sim/types';
import { buildingAt, issueMove, issueSmartCommand, isCommandable, playerPlaceBuilding, unitAt } from '../sim/commands';
import { placementProblem } from '../sim/buildings';
import { idx, inBounds } from '../sim/map';
import { GameUI } from '../ui/ui';

const PAN_SPEED = 900;
const EDGE = 14;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;

export class WorldScene extends Phaser.Scene {
    controller!: Controller;
    private sim!: Sim;
    private terrain!: TerrainRenderer;
    private entities!: EntityRenderer;
    private fog!: FogRenderer;
    private fx!: FxRenderer;
    private sfx!: SoundManager;
    private ui!: GameUI;
    private keys!: Record<string, Phaser.Input.Keyboard.Key>;
    private boxGraphics!: Phaser.GameObjects.Graphics;
    private rangeGraphics!: Phaser.GameObjects.Graphics;
    private ghost: Phaser.GameObjects.Container | null = null;
    private ghostKind: BuildingKind | null = null;
    private night!: Phaser.GameObjects.Rectangle;
    private clouds: Phaser.GameObjects.Image[] = [];
    private snow!: Phaser.GameObjects.Particles.ParticleEmitter;
    private dragStart: { x: number; y: number; button: number } | null = null;
    private dragging = false;
    private lastPaintTile = '';
    private lastClick = { time: 0, id: -1 };
    private pointerInside = false;
    private placedThisClick = false;

    constructor() {
        super('world');
    }

    create() {
        const seedParam = new URLSearchParams(location.search).get('seed');
        const seed = seedParam ? Number(seedParam) : randomSeed();
        this.sim = newGame(seed);
        this.controller = new Controller(this.sim);
        this.sfx = new SoundManager(this);
        this.terrain = new TerrainRenderer(this, this.sim.state.map);
        this.terrain.update();
        this.entities = new EntityRenderer(this, this.sim);
        this.fog = new FogRenderer(this, this.sim);
        this.fx = new FxRenderer(this, this.sfx);
        this.boxGraphics = this.add.graphics().setDepth(DEPTH.ui);
        this.rangeGraphics = this.add.graphics().setDepth(DEPTH.decals + 0.5);
        this.createAtmosphere();

        const cam = this.cameras.main;
        const { w, h } = this.sim.state.map;
        cam.setBounds(-TILE * 4, -TILE * 4, (w + 8) * TILE, (h + 8) * TILE);
        cam.setZoom(0.8);
        const e = this.sim.explorer()!;
        cam.centerOn(e.x * TILE, e.y * TILE);
        this.controller.focusCamera = (x, y) => cam.pan(x * TILE, y * TILE, 350, 'Sine.easeInOut');

        this.setupInput();
        this.ui = new GameUI(this.controller, this, this.sfx);
        this.controller.addEventListener('sim-changed', () => this.onSimChanged());
        this.game.events.on(Phaser.Core.Events.BLUR, () => (this.pointerInside = false));
        this.input.on('gameout', () => (this.pointerInside = false));
        this.input.on('gameover', () => (this.pointerInside = true));
    }

    private onSimChanged() {
        this.sim = this.controller.sim;
        this.terrain.destroy();
        this.terrain = new TerrainRenderer(this, this.sim.state.map);
        this.terrain.update();
        this.entities.setSim(this.sim);
        this.fog.setSim(this.sim);
        const e = this.sim.explorer();
        if (e) this.cameras.main.centerOn(e.x * TILE, e.y * TILE);
    }

    startNewGame(seed: number) {
        this.controller.setSim(newGame(seed));
    }

    // ---------- atmosphere ----------

    private createAtmosphere() {
        const { width, height } = this.scale;
        this.night = this.add
            .rectangle(0, 0, width * 4, height * 4, 0x0b1440, 0)
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(DEPTH.fog - 30);
        for (let i = 0; i < 7; i++) {
            const c = this.add
                .image(Math.random() * this.sim.state.map.w * TILE, Math.random() * this.sim.state.map.h * TILE, `cloud${(i % 8) + 1}`)
                .setAlpha(0.35)
                .setScale(2)
                .setDepth(DEPTH.fog - 25);
            this.clouds.push(c);
        }
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 1);
        g.fillCircle(3, 3, 3);
        g.generateTexture('snowflake', 6, 6);
        g.destroy();
        this.snow = this.add.particles(0, 0, 'snowflake', {
            x: { min: -width, max: width * 2 },
            y: -20,
            lifespan: 7000,
            speedY: { min: 40, max: 90 },
            speedX: { min: -25, max: 10 },
            scale: { min: 0.4, max: 1 },
            alpha: { start: 0.9, end: 0.2 },
            frequency: 40,
            emitting: false
        });
        this.snow.setScrollFactor(0).setDepth(DEPTH.fog - 24);
    }

    private updateAtmosphere(dt: number) {
        const t = this.sim.timeOfDay;
        let dark = 0;
        if (t > 0.62) dark = Math.min(1, (t - 0.62) / 0.12);
        else if (t < 0.12) dark = Math.max(0, 1 - t / 0.12);
        this.night.setFillStyle(0x0b1440, dark * 0.42);
        this.night.setPosition(this.scale.width / 2, this.scale.height / 2);
        for (const c of this.clouds) {
            c.x += 12 * dt;
            if (c.x > (this.sim.state.map.w + 10) * TILE) c.x = -600;
        }
        const winter = this.sim.season === 'winter';
        if (winter !== this.snow.emitting) {
            if (winter) this.snow.start();
            else this.snow.stop();
        }
    }

    // ---------- input ----------

    private setupInput() {
        this.input.mouse?.disableContextMenu();
        const kb = this.input.keyboard!;
        this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,CTRL') as Record<string, Phaser.Input.Keyboard.Key>;
        kb.on('keydown-F', () => {
            this.controller.follow = !this.controller.follow;
            this.controller.toast(this.controller.follow ? 'Camera follows your explorer (F to stop).' : 'Camera is free.');
        });
        kb.on('keydown-SPACE', () => this.centerOnExplorer());
        kb.on('keydown-H', () => {
            const e = this.sim.explorer();
            if (e) {
                this.controller.selectUnits([e.id]);
                this.centerOnExplorer();
            }
        });
        kb.on('keydown-ESC', () => {
            if (this.controller.placing) this.controller.startPlacing(null);
            else this.controller.clearSelection();
        });

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            if (!this.isOverCanvas(p)) return;
            this.dragStart = { x: p.x, y: p.y, button: p.button };
            this.dragging = false;
            this.lastPaintTile = '';
            this.placedThisClick = false;
            if (p.button === 0 && this.controller.placing) {
                this.placedThisClick = true;
                this.tryPlace(p);
            }
        });
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            this.pointerInside = this.isOverCanvas(p);
            if (!this.dragStart) return;
            const dist = Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y);
            if (dist > 6) this.dragging = true;
            if (!this.dragging) return;
            if (this.dragStart.button === 2 || this.dragStart.button === 1) {
                const cam = this.cameras.main;
                cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
                cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
                this.controller.follow = false;
            } else if (this.dragStart.button === 0 && this.controller.placing) {
                const kind = this.controller.placing;
                if (kind === 'wall' || kind === 'road' || kind === 'gate' || kind === 'sapling' || kind === 'pond' || kind === 'landfill') this.tryPlace(p);
            }
        });
        this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
            const start = this.dragStart;
            this.dragStart = null;
            this.boxGraphics.clear();
            if (!start) return;
            if (start.button === 0 && !this.controller.placing && !this.placedThisClick) {
                if (this.dragging) this.boxSelect(start.x, start.y, p.x, p.y, this.keys.SHIFT.isDown);
                else this.clickSelect(p);
            } else if (start.button === 2 && !this.dragging) {
                if (this.controller.placing) this.controller.startPlacing(null);
                else this.rightClick(p);
            }
            this.dragging = false;
        });
        this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
            const cam = this.cameras.main;
            const before = cam.getWorldPoint(p.x, p.y);
            cam.setZoom(Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM));
            const after = cam.getWorldPoint(p.x, p.y);
            cam.scrollX += before.x - after.x;
            cam.scrollY += before.y - after.y;
        });
    }

    private isOverCanvas(p: Phaser.Input.Pointer): boolean {
        const target = p.event?.target as HTMLElement | undefined;
        return !target || target.tagName === 'CANVAS';
    }

    private worldTile(p: Phaser.Input.Pointer) {
        const wp = this.cameras.main.getWorldPoint(p.x, p.y);
        return { x: wp.x / TILE, y: wp.y / TILE };
    }

    centerOnExplorer() {
        const e = this.sim.explorer();
        if (e) this.cameras.main.pan(e.x * TILE, e.y * TILE, 300, 'Sine.easeInOut');
    }

    private clickSelect(p: Phaser.Input.Pointer) {
        const { x, y } = this.worldTile(p);
        const u = unitAt(this.sim, x, y, 0.7);
        if (u && this.entities.unitShown(u)) {
            const now = this.time.now;
            if (now - this.lastClick.time < 350 && this.lastClick.id === u.id && u.faction === KINGDOM) {
                const view = this.cameras.main.worldView;
                const same = this.sim.state.units.filter(
                    (o) => o.kind === u.kind && o.faction === KINGDOM && view.contains(o.x * TILE, o.y * TILE)
                );
                this.controller.selectUnits(same.map((o) => o.id));
            } else {
                this.controller.selectUnits([u.id], this.keys.SHIFT.isDown && u.faction === KINGDOM);
            }
            this.lastClick = { time: now, id: u.id };
            this.sfx.play('select');
            return;
        }
        const b = buildingAt(this.sim, x, y);
        const { map, explored } = this.sim.state;
        if (b && inBounds(map, Math.floor(x), Math.floor(y)) && explored[idx(map, Math.floor(x), Math.floor(y))]) {
            this.controller.selectBuilding(b.id);
            this.sfx.play('select');
            return;
        }
        this.controller.clearSelection();
    }

    private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean) {
        const cam = this.cameras.main;
        const a = cam.getWorldPoint(Math.min(x0, x1), Math.min(y0, y1));
        const b = cam.getWorldPoint(Math.max(x0, x1), Math.max(y0, y1));
        const inside = this.sim.state.units.filter(
            (u) => u.faction === KINGDOM && u.x * TILE >= a.x && u.x * TILE <= b.x && u.y * TILE >= a.y && u.y * TILE <= b.y
        );
        const fighters = inside.filter((u) => u.kind !== 'pawn');
        const pick = fighters.length && fighters.length < inside.length && !add ? fighters : inside;
        this.controller.selectUnits(pick.map((u) => u.id), add);
        if (pick.length) this.sfx.play('select');
    }

    private rightClick(p: Phaser.Input.Pointer) {
        const units = this.controller.commandableSelection();
        const { x, y } = this.worldTile(p);
        if (!units.length) {
            if (this.controller.selectedUnits.size) this.controller.toast('Those units are too far from your explorer to hear your orders.', 'bad');
            return;
        }
        if (this.keys.CTRL.isDown) issueMove(this.sim, units, x, y, true);
        else issueSmartCommand(this.sim, units, x, y);
        this.clickMarker(x, y);
    }

    private clickMarker(x: number, y: number) {
        const g = this.add.graphics().setDepth(DEPTH.decals + 2);
        g.lineStyle(3, 0x7cff6b, 1);
        g.strokeEllipse(x * TILE, y * TILE, 36, 16);
        this.tweens.add({ targets: g, alpha: 0, scale: 0.6, duration: 450, onComplete: () => g.destroy() });
    }

    private tryPlace(p: Phaser.Input.Pointer) {
        const kind = this.controller.placing;
        if (!kind) return;
        const { tx, ty } = this.ghostTile(p, kind);
        const key = `${tx},${ty}`;
        if (key === this.lastPaintTile) return;
        this.lastPaintTile = key;
        const builders = this.controller.commandableSelection().filter((u) => u.kind === 'pawn');
        const result = playerPlaceBuilding(this.sim, kind, tx, ty, builders);
        if (typeof result === 'string') {
            if (!this.dragging) {
                this.controller.toast(result, 'bad');
                this.sfx.play('error');
            }
            return;
        }
        const paint = kind === 'wall' || kind === 'road' || kind === 'gate' || kind === 'sapling' || kind === 'pond' || kind === 'landfill';
        if (!paint && !this.keys.SHIFT.isDown) this.controller.startPlacing(null);
    }

    private ghostTile(p: Phaser.Input.Pointer, kind: BuildingKind) {
        const def = BUILDINGS[kind];
        const { x, y } = this.worldTile(p);
        return { tx: Math.floor(x - def.w / 2 + 0.5), ty: Math.floor(y - def.h / 2 + 0.5) };
    }

    private updateGhost() {
        const kind = this.controller.placing;
        if (kind !== this.ghostKind) {
            this.ghost?.destroy();
            this.ghost = null;
            this.ghostKind = kind;
            if (kind) this.ghost = this.makeGhost(kind);
        }
        this.rangeGraphics.clear();
        if (!kind || !this.ghost) return;
        const p = this.input.activePointer;
        const { tx, ty } = this.ghostTile(p, kind);
        const def = BUILDINGS[kind];
        this.ghost.setPosition(tx * TILE, ty * TILE);
        const e = this.sim.explorer();
        const far = !e || Math.hypot(e.x - (tx + def.w / 2), e.y - (ty + def.h / 2)) > COMMAND_RADIUS;
        const problem = placementProblem(this.sim, kind, tx, ty);
        const ok = !problem && !far;
        const rect = this.ghost.getAt(0) as Phaser.GameObjects.Rectangle;
        rect.setFillStyle(ok ? 0x6bff6b : 0xff5050, 0.3);
        rect.setStrokeStyle(2, ok ? 0x6bff6b : 0xff5050, 0.9);
        if (e) {
            this.rangeGraphics.lineStyle(2, 0xffd34d, 0.35);
            this.rangeGraphics.strokeCircle(e.x * TILE, e.y * TILE, COMMAND_RADIUS * TILE);
        }
    }

    private makeGhost(kind: BuildingKind): Phaser.GameObjects.Container {
        const def = BUILDINGS[kind];
        const c = this.add.container(0, 0).setDepth(DEPTH.fog - 1);
        c.add(this.add.rectangle(0, 0, def.w * TILE, def.h * TILE, 0x6bff6b, 0.3).setOrigin(0, 0));
        const art: Partial<Record<BuildingKind, string>> = {
            townCenter: 'Castle-Blue',
            palace: 'Palace',
            house: 'House1-Blue',
            granary: 'House2-Blue',
            market: 'House3-Blue',
            tower: 'Tower-Blue',
            barracks: 'Barracks-Blue',
            archery: 'Archery-Blue',
            monastery: 'Monastery-Blue',
            mine: 'gold-mine',
            lumberCamp: 'wood-pile',
            garden: 'bush1',
            sapling: 'deco11',
            well: 'waterrock1',
            farm: 'deco18'
        };
        const key = art[kind];
        if (key) {
            const img = this.add.image((def.w * TILE) / 2, def.h * TILE + 16, key, 0).setOrigin(0.5, 1).setAlpha(0.6);
            if (kind === 'garden') img.setScale(0.6);
            c.add(img);
        }
        return c;
    }

    // ---------- main loop ----------

    private centeredOnce = false;

    update(_time: number, deltaMs: number) {
        const dt = Math.min(0.1, deltaMs / 1000);
        if (!this.centeredOnce) {
            this.centeredOnce = true;
            const e = this.sim.explorer();
            if (e) this.cameras.main.centerOn(e.x * TILE, e.y * TILE);
        }
        this.sim.update(dt);
        this.handleCamera(dt);
        this.terrain.update();
        this.entities.update({
            units: this.controller.selectedUnits,
            building: this.controller.selectedBuilding,
            hover: this.controller.hover
        });
        this.fog.update(dt);
        this.fx.drain(this.sim);
        this.updateGhost();
        this.updateAtmosphere(dt);
        this.drawDragBox();
        this.ui.update(dt);
    }

    private drawDragBox() {
        this.boxGraphics.clear();
        if (!this.dragStart || !this.dragging || this.dragStart.button !== 0 || this.controller.placing) return;
        const p = this.input.activePointer;
        const cam = this.cameras.main;
        const a = cam.getWorldPoint(this.dragStart.x, this.dragStart.y);
        const b = cam.getWorldPoint(p.x, p.y);
        this.boxGraphics.lineStyle(2 / cam.zoom, 0x7cff6b, 1);
        this.boxGraphics.fillStyle(0x7cff6b, 0.12);
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        this.boxGraphics.fillRect(x, y, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        this.boxGraphics.strokeRect(x, y, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    }

    private handleCamera(dt: number) {
        const cam = this.cameras.main;
        const k = this.keys;
        const typing = document.activeElement instanceof HTMLInputElement;
        let dx = 0;
        let dy = 0;
        if (!typing) {
            if (k.A.isDown || k.LEFT.isDown) dx -= 1;
            if (k.D.isDown || k.RIGHT.isDown) dx += 1;
            if (k.W.isDown || k.UP.isDown) dy -= 1;
            if (k.S.isDown || k.DOWN.isDown) dy += 1;
        }
        const p = this.input.activePointer;
        if (this.pointerInside && !this.dragStart && p.x >= 0 && p.y >= 0) {
            if (p.x < EDGE) dx -= 1;
            if (p.x > this.scale.width - EDGE) dx += 1;
            if (p.y < EDGE) dy -= 1;
            if (p.y > this.scale.height - EDGE) dy += 1;
        }
        if (dx || dy) {
            this.controller.follow = false;
            cam.scrollX += (dx * PAN_SPEED * dt) / cam.zoom;
            cam.scrollY += (dy * PAN_SPEED * dt) / cam.zoom;
        } else if (this.controller.follow) {
            const e = this.sim.explorer();
            if (e) {
                const tx = e.x * TILE - cam.width / 2;
                const ty = e.y * TILE - cam.height / 2;
                cam.scrollX += (tx - cam.scrollX) * Math.min(1, dt * 5);
                cam.scrollY += (ty - cam.scrollY) * Math.min(1, dt * 5);
            }
        }
        const hoverPoint = this.worldTile(p);
        const hovered = unitAt(this.sim, hoverPoint.x, hoverPoint.y, 0.6);
        this.controller.hover = hovered && this.entities.unitShown(hovered) ? hovered.id : buildingAt(this.sim, hoverPoint.x, hoverPoint.y)?.id ?? null;
        this.input.setDefaultCursor(this.cursorFor(hovered?.faction));
    }

    private cursorFor(faction: string | undefined): string {
        if (this.controller.placing) return 'crosshair';
        const units = this.controller.selectedUnitList();
        if (faction && faction !== KINGDOM && units.some((u) => isCommandable(this.sim, u)) && this.sim.hostileFactions(KINGDOM, faction)) return 'crosshair';
        return 'default';
    }
}
