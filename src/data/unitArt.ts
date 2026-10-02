import { TILE } from './balance';
import type { UnitKind } from '../sim/types';

/**
 * Opaque bounds of each unit's idle frame, in frame pixels.
 * The sprite stands on `bottom`, the portrait is cropped to this box,
 * and clicks test the same box.
 */
export interface UnitArt {
    frame: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
    scale: number;
    /** Set when the sheet is a grid taller than one frame. */
    sheetW?: number;
    sheetH?: number;
}

const art = (
    frame: number,
    left: number,
    top: number,
    right: number,
    bottom: number,
    scale = 1,
    sheetW?: number,
    sheetH?: number
): UnitArt => ({ frame, left, top, right, bottom, scale, sheetW, sheetH });

export const UNIT_ART: Record<UnitKind, UnitArt> = {
    explorer: art(192, 62, 48, 140, 136, 1.42),
    warrior: art(192, 62, 48, 140, 136),
    archer: art(192, 58, 48, 127, 135),
    lancer: art(320, 115, 48, 183, 197),
    monk: art(192, 67, 65, 124, 133),
    militia: art(192, 69, 64, 130, 134),
    pawn: art(192, 69, 64, 120, 134),
    messenger: art(192, 69, 64, 120, 134, 0.9),
    caravan: art(192, 69, 64, 129, 134, 0.9),
    goblinTorch: art(192, 53, 54, 126, 132, 1, 1344, 960),
    goblinTnt: art(192, 58, 67, 143, 134, 1, 1344, 576),
    goblinBarrel: art(128, 39, 29, 88, 98, 1, 768, 768),
    sheep: art(128, 41, 40, 85, 83, 0.8),
    wolf: art(16, 0, 1, 15, 15, 2.8),
    bear: art(16, 0, 0, 15, 15, 3.4)
};

/** Sprite origin Y: the feet pixel sits on the unit's world position. */
export const unitOriginY = (kind: UnitKind): number => {
    const a = UNIT_ART[kind];
    return a.bottom / a.frame;
};

export interface UnitHit {
    /** Tiles above the feet where the body is drawn. */
    lift: number;
    halfW: number;
    halfH: number;
}

/** Hit box matching the drawn sprite, in tiles. */
export const unitHit = (kind: UnitKind): UnitHit => {
    const a = UNIT_ART[kind];
    const px = a.scale / TILE;
    const midY = (a.top + a.bottom) / 2;
    return {
        lift: (a.bottom - midY) * px,
        halfW: ((a.right - a.left) / 2) * px,
        halfH: ((a.bottom - a.top) / 2) * px
    };
};

/** CSS background size and position that centers this frame in a square portrait. */
export const portraitBackground = (kind: UnitKind, size: number): { size: string; position: string } => {
    const a = UNIT_ART[kind];
    const content = Math.max(a.right - a.left, a.bottom - a.top, 1);
    const k = (size * 0.88) / content;
    const cx = (a.left + a.right) / 2;
    const cy = (a.top + a.bottom) / 2;
    const sheetH = (a.sheetH ?? a.frame) * k;
    const sized = a.sheetW ? `${a.sheetW * k}px ${sheetH}px` : `auto ${sheetH}px`;
    return {
        size: sized,
        position: `${size / 2 - cx * k}px ${size / 2 - cy * k}px`
    };
};
