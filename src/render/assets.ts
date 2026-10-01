import Phaser from 'phaser';
import type { SoundId, TeamColor } from '../sim/types';

const FREE = 'assets/tiny-swords/free/';
const OLD = 'assets/tiny-swords/old/';

export const assetUrl = (path: string): string => encodeURI(path);
export const freeUrl = (path: string): string => assetUrl(FREE + path);
export const oldUrl = (path: string): string => assetUrl(OLD + path);

export const TEAM_COLORS: TeamColor[] = ['Blue', 'Red', 'Purple', 'Yellow', 'Black'];

interface SheetDef {
    key: string;
    url: string;
    frameWidth: number;
    frameHeight: number;
}

interface AnimDef {
    key: string;
    sheet: string;
    frames: number;
    start?: number;
    fps?: number;
    repeat?: number;
}

const sheets: SheetDef[] = [];
const images: { key: string; url: string }[] = [];
const anims: AnimDef[] = [];

const sheet = (key: string, url: string, frameWidth: number, frameHeight = frameWidth) => sheets.push({ key, url, frameWidth, frameHeight });
const anim = (key: string, sheetKey: string, frames: number, opts: Partial<AnimDef> = {}) =>
    anims.push({ key, sheet: sheetKey, frames, fps: 10, repeat: -1, ...opts });

// ---------- units (every team colour) ----------
for (const c of TEAM_COLORS) {
    const u = `Units/${c} Units/`;
    sheet(`warrior-idle-${c}`, freeUrl(`${u}Warrior/Warrior_Idle.png`), 192);
    sheet(`warrior-run-${c}`, freeUrl(`${u}Warrior/Warrior_Run.png`), 192);
    sheet(`warrior-attack-${c}`, freeUrl(`${u}Warrior/Warrior_Attack1.png`), 192);
    anim(`warrior-idle-${c}`, `warrior-idle-${c}`, 8);
    anim(`warrior-run-${c}`, `warrior-run-${c}`, 6);
    anim(`warrior-attack-${c}`, `warrior-attack-${c}`, 4, { fps: 12 });

    sheet(`archer-idle-${c}`, freeUrl(`${u}Archer/Archer_Idle.png`), 192);
    sheet(`archer-run-${c}`, freeUrl(`${u}Archer/Archer_Run.png`), 192);
    sheet(`archer-attack-${c}`, freeUrl(`${u}Archer/Archer_Shoot.png`), 192);
    anim(`archer-idle-${c}`, `archer-idle-${c}`, 6);
    anim(`archer-run-${c}`, `archer-run-${c}`, 4);
    anim(`archer-attack-${c}`, `archer-attack-${c}`, 8, { fps: 16 });

    sheet(`lancer-idle-${c}`, freeUrl(`${u}Lancer/Lancer_Idle.png`), 320);
    sheet(`lancer-run-${c}`, freeUrl(`${u}Lancer/Lancer_Run.png`), 320);
    sheet(`lancer-attack-${c}`, freeUrl(`${u}Lancer/Lancer_Right_Attack.png`), 320);
    anim(`lancer-idle-${c}`, `lancer-idle-${c}`, 12);
    anim(`lancer-run-${c}`, `lancer-run-${c}`, 6);
    anim(`lancer-attack-${c}`, `lancer-attack-${c}`, 3, { fps: 8 });

    sheet(`monk-idle-${c}`, freeUrl(`${u}Monk/Idle.png`), 192);
    sheet(`monk-run-${c}`, freeUrl(`${u}Monk/Run.png`), 192);
    sheet(`monk-heal-${c}`, freeUrl(`${u}Monk/Heal.png`), 192);
    anim(`monk-idle-${c}`, `monk-idle-${c}`, 6);
    anim(`monk-run-${c}`, `monk-run-${c}`, 4);
    anim(`monk-heal-${c}`, `monk-heal-${c}`, 11, { fps: 12 });

    const p = `${u}Pawn/Pawn_`;
    const pawnSheets: [string, string, number][] = [
        ['idle', 'Idle', 8],
        ['run', 'Run', 6],
        ['axe', 'Interact Axe', 6],
        ['pickaxe', 'Interact Pickaxe', 6],
        ['hammer', 'Interact Hammer', 3],
        ['knife', 'Interact Knife', 4],
        ['wood', 'Run Wood', 6],
        ['meat', 'Run Meat', 6],
        ['gold', 'Run Gold', 6],
        ['idleknife', 'Idle Knife', 8],
        ['runknife', 'Run Knife', 6]
    ];
    for (const [k, file, frames] of pawnSheets) {
        sheet(`pawn-${k}-${c}`, freeUrl(`${p}${file}.png`), 192);
        anim(`pawn-${k}-${c}`, `pawn-${k}-${c}`, frames);
    }
}

// ---------- goblins (CC0 old pack) ----------
sheet('goblin-torch', oldUrl('Factions/Goblins/Troops/Torch/Red/Torch_Red.png'), 192);
anim('goblinTorch-idle', 'goblin-torch', 7, { start: 0 });
anim('goblinTorch-run', 'goblin-torch', 6, { start: 7 });
anim('goblinTorch-attack', 'goblin-torch', 6, { start: 14, fps: 12 });
sheet('goblin-tnt', oldUrl('Factions/Goblins/Troops/TNT/Red/TNT_Red.png'), 192);
anim('goblinTnt-idle', 'goblin-tnt', 6, { start: 0 });
anim('goblinTnt-run', 'goblin-tnt', 6, { start: 7 });
anim('goblinTnt-attack', 'goblin-tnt', 7, { start: 14, fps: 12 });
sheet('goblin-barrel', oldUrl('Factions/Goblins/Troops/Barrel/Red/Barrel_Red.png'), 128);
anim('goblinBarrel-idle', 'goblin-barrel', 1, { start: 0 });
anim('goblinBarrel-run', 'goblin-barrel', 6, { start: 18 });
anim('goblinBarrel-attack', 'goblin-barrel', 3, { start: 30 });
sheet('dynamite', oldUrl('Factions/Goblins/Troops/TNT/Dynamite/Dynamite.png'), 64);
anim('dynamite', 'dynamite', 6, { fps: 16 });

// ---------- animals ----------
sheet('sheep-idle', freeUrl('Terrain/Resources/Meat/Sheep/Sheep_Idle.png'), 128);
sheet('sheep-move', freeUrl('Terrain/Resources/Meat/Sheep/Sheep_Move.png'), 128);
sheet('sheep-grass', freeUrl('Terrain/Resources/Meat/Sheep/Sheep_Grass.png'), 128);
anim('sheep-idle', 'sheep-idle', 6);
anim('sheep-run', 'sheep-move', 4);
anim('sheep-graze', 'sheep-grass', 12);
images.push({ key: 'wolf', url: 'assets/creatures/wolf.png' });
images.push({ key: 'bear', url: 'assets/creatures/bear.png' });
images.push({ key: 'polar-bear', url: 'assets/creatures/polar-bear.png' });

// ---------- buildings ----------
for (const c of TEAM_COLORS) {
    for (const b of ['Castle', 'House1', 'House2', 'House3', 'Tower', 'Barracks', 'Archery', 'Monastery']) {
        images.push({ key: `${b}-${c}`, url: freeUrl(`Buildings/${c} Buildings/${b}.png`) });
    }
}
images.push({ key: 'Palace', url: oldUrl('Factions/Knights/Buildings/Castle/Castle_Yellow.png') });
images.push({ key: 'Castle-construction', url: oldUrl('Factions/Knights/Buildings/Castle/Castle_Construction.png') });
images.push({ key: 'House-construction', url: oldUrl('Factions/Knights/Buildings/House/House_Construction.png') });
images.push({ key: 'Tower-construction', url: oldUrl('Factions/Knights/Buildings/Tower/Tower_Construction.png') });
images.push({ key: 'goblin-hut', url: oldUrl('Factions/Goblins/Buildings/Wood_House/Goblin_House.png') });
sheet('goblin-tower', oldUrl('Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_Red.png'), 256, 192);
anim('goblin-tower', 'goblin-tower', 4, { fps: 6 });
images.push({ key: 'gold-mine', url: oldUrl('Resources/Gold Mine/GoldMine_Active.png') });
sheet('bridge', oldUrl('Terrain/Bridge/Bridge_All.png'), 64);

// ---------- resources & decoration ----------
for (let i = 1; i <= 4; i++) {
    sheet(`tree${i}`, freeUrl(`Terrain/Resources/Wood/Trees/Tree${i}.png`), 192, i <= 2 ? 256 : 192);
    anim(`tree${i}`, `tree${i}`, 8, { fps: 6 });
    images.push({ key: `stump${i}`, url: freeUrl(`Terrain/Resources/Wood/Trees/Stump ${i}.png`) });
    images.push({ key: `rock${i}`, url: freeUrl(`Terrain/Decorations/Rocks/Rock${i}.png`) });
    sheet(`bush${i}`, freeUrl(`Terrain/Decorations/Bushes/Bushe${i}.png`), 128);
    anim(`bush${i}`, `bush${i}`, 8, { fps: 6 });
    sheet(`waterrock${i}`, freeUrl(`Terrain/Decorations/Rocks in the Water/Water Rocks_0${i}.png`), 64);
    anim(`waterrock${i}`, `waterrock${i}`, 16, { fps: 8 });
}
for (let i = 1; i <= 6; i++) images.push({ key: `goldstone${i}`, url: freeUrl(`Terrain/Resources/Gold/Gold Stones/Gold Stone ${i}.png`) });
for (let i = 1; i <= 18; i++) images.push({ key: `deco${i}`, url: oldUrl(`Deco/${String(i).padStart(2, '0')}.png`) });
images.push({ key: 'meat', url: freeUrl('Terrain/Resources/Meat/Meat Resource/Meat Resource.png') });
images.push({ key: 'wood-pile', url: oldUrl('Resources/Resources/W_Idle.png') });
images.push({ key: 'gold-pile', url: oldUrl('Resources/Resources/G_Idle.png') });
images.push({ key: 'meat-pile', url: oldUrl('Resources/Resources/M_Idle.png') });
for (let i = 1; i <= 4; i++) images.push({ key: `tool${i}`, url: freeUrl(`Terrain/Resources/Tools/Tool_0${i}.png`) });

// ---------- terrain ----------
for (let i = 1; i <= 5; i++) images.push({ key: `tilemap${i}`, url: freeUrl(`Terrain/Tileset/Tilemap_color${i}.png`) });
images.push({ key: 'tilemap-flat-old', url: oldUrl('Terrain/Ground/Tilemap_Flat.png') });
images.push({ key: 'tilemap-stone', url: oldUrl('Terrain/Ground/Tilemap_Elevation.png') });
images.push({ key: 'water', url: freeUrl('Terrain/Tileset/Water Background color.png') });
sheet('foam', freeUrl('Terrain/Tileset/Water Foam.png'), 192);
anim('foam', 'foam', 16, { fps: 8 });
images.push({ key: 'shadow', url: freeUrl('Terrain/Tileset/Shadow.png') });
for (let i = 1; i <= 8; i++) images.push({ key: `cloud${i}`, url: freeUrl(`Terrain/Decorations/Clouds/Clouds_0${i}.png`) });

// ---------- effects ----------
sheet('fx-dust', freeUrl('Particle FX/Dust_01.png'), 64);
anim('fx-dust', 'fx-dust', 8, { repeat: 0, fps: 14 });
sheet('fx-explosion', freeUrl('Particle FX/Explosion_01.png'), 192);
anim('fx-explosion', 'fx-explosion', 8, { repeat: 0, fps: 14 });
sheet('fx-fire', freeUrl('Particle FX/Fire_01.png'), 64);
anim('fx-fire', 'fx-fire', 8, { fps: 10 });
sheet('fx-heal', freeUrl('Units/Blue Units/Monk/Heal_Effect.png'), 192);
anim('fx-heal', 'fx-heal', 11, { repeat: 0, fps: 16 });
sheet('fx-dead', oldUrl('Factions/Knights/Troops/Dead/Dead.png'), 128);
anim('fx-dead', 'fx-dead', 14, { repeat: 0, fps: 10 });
images.push({ key: 'arrow', url: freeUrl('Units/Blue Units/Archer/Arrow.png') });


export const SOUND_FILES: Record<SoundId, string> = {
    click: 'click',
    select: 'select',
    command: 'command',
    chop: 'chop',
    mine: 'mine',
    build: 'build',
    complete: 'complete',
    sword: 'sword',
    bow: 'bow',
    hurt: 'hurt',
    death: 'death',
    explosion: 'explosion',
    coin: 'coin',
    bell: 'bell',
    horn: 'horn',
    heal: 'heal',
    error: 'error'
};

export const preloadAssets = (scene: Phaser.Scene) => {
    for (const s of sheets) scene.load.spritesheet(s.key, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    for (const i of images) scene.load.image(i.key, i.url);
    for (const [id, file] of Object.entries(SOUND_FILES)) scene.load.audio(`sfx-${id}`, `assets/sounds/${file}.ogg`);
    scene.load.audio('music-1', 'assets/music/peasantry.ogg');
    scene.load.audio('music-2', 'assets/music/medieval-fair.ogg');
};

export const createAnimations = (scene: Phaser.Scene) => {
    for (const a of anims) {
        if (scene.anims.exists(a.key)) continue;
        const start = a.start ?? 0;
        scene.anims.create({
            key: a.key,
            frames: scene.anims.generateFrameNumbers(a.sheet, { start, end: start + a.frames - 1 }),
            frameRate: a.fps ?? 10,
            repeat: a.repeat ?? -1
        });
    }
};
