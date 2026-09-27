import { BIOME_IDS, Ground, type BiomeId } from './types';

export interface Decoration {
    x: number;
    y: number;
    kind: 'bush' | 'rock' | 'mushroom' | 'grass' | 'pumpkin' | 'bone' | 'waterRock';
    variant: number;
}

export interface MapData {
    w: number;
    h: number;
    ground: Uint8Array;
    biome: Uint8Array;
    /** 1 = raised highland plateau (impassable). */
    elev: Uint8Array;
    /** 1 = cliff face drawn below a plateau edge (impassable). */
    cliff: Uint8Array;
    road: Uint8Array;
    /** 0 = free, otherwise the id of the building or resource standing on the tile. */
    block: Int32Array;
    decor: Decoration[];
    /** Bumped whenever terrain changes so the renderer knows to redraw. */
    version: number;
}

export const createMap = (w: number, h: number): MapData => ({
    w,
    h,
    ground: new Uint8Array(w * h),
    biome: new Uint8Array(w * h),
    elev: new Uint8Array(w * h),
    cliff: new Uint8Array(w * h),
    road: new Uint8Array(w * h),
    block: new Int32Array(w * h),
    decor: [],
    version: 0
});

export const idx = (map: MapData, x: number, y: number): number => y * map.w + x;

export const inBounds = (map: MapData, x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.w && y < map.h;

export const isWater = (map: MapData, x: number, y: number): boolean =>
    !inBounds(map, x, y) || map.ground[idx(map, x, y)] === Ground.Water;

/** Land a building could stand on: not water, not highland, not a cliff. */
export const isBuildableTerrain = (map: MapData, x: number, y: number): boolean => {
    if (!inBounds(map, x, y)) return false;
    const i = idx(map, x, y);
    return map.ground[i] !== Ground.Water && map.elev[i] === 0 && map.cliff[i] === 0;
};

export const biomeAt = (map: MapData, x: number, y: number): BiomeId => {
    const cx = Math.max(0, Math.min(map.w - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(map.h - 1, Math.floor(y)));
    return BIOME_IDS[map.biome[idx(map, cx, cy)]];
};
