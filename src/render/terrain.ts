import Phaser from 'phaser';
import { TILE } from '../data/balance';
import { idx, inBounds, type MapData } from '../sim/map';
import { BIOME_IDS, Ground } from '../sim/types';

/** Rows in the generated terrain atlas. Each row holds a 16-tile autotile set (4x4 layout). */
export const ROW = {
    sand: 0,
    grass: 1,
    forest: 2,
    snow: 3,
    elevGrass: 4,
    elevForest: 5,
    elevSnow: 6,
    elevStone: 7,
    cliffs: 8,
    misc: 9
} as const;
export const COLS = 16;
export const DEPTH = {
    water: 0,
    foam: 1,
    ground: 2,
    road: 6,
    elevation: 7,
    decals: 8,
    fog: 1_000_000,
    ui: 1_000_001
} as const;

/** Picks one of 16 autotiles from which of the four neighbours match. */
export const autotile = (n: boolean, e: boolean, s: boolean, w: boolean): number => {
    const col = !w && e ? 0 : w && e ? 1 : w && !e ? 2 : 3;
    const row = !n && s ? 0 : n && s ? 1 : n && !s ? 2 : 3;
    return row * 4 + col;
};

const isGreen = (r: number, g: number, b: number) => g > r * 0.92 && g > b * 1.02 && g > 60;

/** Turns green grass pixels into snow, leaving rock and outlines alone. */
const snowify = (src: CanvasImageSource, w: number, h: number): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, w, h);
    const p = data.data;
    for (let i = 0; i < p.length; i += 4) {
        const r = p[i];
        const g = p[i + 1];
        const b = p[i + 2];
        if (p[i + 3] === 0 || !isGreen(r, g, b)) continue;
        const l = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
        p[i] = Math.min(255, 150 + l * 125);
        p[i + 1] = Math.min(255, 165 + l * 110);
        p[i + 2] = Math.min(255, 190 + l * 80);
    }
    ctx.putImageData(data, 0, 0);
    return c;
};

export const buildAtlas = (scene: Phaser.Scene) => {
    if (scene.textures.exists('terrain-atlas')) return;
    const img = (key: string) => scene.textures.get(key).getSourceImage() as HTMLImageElement;
    const grass = img('tilemap1');
    const forest = img('tilemap3');
    const snow = snowify(grass, grass.width, grass.height);
    const flatOld = img('tilemap-flat-old');
    const stone = img('tilemap-stone');

    const canvas = scene.textures.createCanvas('terrain-atlas', COLS * TILE, 10 * TILE)!;
    const ctx = canvas.getContext();
    const copy = (src: CanvasImageSource, sx: number, sy: number, row: number, col: number) =>
        ctx.drawImage(src, sx * TILE, sy * TILE, TILE, TILE, col * TILE, row * TILE, TILE, TILE);

    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            const i = r * 4 + c;
            copy(flatOld, 5 + c, r, ROW.sand, i);
            copy(grass, c, r, ROW.grass, i);
            copy(forest, c, r, ROW.forest, i);
            copy(snow, c, r, ROW.snow, i);
            copy(grass, 5 + c, r, ROW.elevGrass, i);
            copy(forest, 5 + c, r, ROW.elevForest, i);
            copy(snow, 5 + c, r, ROW.elevSnow, i);
            copy(stone, c, r === 3 ? 4 : r, ROW.elevStone, i);
        }
    }
    for (let c = 0; c < 4; c++) {
        copy(grass, 5 + c, 4, ROW.cliffs, c);
        copy(forest, 5 + c, 4, ROW.cliffs, 4 + c);
        copy(snow, 5 + c, 4, ROW.cliffs, 8 + c);
        copy(stone, c, 3, ROW.cliffs, 12 + c);
        // Cliffs standing in water (with foam at the bottom) go in the misc row.
        copy(grass, 5 + c, 5, ROW.misc, 4 + c);
        copy(forest, 5 + c, 5, ROW.misc, 8 + c);
        copy(stone, c, 5, ROW.misc, 12 + c);
    }
    ctx.drawImage(img('water'), 0, 0, TILE, TILE, 0, ROW.misc * TILE, TILE, TILE);
    for (let i = 0; i < COLS * 10; i++) canvas.add(i, 0, (i % COLS) * TILE, Math.floor(i / COLS) * TILE, TILE, TILE);
    canvas.refresh();
};

export class TerrainRenderer {
    private map: Phaser.Tilemaps.Tilemap | null = null;
    private layers: Phaser.Tilemaps.TilemapLayer[] = [];
    private foam: Phaser.GameObjects.Sprite[] = [];
    private decor: Phaser.GameObjects.GameObject[] = [];
    private builtVersion = -1;

    constructor(private readonly scene: Phaser.Scene, private data: MapData) {}

    setData(data: MapData) {
        this.data = data;
        this.builtVersion = -1;
    }

    update() {
        if (this.data.version !== this.builtVersion) this.rebuild();
    }

    private rebuild() {
        const scene = this.scene;
        buildAtlas(scene);
        const d = this.data;
        const firstBuild = this.builtVersion === -1 || !this.map;
        this.builtVersion = d.version;

        if (firstBuild) {
            this.map?.destroy();
            this.map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: d.w, height: d.h });
            const tileset = this.map.addTilesetImage('terrain-atlas', 'terrain-atlas', TILE, TILE, 0, 0)!;
            this.layers = ['water', 'sand', 'grass', 'forest', 'snow', 'road', 'elev', 'cliff'].map((name, i) => {
                const layer = this.map!.createBlankLayer(name, tileset, 0, 0)!;
                layer.setDepth(i === 0 ? DEPTH.water : i < 5 ? DEPTH.ground + i * 0.1 : i === 5 ? DEPTH.road : DEPTH.elevation);
                return layer;
            });
            this.decor.forEach((o) => o.destroy());
            this.decor = [];
            this.placeDecor();
        }
        const [water, sand, grass, forest, snow, road, elev, cliff] = this.layers;
        const land = (x: number, y: number) => inBounds(d, x, y) && d.ground[idx(d, x, y)] !== Ground.Water;
        const groundIs = (g: number) => (x: number, y: number) => inBounds(d, x, y) && d.ground[idx(d, x, y)] === g;
        const isForest = (x: number, y: number) =>
            inBounds(d, x, y) && d.ground[idx(d, x, y)] === Ground.Grass && BIOME_IDS[d.biome[idx(d, x, y)]] === 'forest';
        const isElev = (x: number, y: number) => inBounds(d, x, y) && d.elev[idx(d, x, y)] === 1;
        const isCliff = (x: number, y: number) => inBounds(d, x, y) && d.cliff[idx(d, x, y)] === 1;
        const isRoad = (x: number, y: number) => inBounds(d, x, y) && d.road[idx(d, x, y)] === 1;
        const auto = (test: (x: number, y: number) => boolean, x: number, y: number) =>
            autotile(test(x, y - 1), test(x + 1, y), test(x, y + 1), test(x - 1, y));
        const isGrass = groundIs(Ground.Grass);
        const isSnow = groundIs(Ground.Snow);

        for (let y = 0; y < d.h; y++) {
            for (let x = 0; x < d.w; x++) {
                water.putTileAt(ROW.misc * COLS, x, y);
                const put = (layer: Phaser.Tilemaps.TilemapLayer, on: boolean, index: number) => {
                    if (on) layer.putTileAt(index, x, y);
                    else layer.removeTileAt(x, y);
                };
                const l = land(x, y);
                put(sand, l, ROW.sand * COLS + auto(land, x, y));
                put(grass, isGrass(x, y), ROW.grass * COLS + auto(isGrass, x, y));
                put(forest, isForest(x, y), ROW.forest * COLS + auto(isForest, x, y));
                put(snow, isSnow(x, y), ROW.snow * COLS + auto(isSnow, x, y));
                put(road, isRoad(x, y) && l, ROW.sand * COLS + auto(isRoad, x, y));

                const biome = BIOME_IDS[d.biome[idx(d, x, y)]];
                const elevRow = biome === 'snow' ? ROW.elevSnow : biome === 'desert' ? ROW.elevStone : biome === 'forest' ? ROW.elevForest : ROW.elevGrass;
                put(elev, isElev(x, y), elevRow * COLS + auto(isElev, x, y));

                if (isCliff(x, y)) {
                    const above = BIOME_IDS[d.biome[idx(d, x, Math.max(0, y - 1))]];
                    const w = isCliff(x - 1, y);
                    const e = isCliff(x + 1, y);
                    const col = !w && e ? 0 : w && e ? 1 : w && !e ? 2 : 3;
                    const inWater = !l;
                    const set = above === 'snow' ? 8 : above === 'desert' ? 12 : above === 'forest' ? 4 : 0;
                    const index = inWater && set !== 8 ? ROW.misc * COLS + (set === 0 ? 4 : set === 4 ? 8 : 12) + col : ROW.cliffs * COLS + set + col;
                    cliff.putTileAt(index, x, y);
                } else cliff.removeTileAt(x, y);
            }
        }
        this.rebuildFoam();
    }

    private rebuildFoam() {
        this.foam.forEach((f) => f.destroy());
        this.foam = [];
        const d = this.data;
        for (let y = 0; y < d.h; y++) {
            for (let x = 0; x < d.w; x++) {
                if (d.ground[idx(d, x, y)] === Ground.Water) continue;
                const coast = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inBounds(d, x + dx, y + dy) || d.ground[idx(d, x + dx, y + dy)] === Ground.Water);
                if (!coast) continue;
                const s = this.scene.add.sprite((x + 0.5) * TILE, (y + 0.5) * TILE, 'foam').setDepth(DEPTH.foam);
                s.play({ key: 'foam', startFrame: (x * 7 + y * 3) % 16 });
                this.foam.push(s);
            }
        }
    }

    private placeDecor() {
        const d = this.data;
        for (const o of d.decor) {
            const px = (o.x + 0.5) * TILE;
            const py = (o.y + 0.5) * TILE;
            let obj: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
            switch (o.kind) {
                case 'bush':
                    obj = this.scene.add.sprite(px, py - 20, `bush${o.variant + 1}`).setScale(0.55);
                    (obj as Phaser.GameObjects.Sprite).play({ key: `bush${o.variant + 1}`, startFrame: (o.x + o.y) % 8 });
                    break;
                case 'rock':
                    obj = this.scene.add.image(px, py, `rock${o.variant + 1}`);
                    break;
                case 'mushroom':
                    obj = this.scene.add.image(px, py, `deco${o.variant + 1}`);
                    break;
                case 'grass':
                    obj = this.scene.add.image(px, py, `deco${10 + o.variant}`);
                    break;
                case 'pumpkin':
                    obj = this.scene.add.image(px, py, `deco${12 + o.variant}`);
                    break;
                case 'bone':
                    obj = this.scene.add.image(px, py, `deco${14 + o.variant}`);
                    break;
                case 'waterRock':
                    obj = this.scene.add.sprite(px, py, `waterrock${o.variant + 1}`);
                    (obj as Phaser.GameObjects.Sprite).play({ key: `waterrock${o.variant + 1}`, startFrame: (o.x * 3 + o.y) % 16 });
                    obj.setDepth(DEPTH.foam + 0.5);
                    this.decor.push(obj);
                    continue;
                default: {
                    const never: never = o.kind;
                    throw new Error(`Unknown decoration ${String(never)}`);
                }
            }
            obj.setDepth(o.kind === 'grass' || o.kind === 'bone' ? DEPTH.decals : py);
            this.decor.push(obj);
        }
    }

    destroy() {
        this.foam.forEach((f) => f.destroy());
        this.decor.forEach((o) => o.destroy());
        this.map?.destroy();
    }
}
