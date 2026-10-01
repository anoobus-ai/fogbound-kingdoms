import type { GameState } from './state';
import { Sim } from './sim';

const TYPED_KEYS = ['ground', 'biome', 'elev', 'cliff', 'road'] as const;
const SLOT_PREFIX = 'fogbound-save-';

const encodeBytes = (a: Uint8Array): string => {
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
    return btoa(s);
};

const decodeBytes = (s: string): Uint8Array => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
};

export const serialize = (state: GameState): string => {
    const { map } = state;
    const mapOut: Record<string, unknown> = { w: map.w, h: map.h, decor: map.decor, version: map.version };
    for (const k of TYPED_KEYS) mapOut[k] = encodeBytes(map[k]);
    return JSON.stringify({ ...state, map: mapOut, explored: encodeBytes(state.explored), requests: [] });
};

export const deserialize = (json: string): Sim => {
    const raw = JSON.parse(json);
    if (raw.version !== 1) throw new Error('This save file is from an incompatible version.');
    const m = raw.map;
    const map = {
        w: m.w,
        h: m.h,
        decor: m.decor,
        version: (m.version ?? 0) + 1,
        block: new Int32Array(m.w * m.h),
        ground: decodeBytes(m.ground),
        biome: decodeBytes(m.biome),
        elev: decodeBytes(m.elev),
        cliff: decodeBytes(m.cliff),
        road: decodeBytes(m.road)
    };
    const state: GameState = { ...raw, map, explored: decodeBytes(raw.explored) };
    if (typeof state.kingdom.heroName !== 'string') state.kingdom.heroName = '';
    if (typeof state.settings.pauseOnPopup !== 'boolean') state.settings.pauseOnPopup = true;
    for (const b of state.buildings) {
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) map.block[y * map.w + x] = b.id;
    }
    for (const r of state.resources) if (r.kind !== 'carcass') map.block[r.y * map.w + r.x] = r.id;
    return new Sim(state);
};

export interface SaveSlotInfo {
    slot: number;
    savedAt: string;
    day: number;
    villages: number;
}

export const saveToSlot = (sim: Sim, slot: number) => {
    const data = serialize(sim.state);
    localStorage.setItem(SLOT_PREFIX + slot, data);
    const info: SaveSlotInfo = {
        slot,
        savedAt: new Date().toLocaleString(),
        day: sim.day,
        villages: sim.state.villages.filter((v) => v.faction === 'kingdom').length
    };
    localStorage.setItem(`${SLOT_PREFIX}${slot}-info`, JSON.stringify(info));
};

export const loadFromSlot = (slot: number): Sim | null => {
    const data = localStorage.getItem(SLOT_PREFIX + slot);
    return data ? deserialize(data) : null;
};

export const slotInfo = (slot: number): SaveSlotInfo | null => {
    const raw = localStorage.getItem(`${SLOT_PREFIX}${slot}-info`);
    return raw ? (JSON.parse(raw) as SaveSlotInfo) : null;
};
