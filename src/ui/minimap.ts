import { BIOMES } from '../data/biomes';
import type { Controller } from '../game/controller';
import { idx } from '../sim/map';
import { BANDIT, BIOME_IDS, Ground, KINGDOM, WILD } from '../sim/types';

const COLORS: Record<string, string> = {
    Blue: '#4a8fff',
    Red: '#ff4a4a',
    Purple: '#b25cff',
    Yellow: '#ffd23f',
    Black: '#333333'
};

export class Minimap {
    private ctx: CanvasRenderingContext2D;
    private base: ImageData | null = null;
    private baseVersion = -1;
    private baseSim: unknown = null;
    private dragging = false;

    constructor(
        private readonly canvas: HTMLCanvasElement,
        private readonly controller: Controller,
        private readonly getView: () => { x: number; y: number; w: number; h: number }
    ) {
        this.ctx = canvas.getContext('2d')!;
        const jump = (e: PointerEvent) => {
            const r = canvas.getBoundingClientRect();
            const { w, h } = this.controller.sim.state.map;
            this.controller.follow = false;
            this.controller.focusCamera(((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h);
        };
        canvas.addEventListener('pointerdown', (e) => {
            this.dragging = true;
            jump(e);
        });
        window.addEventListener('pointermove', (e) => this.dragging && jump(e));
        window.addEventListener('pointerup', () => (this.dragging = false));
    }

    private buildBase() {
        const { map } = this.controller.sim.state;
        this.canvas.width = map.w;
        this.canvas.height = map.h;
        const img = this.ctx.createImageData(map.w, map.h);
        for (let i = 0; i < map.w * map.h; i++) {
            let color = BIOMES[BIOME_IDS[map.biome[i]]].minimapColor;
            if (map.ground[i] === Ground.Water) color = BIOMES.water.minimapColor;
            else if (map.road[i]) color = 0xc9a86a;
            if (map.elev[i] || map.cliff[i]) color = shade(color, 0.7);
            img.data[i * 4] = (color >> 16) & 255;
            img.data[i * 4 + 1] = (color >> 8) & 255;
            img.data[i * 4 + 2] = color & 255;
            img.data[i * 4 + 3] = 255;
        }
        this.base = img;
        this.baseVersion = map.version;
        this.baseSim = this.controller.sim;
    }

    draw() {
        const sim = this.controller.sim;
        const { map, explored, settings } = sim.state;
        if (!this.base || this.baseVersion !== map.version || this.baseSim !== sim) this.buildBase();
        const img = new ImageData(new Uint8ClampedArray(this.base!.data), map.w, map.h);
        const d = img.data;
        for (let i = 0; i < map.w * map.h; i++) {
            if (!explored[i]) {
                d[i * 4] = 10;
                d[i * 4 + 1] = 12;
                d[i * 4 + 2] = 20;
            } else if (settings.sightFog && !sim.visible[i]) {
                d[i * 4] *= 0.72;
                d[i * 4 + 1] *= 0.72;
                d[i * 4 + 2] *= 0.72;
            }
        }
        const { ctx } = this;
        ctx.putImageData(img, 0, 0);

        for (const r of sim.state.resources) {
            if (r.kind !== 'gold' && r.kind !== 'stone') continue;
            if (!explored[idx(map, r.x, r.y)]) continue;
            ctx.fillStyle = r.kind === 'gold' ? '#ffe066' : '#b8bcc6';
            ctx.fillRect(r.x, r.y, 1, 1);
        }
        for (const b of sim.state.buildings) {
            if (!explored[idx(map, b.x, b.y)]) continue;
            ctx.fillStyle = b.faction === BANDIT ? '#8b1a1a' : colorOf(sim, b.faction);
            ctx.fillRect(b.x, b.y, Math.max(2, b.w), Math.max(2, b.h));
        }
        for (const u of sim.state.units) {
            const i = idx(map, Math.floor(u.x), Math.floor(u.y));
            if (u.faction !== KINGDOM && (!explored[i] || (settings.sightFog && !sim.visible[i]))) continue;
            if (u.faction === WILD) ctx.fillStyle = u.kind === 'sheep' ? '#ffffff' : '#a0522d';
            else if (u.faction === BANDIT) ctx.fillStyle = '#ff2020';
            else ctx.fillStyle = colorOf(sim, u.faction);
            ctx.fillRect(Math.floor(u.x), Math.floor(u.y), u.kind === 'explorer' ? 3 : 2, u.kind === 'explorer' ? 3 : 2);
        }
        const e = sim.explorer();
        if (e) {
            ctx.strokeStyle = '#ffd34d';
            ctx.lineWidth = 1;
            ctx.strokeRect(e.x - 2.5, e.y - 2.5, 5, 5);
        }
        const v = this.getView();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(v.x, v.y, v.w, v.h);
    }
}

const shade = (c: number, f: number) =>
    (Math.floor(((c >> 16) & 255) * f) << 16) | (Math.floor(((c >> 8) & 255) * f) << 8) | Math.floor((c & 255) * f);

const colorOf = (sim: Controller['sim'], faction: string): string => {
    if (faction === KINGDOM) return COLORS.Blue;
    const v = faction.startsWith('v') ? sim.village(Number(faction.slice(1))) : undefined;
    return COLORS[v?.color ?? 'Red'];
};
