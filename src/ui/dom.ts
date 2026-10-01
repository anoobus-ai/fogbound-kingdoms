import { freeUrl, oldUrl } from '../render/assets';
import type { ResourceType, Stock, TeamColor, UnitKind } from '../sim/types';

export const esc = (s: string): string =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const UI = 'UI Elements/UI Elements/';

export const ICONS = {
    wood: freeUrl(`${UI}Icons/Icon_02.png`),
    gold: freeUrl(`${UI}Icons/Icon_03.png`),
    food: freeUrl(`${UI}Icons/Icon_04.png`),
    stone: freeUrl('Terrain/Decorations/Rocks/Rock1.png'),
    sword: freeUrl(`${UI}Icons/Icon_05.png`),
    shield: freeUrl(`${UI}Icons/Icon_06.png`),
    hammer: freeUrl(`${UI}Icons/Icon_01.png`),
    go: freeUrl(`${UI}Icons/Icon_07.png`),
    back: freeUrl(`${UI}Icons/Icon_08.png`),
    close: freeUrl(`${UI}Icons/Icon_09.png`),
    gear: freeUrl(`${UI}Icons/Icon_10.png`),
    info: freeUrl(`${UI}Icons/Icon_11.png`),
    music: freeUrl(`${UI}Icons/Icon_12.png`)
} as const;

export const avatarUrl = (n: number): string => freeUrl(`${UI}Human Avatars/Avatars_${String(n).padStart(2, '0')}.png`);

/** Bust portrait. The sheet has a lot of empty margin, so the frame crops in on the face. */
export const personAvatar = (n: number, small = false, title = ''): string =>
    `<span class="avatar${small ? ' sm' : ''}"${title ? ` title="${esc(title)}"` : ''}><img src="${avatarUrl(n)}" alt=""></span>`;

export const icon = (key: keyof typeof ICONS, cls = 'ico'): string => `<img class="${cls}" src="${ICONS[key]}" alt="${key}">`;

export const resIcon = (r: ResourceType): string => icon(r);

export const costHtml = (cost: Partial<Stock>): string =>
    (Object.entries(cost) as [ResourceType, number][])
        .filter(([, n]) => n > 0)
        .map(([r, n]) => `<span class="cost">${resIcon(r)}${n}</span>`)
        .join('');

/** First frame of a unit's idle animation, shown as a portrait. */
export const unitPortraitUrl = (kind: UnitKind, color: TeamColor): string => {
    const u = `Units/${color} Units/`;
    switch (kind) {
        case 'explorer':
            return freeUrl('Units/Yellow Units/Warrior/Warrior_Idle.png');
        case 'warrior':
            return freeUrl(`${u}Warrior/Warrior_Idle.png`);
        case 'archer':
            return freeUrl(`${u}Archer/Archer_Idle.png`);
        case 'lancer':
            return freeUrl(`${u}Lancer/Lancer_Idle.png`);
        case 'monk':
            return freeUrl(`${u}Monk/Idle.png`);
        case 'militia':
            return freeUrl(`${u}Pawn/Pawn_Idle Knife.png`);
        case 'pawn':
        case 'messenger':
            return freeUrl(`${u}Pawn/Pawn_Idle.png`);
        case 'caravan':
            return freeUrl(`${u}Pawn/Pawn_Idle Gold.png`);
        case 'goblinTorch':
            return encodeURI('assets/tiny-swords/old/Factions/Goblins/Troops/Torch/Red/Torch_Red.png');
        case 'goblinTnt':
            return encodeURI('assets/tiny-swords/old/Factions/Goblins/Troops/TNT/Red/TNT_Red.png');
        case 'goblinBarrel':
            return encodeURI('assets/tiny-swords/old/Factions/Goblins/Troops/Barrel/Red/Barrel_Red.png');
        case 'sheep':
            return freeUrl('Terrain/Resources/Meat/Sheep/Sheep_Idle.png');
        case 'wolf':
            return 'assets/creatures/wolf.png';
        case 'bear':
            return 'assets/creatures/bear.png';
        default: {
            const never: never = kind;
            throw new Error(`Unknown unit ${String(never)}`);
        }
    }
};

/** Portrait box showing the first square frame of a horizontal sprite sheet. */
export const unitPortrait = (kind: UnitKind, color: TeamColor, size = 64): string => {
    const lancer = kind === 'lancer';
    const pixel = kind === 'wolf' || kind === 'bear';
    const zoom = pixel ? 1 : kind === 'explorer' ? 2.7 : lancer ? 2.4 : kind === 'goblinBarrel' ? 1.3 : 2;
    const style = pixel
        ? `background-image:url('${unitPortraitUrl(kind, color)}');background-size:contain;background-repeat:no-repeat;background-position:center;image-rendering:pixelated`
        : `background-image:url('${unitPortraitUrl(kind, color)}');background-size:auto ${size * zoom}px;background-position:${-(size * (zoom - 1)) / 2}px ${-(size * (zoom - 1)) / 2 - size * 0.08}px;background-repeat:no-repeat`;
    return `<div class="portrait" style="width:${size}px;height:${size}px;${style}"></div>`;
};

export const bar = (value: number, color: string, label = '', className = ''): string => {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    return `<div class="meter${className ? ` ${className}` : ''}" title="${esc(label)}"><div class="meter-fill" style="width:${pct}%;background:${color}"></div><span>${esc(label)}</span></div>`;
};

/**
 * Swap in new markup without recreating nodes that are already the same.
 * Replacing the whole panel reloads the portrait images and they blink.
 */
export const setHtml = (host: HTMLElement, html: string): void => {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    morphChildren(host, tpl.content);
};

const compatible = (have: Node, want: Node): boolean => {
    if (have.nodeType !== want.nodeType) return false;
    if (have instanceof Element && want instanceof Element) return have.tagName === want.tagName;
    return true;
};

const syncAttrs = (have: Element, want: Element) => {
    const focused = have instanceof HTMLInputElement && document.activeElement === have;
    for (const name of have.getAttributeNames()) {
        if (!want.hasAttribute(name)) have.removeAttribute(name);
    }
    for (const name of want.getAttributeNames()) {
        if (focused && name === 'value') continue;
        const value = want.getAttribute(name);
        if (value !== null && have.getAttribute(name) !== value) have.setAttribute(name, value);
    }
    if (have instanceof HTMLInputElement && want instanceof HTMLInputElement && !focused && have.value !== want.value) have.value = want.value;
};

const morphChildren = (current: Node, next: Node) => {
    const have = Array.from(current.childNodes);
    const want = Array.from(next.childNodes);
    const n = Math.max(have.length, want.length);
    for (let i = 0; i < n; i++) {
        const a = have[i];
        const b = want[i];
        if (!b) {
            a?.remove();
            continue;
        }
        if (!a || !compatible(a, b)) {
            const fresh = b.cloneNode(true);
            if (a) a.replaceWith(fresh);
            else current.appendChild(fresh);
            continue;
        }
        if (a.nodeType === Node.TEXT_NODE) {
            if (a.textContent !== b.textContent) a.textContent = b.textContent;
            continue;
        }
        if (a instanceof Element && b instanceof Element) {
            syncAttrs(a, b);
            morphChildren(a, b);
            continue;
        }
        a.replaceWith(b.cloneNode(true));
    }
};

/** Vivid red, hotter once wounded, and still red when nearly dead. */
export const healthColor = (pct: number): string => (pct > 65 ? '#ff1f1f' : pct > 35 ? '#ff5a22' : '#ff2a1a');
export const moodColor = (v: number): string => (v >= 65 ? '#5fd35a' : v >= 40 ? '#e8c547' : '#e0463c');
export const unrestColor = (v: number): string => (v >= 75 ? '#e0463c' : v >= 45 ? '#e89a3c' : '#5fd35a');

/** Re-packs a Tiny Swords 9-slice sheet (pieces separated by gaps) into a tight image CSS can stretch. */
const compactNineSlice = (url: string, cut: number, mid: [number, number], end: number): Promise<string> =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const midW = mid[1] - mid[0];
            const size = cut * 2 + midW;
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const ctx = c.getContext('2d')!;
            const xs: [number, number, number][] = [
                [0, cut, 0],
                [mid[0], midW, cut],
                [end - cut, cut, cut + midW]
            ];
            for (const [sy, sh, dy] of xs) {
                for (const [sx, sw, dx] of xs) ctx.drawImage(img, sx, sy, sw, sh, dx, dy, sw, sh);
            }
            resolve(c.toDataURL());
        };
        img.onerror = () => resolve('');
        img.src = url;
    });

const loadImage = (url: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });

/**
 * Turns the vertical banner illustration into a 9-slice scroll:
 * rolled caps stay fixed, the parchment center stretches.
 * Slice is 36px top, 26px sides, 30px bottom.
 */
const scrollNineSlice = (img: HTMLImageElement): string => {
    const corner = 26;
    const topH = 36;
    const botH = 30;
    const mid = 24;
    const srcX = 36;
    const srcW = 120;
    const W = corner * 2 + mid;
    const H = topH + mid + botH;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#cdc69a';
    ctx.fillRect(12, topH - 4, W - 24, mid + 8);
    const drawBar = (sy: number, sh: number, dy: number, dh: number) => {
        ctx.drawImage(img, srcX, sy, corner, sh, 0, dy, corner, dh);
        ctx.drawImage(img, srcX + Math.floor(srcW / 2) - 2, sy, 4, sh, corner, dy, mid, dh);
        ctx.drawImage(img, srcX + srcW - corner, sy, corner, sh, corner + mid, dy, corner, dh);
    };
    drawBar(30, topH, 0, topH);
    drawBar(132, botH, topH + mid, botH);
    ctx.drawImage(img, 47, 80, 5, 12, 11, topH, 5, mid);
    ctx.drawImage(img, 140, 80, 5, 12, W - 16, topH, 5, mid);
    return c.toDataURL();
};

export const installNineSlices = async () => {
    const root = document.documentElement.style;
    const set = async (name: string, path: string, cut: number, mid: [number, number], end: number) => {
        const data = await compactNineSlice(freeUrl(`${UI}${path}`), cut, mid, end);
        if (data) root.setProperty(name, `url(${data})`);
    };
    const scrollPromise = loadImage(oldUrl('UI/Banners/Banner_Vertical.png')).then((img) => {
        if (!img) return;
        const data = scrollNineSlice(img);
        if (data) root.setProperty('--scroll', `url(${data})`);
    });
    await Promise.all([
        set('--paper', 'Papers/RegularPaper.png', 64, [128, 192], 320),
        set('--paper-special', 'Papers/SpecialPaper.png', 64, [128, 192], 320),
        set('--wood', 'Wood Table/WoodTable.png', 128, [192, 256], 448),
        set('--banner', 'Banners/Banner.png', 128, [192, 256], 448),
        set('--btn-blue', 'Buttons/BigBlueButton_Regular.png', 64, [128, 192], 320),
        set('--btn-blue-down', 'Buttons/BigBlueButton_Pressed.png', 64, [128, 192], 320),
        set('--btn-red', 'Buttons/BigRedButton_Regular.png', 64, [128, 192], 320),
        set('--btn-red-down', 'Buttons/BigRedButton_Pressed.png', 64, [128, 192], 320),
        scrollPromise
    ]);
};

/** Same hotspot as the arrow, so the hand swaps in place instead of jumping to the system pointer. */
export const cursorCss = (): string => `url('${freeUrl(`${UI}Cursors/Cursor_01.png`)}') 8 4, default`;
export const handCursorCss = (): string => `url('${freeUrl(`${UI}Cursors/Cursor_02.png`)}') 8 4, pointer`;
export const denyCursorCss = (): string => `url('${freeUrl(`${UI}Cursors/Cursor_03.png`)}') 31 30, not-allowed`;
