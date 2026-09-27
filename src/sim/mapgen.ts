import { createNoise2D } from 'simplex-noise';
import { Rng } from './rng';
import { createMap, idx, inBounds, type Decoration, type MapData } from './map';
import { BIOME_IDS, Ground, type BiomeId, type Point } from './types';

export interface Site extends Point {
    biome: BiomeId;
}

export interface GeneratedWorld {
    map: MapData;
    trees: (Point & { variant: number })[];
    gold: Point[];
    stone: Point[];
    camps: Site[];
    villages: Site[];
    bandits: Site[];
    sheep: Point[];
    wolves: Point[];
    bears: Point[];
    center: Point;
}

const biomeIndex = (b: BiomeId): number => BIOME_IDS.indexOf(b);

const fbm = (noise: (x: number, y: number) => number, x: number, y: number, octaves: number): number => {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
        sum += amp * noise(x * freq, y * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
    }
    return sum / norm;
};

export const generateWorld = (seed: number, size: number): GeneratedWorld => {
    const rng = new Rng(seed);
    const heightNoise = createNoise2D(() => rng.next());
    const moistNoise = createNoise2D(() => rng.next());
    const tempNoise = createNoise2D(() => rng.next());
    const treeNoise = createNoise2D(() => rng.next());

    const map = createMap(size, size);
    const w = size;
    const h = size;
    const center = { x: Math.floor(w / 2), y: Math.floor(h / 2) };

    // Cold on one side of the world, hot on the other, in a random direction each game.
    const angle = rng.range(0, Math.PI * 2);
    const gx = Math.cos(angle);
    const gy = Math.sin(angle);

    const height = new Float32Array(w * h);
    const moist = new Float32Array(w * h);
    const temp = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = idx(map, x, y);
            const nx = x / w - 0.5;
            const ny = y / h - 0.5;
            const edge = Math.max(Math.abs(nx), Math.abs(ny)) * 2;
            const falloff = Math.pow(edge, 3.2) * 1.25;
            const centerBoost = Math.max(0, 0.35 - Math.hypot(nx, ny) * 2.2);
            height[i] = fbm(heightNoise, x / 38, y / 38, 4) * 0.55 + 0.32 - falloff + centerBoost;
            moist[i] = (fbm(moistNoise, x / 30, y / 30, 3) + 1) / 2;
            const along = nx * gx + ny * gy;
            temp[i] = 0.5 + along * 1.35 + fbm(tempNoise, x / 26, y / 26, 2) * 0.22;
        }
    }

    for (let i = 0; i < w * h; i++) {
        if (height[i] < 0) {
            map.ground[i] = Ground.Water;
            map.biome[i] = biomeIndex('water');
            continue;
        }
        let biome: BiomeId;
        if (temp[i] < 0.2) biome = 'snow';
        else if (temp[i] > 0.8 && moist[i] < 0.62) biome = 'desert';
        else if (moist[i] > 0.56) biome = 'forest';
        else biome = 'grassland';
        map.biome[i] = biomeIndex(biome);
        map.ground[i] = biome === 'snow' ? Ground.Snow : biome === 'desert' ? Ground.Sand : Ground.Grass;
        if (biome !== 'snow' && height[i] < 0.045) map.ground[i] = Ground.Sand;
        if (height[i] > 0.5 && Math.hypot(i % w - center.x, Math.floor(i / w) - center.y) > 10) {
            map.elev[i] = 1;
        }
    }

    cleanupSpecks(map);
    computeCliffs(map);

    const reachable = floodReachable(map, center);
    const occupied = new Uint8Array(w * h);
    const mark = (x: number, y: number, r: number) => {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (inBounds(map, x + dx, y + dy)) occupied[idx(map, x + dx, y + dy)] = 1;
            }
        }
    };
    mark(center.x, center.y, 4);

    const siteOk = (x: number, y: number, r: number): boolean => {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const tx = x + dx;
                const ty = y + dy;
                if (!inBounds(map, tx, ty)) return false;
                const i = idx(map, tx, ty);
                if (!reachable[i] || occupied[i] || map.elev[i] || map.cliff[i]) return false;
            }
        }
        return true;
    };

    const allSites: Site[] = [];
    const farEnough = (x: number, y: number, min: number) => allSites.every((s) => Math.hypot(s.x - x, s.y - y) >= min);

    const findSite = (opts: { minR: number; maxR: number; biome?: BiomeId; spacing: number; clear: number }): Site | null => {
        for (let attempt = 0; attempt < 4000; attempt++) {
            const a = rng.range(0, Math.PI * 2);
            const r = rng.range(opts.minR, opts.maxR);
            const x = Math.round(center.x + Math.cos(a) * r);
            const y = Math.round(center.y + Math.sin(a) * r);
            if (!inBounds(map, x, y)) continue;
            const b = BIOME_IDS[map.biome[idx(map, x, y)]];
            if (opts.biome && b !== opts.biome) continue;
            if (b === 'water') continue;
            if (!siteOk(x, y, opts.clear) || !farEnough(x, y, opts.spacing)) continue;
            const site = { x, y, biome: b };
            allSites.push(site);
            mark(x, y, opts.clear + 1);
            return site;
        }
        return null;
    };

    const camps: Site[] = [];
    const villages: Site[] = [];
    const bandits: Site[] = [];

    // Independent villages are placed first because they need the most room.
    for (let i = 0; i < 3; i++) {
        const s = findSite({ minR: 28, maxR: 62, spacing: 24, clear: 5 }) ?? findSite({ minR: 22, maxR: 62, spacing: 16, clear: 4 });
        if (s) villages.push(s);
    }
    const first = findSite({ minR: 13, maxR: 20, spacing: 10, clear: 4 });
    if (first) camps.push(first);
    for (const biome of rng.shuffle<BiomeId>(['snow', 'desert', 'forest', 'grassland'])) {
        const s = findSite({ minR: 18, maxR: 58, biome, spacing: 20, clear: 4 });
        if (s) camps.push(s);
    }
    while (camps.length < 6) {
        const s = findSite({ minR: 18, maxR: 58, spacing: 18, clear: 4 });
        if (!s) break;
        camps.push(s);
    }
    for (let i = 0; i < 4; i++) {
        const s = findSite({ minR: 24, maxR: 60, spacing: 18, clear: 3 });
        if (s) bandits.push(s);
    }

    // Keep settlements out of the woods.
    const clearRadius = (s: Point, r: number) => {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (inBounds(map, s.x + dx, s.y + dy)) occupied[idx(map, s.x + dx, s.y + dy)] = 1;
            }
        }
    };
    camps.forEach((s) => clearRadius(s, 5));
    villages.forEach((s) => clearRadius(s, 7));
    bandits.forEach((s) => clearRadius(s, 4));

    const trees: (Point & { variant: number })[] = [];
    const gold: Point[] = [];
    const stone: Point[] = [];
    const taken = new Uint8Array(w * h);
    const free = (x: number, y: number) => {
        if (!inBounds(map, x, y)) return false;
        const i = idx(map, x, y);
        return map.ground[i] !== Ground.Water && !map.elev[i] && !map.cliff[i] && !occupied[i] && !taken[i];
    };

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (!free(x, y)) continue;
            const b = BIOME_IDS[map.biome[idx(map, x, y)]];
            const n = (treeNoise(x / 9, y / 9) + 1) / 2;
            const density = b === 'forest' ? 0.62 : b === 'grassland' ? 0.14 : b === 'snow' ? 0.3 : 0.03;
            if (n > 1 - density && rng.chance(0.75)) {
                trees.push({ x, y, variant: b === 'snow' ? rng.int(0, 1) : rng.int(0, 3) });
                taken[idx(map, x, y)] = 1;
            }
        }
    }

    const scatterClusters = (list: Point[], count: number, prefer: (b: BiomeId, x: number, y: number) => number) => {
        let placed = 0;
        for (let attempt = 0; attempt < count * 80 && placed < count; attempt++) {
            const x = rng.int(3, w - 4);
            const y = rng.int(3, h - 4);
            if (!free(x, y) || !reachable[idx(map, x, y)]) continue;
            if (!rng.chance(prefer(BIOME_IDS[map.biome[idx(map, x, y)]], x, y))) continue;
            const size = rng.int(2, 4);
            for (let k = 0; k < size; k++) {
                const tx = x + rng.int(-1, 1);
                const ty = y + rng.int(-1, 1);
                if (free(tx, ty)) {
                    list.push({ x: tx, y: ty });
                    taken[idx(map, tx, ty)] = 1;
                }
            }
            placed++;
        }
    };

    const nearHighland = (x: number, y: number) => {
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                if (inBounds(map, x + dx, y + dy) && map.elev[idx(map, x + dx, y + dy)]) return true;
            }
        }
        return false;
    };
    scatterClusters(gold, 22, (b, x, y) => (nearHighland(x, y) ? 0.9 : b === 'desert' ? 0.6 : 0.25));
    scatterClusters(stone, 30, (b, x, y) => (nearHighland(x, y) ? 0.9 : b === 'snow' ? 0.6 : 0.3));

    // Make sure every settlement has something to mine within reach.
    const ensureNear = (list: Point[], s: Point) => {
        if (list.some((p) => Math.hypot(p.x - s.x, p.y - s.y) < 14)) return;
        for (let attempt = 0; attempt < 200; attempt++) {
            const x = s.x + rng.int(-11, 11);
            const y = s.y + rng.int(-11, 11);
            if (Math.hypot(x - s.x, y - s.y) < 6 || !free(x, y) || !reachable[idx(map, x, y)]) continue;
            list.push({ x, y });
            taken[idx(map, x, y)] = 1;
            if (free(x + 1, y)) {
                list.push({ x: x + 1, y });
                taken[idx(map, x + 1, y)] = 1;
            }
            return;
        }
    };
    [...camps, ...villages].forEach((s) => {
        ensureNear(gold, s);
        ensureNear(stone, s);
    });

    const sheep: Point[] = [];
    const wolves: Point[] = [];
    const bears: Point[] = [];
    for (let attempt = 0; attempt < 3000; attempt++) {
        const x = rng.int(4, w - 5);
        const y = rng.int(4, h - 5);
        if (!free(x, y) || !reachable[idx(map, x, y)]) continue;
        const b = BIOME_IDS[map.biome[idx(map, x, y)]];
        const dCenter = Math.hypot(x - center.x, y - center.y);
        if (b === 'grassland' && sheep.length < 40 && rng.chance(0.2)) {
            const herd = rng.int(2, 4);
            for (let k = 0; k < herd; k++) sheep.push({ x: x + rng.range(-1, 1), y: y + rng.range(-1, 1) });
        } else if ((b === 'forest' || b === 'snow') && dCenter > 16 && wolves.length < 18 && rng.chance(0.05)) {
            const pack = rng.int(2, 3);
            for (let k = 0; k < pack; k++) wolves.push({ x: x + rng.range(-1, 1), y: y + rng.range(-1, 1) });
        } else if ((b === 'forest' || b === 'snow') && dCenter > 22 && bears.length < 6 && rng.chance(0.02)) {
            bears.push({ x, y });
        }
    }

    map.decor = scatterDecor(map, rng, taken, occupied);
    return { map, trees, gold, stone, camps, villages, bandits, sheep, wolves, bears, center };
};

/** Removes single-tile islands, ponds and plateaus that the tile art can't draw nicely. */
const cleanupSpecks = (map: MapData) => {
    const { w, h } = map;
    for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = idx(map, x, y);
                const water = map.ground[i] === Ground.Water;
                let same = 0;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const tx = x + dx;
                    const ty = y + dy;
                    const otherWater = !inBounds(map, tx, ty) || map.ground[idx(map, tx, ty)] === Ground.Water;
                    if (otherWater === water) same++;
                }
                if (same <= 1) {
                    if (water) {
                        map.ground[i] = Ground.Grass;
                        map.biome[i] = biomeIndex('grassland');
                        const nb = neighbourLandBiome(map, x, y);
                        if (nb !== null) {
                            map.biome[i] = nb;
                            const b = BIOME_IDS[nb];
                            map.ground[i] = b === 'snow' ? Ground.Snow : b === 'desert' ? Ground.Sand : Ground.Grass;
                        }
                    } else {
                        map.ground[i] = Ground.Water;
                        map.biome[i] = biomeIndex('water');
                        map.elev[i] = 0;
                    }
                }
                if (map.elev[i]) {
                    let elevN = 0;
                    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const tx = x + dx;
                        const ty = y + dy;
                        if (inBounds(map, tx, ty) && map.elev[idx(map, tx, ty)]) elevN++;
                    }
                    const below = y + 1 < h ? idx(map, x, y + 1) : -1;
                    if (elevN <= 1 || map.ground[i] === Ground.Water || below < 0) map.elev[i] = 0;
                }
            }
        }
    }
};

const neighbourLandBiome = (map: MapData, x: number, y: number): number | null => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (inBounds(map, x + dx, y + dy)) {
            const b = map.biome[idx(map, x + dx, y + dy)];
            if (BIOME_IDS[b] !== 'water') return b;
        }
    }
    return null;
};

export const computeCliffs = (map: MapData) => {
    map.cliff.fill(0);
    for (let y = 0; y < map.h - 1; y++) {
        for (let x = 0; x < map.w; x++) {
            if (map.elev[idx(map, x, y)] && !map.elev[idx(map, x, y + 1)]) map.cliff[idx(map, x, y + 1)] = 1;
        }
    }
};

const floodReachable = (map: MapData, start: Point): Uint8Array => {
    const seen = new Uint8Array(map.w * map.h);
    const stack = [idx(map, start.x, start.y)];
    seen[stack[0]] = 1;
    while (stack.length) {
        const i = stack.pop()!;
        const x = i % map.w;
        const y = Math.floor(i / map.w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const tx = x + dx;
            const ty = y + dy;
            if (!inBounds(map, tx, ty)) continue;
            const j = idx(map, tx, ty);
            if (seen[j] || map.ground[j] === Ground.Water || map.elev[j] || map.cliff[j]) continue;
            seen[j] = 1;
            stack.push(j);
        }
    }
    return seen;
};

const scatterDecor = (map: MapData, rng: Rng, taken: Uint8Array, occupied: Uint8Array): Decoration[] => {
    const decor: Decoration[] = [];
    for (let y = 1; y < map.h - 1; y++) {
        for (let x = 1; x < map.w - 1; x++) {
            const i = idx(map, x, y);
            if (map.ground[i] === Ground.Water) {
                const coast = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
                    ([dx, dy]) => map.ground[idx(map, x + dx, y + dy)] !== Ground.Water
                );
                if (!coast && rng.chance(0.012)) decor.push({ x, y, kind: 'waterRock', variant: rng.int(0, 3) });
                continue;
            }
            if (map.elev[i] || map.cliff[i] || taken[i] || occupied[i]) continue;
            const b = BIOME_IDS[map.biome[i]];
            const r = rng.next();
            if (b === 'desert') {
                if (r < 0.02) decor.push({ x, y, kind: 'bone', variant: rng.int(0, 1) });
                else if (r < 0.05) decor.push({ x, y, kind: 'rock', variant: rng.int(0, 3) });
            } else if (b === 'snow') {
                if (r < 0.04) decor.push({ x, y, kind: 'rock', variant: rng.int(0, 3) });
            } else if (r < 0.035) decor.push({ x, y, kind: 'bush', variant: rng.int(0, 3) });
            else if (r < 0.06) decor.push({ x, y, kind: 'grass', variant: rng.int(0, 1) });
            else if (r < 0.07) decor.push({ x, y, kind: 'mushroom', variant: rng.int(0, 2) });
            else if (r < 0.08) decor.push({ x, y, kind: 'rock', variant: rng.int(0, 3) });
        }
    }
    return decor;
};
