import type { Stock, UnitKind } from '../sim/types';

export type UnitClass = 'hero' | 'worker' | 'soldier' | 'support' | 'civilian' | 'bandit' | 'animal';

export interface UnitDef {
    name: string;
    description: string;
    unitClass: UnitClass;
    hp: number;
    damage: number;
    /** Attack reach in tiles. Melee units are ~1. */
    range: number;
    cooldown: number;
    armor: number;
    /** Tiles per second. */
    speed: number;
    vision: number;
    cost: Partial<Stock>;
    trainTime: number;
    /** Damage multipliers against specific unit kinds. */
    bonusVs: Partial<Record<UnitKind, number>>;
    /** Multiplier when attacking buildings. */
    buildingDamage: number;
    splash?: number;
    /** Things that can be hunted give this much food as a carcass. */
    food?: number;
}

const soldierVision = 7;

export const UNITS: Record<UnitKind, UnitDef> = {
    explorer: {
        name: 'Explorer',
        description: 'Your hero. Strong in a fight and inspires nearby soldiers. Respawns when defeated.',
        unitClass: 'hero',
        hp: 260,
        damage: 18,
        range: 1.1,
        cooldown: 0.9,
        armor: 3,
        speed: 2.9,
        vision: 9,
        cost: {},
        trainTime: 0,
        bonusVs: { goblinTorch: 1.2, wolf: 1.3, bear: 1.3 },
        buildingDamage: 0.6
    },
    pawn: {
        name: 'Villager',
        description: 'Gathers wood, food, gold and stone, and constructs buildings.',
        unitClass: 'worker',
        hp: 40,
        damage: 3,
        range: 1,
        cooldown: 1.2,
        armor: 0,
        speed: 2.2,
        vision: 5,
        cost: { food: 50 },
        trainTime: 12,
        bonusVs: { sheep: 3 },
        buildingDamage: 0.3
    },
    militia: {
        name: 'Militia',
        description: 'Armed villagers. Cheap and quick to train, weak one-on-one. Strong in large groups.',
        unitClass: 'soldier',
        hp: 55,
        damage: 5,
        range: 1,
        cooldown: 1.0,
        armor: 0,
        speed: 2.4,
        vision: soldierVision - 1,
        cost: { food: 20 },
        trainTime: 6,
        bonusVs: { goblinBarrel: 1.5 },
        buildingDamage: 0.5
    },
    archer: {
        name: 'Archer',
        description: 'Shoots from range but is fragile. Beats Lancers; loses to Warriors that close in.',
        unitClass: 'soldier',
        hp: 50,
        damage: 7,
        range: 5.5,
        cooldown: 1.4,
        armor: 0,
        speed: 2.3,
        vision: soldierVision + 1,
        cost: { food: 45 },
        trainTime: 10,
        bonusVs: { lancer: 3, monk: 1.3 },
        buildingDamage: 0.25
    },
    warrior: {
        name: 'Warrior',
        description: 'Hits hard up close. Beats Archers and Militia; loses to Lancers.',
        unitClass: 'soldier',
        hp: 110,
        damage: 12,
        range: 1.1,
        cooldown: 1.0,
        armor: 2,
        speed: 2.5,
        vision: soldierVision,
        cost: { food: 55 },
        trainTime: 12,
        bonusVs: { archer: 1.7, militia: 1.6, goblinTnt: 1.5 },
        buildingDamage: 0.8
    },
    lancer: {
        name: 'Lancer',
        description: 'Tanky and slow with a long spear. Beats Warriors and heroes; loses to Archers.',
        unitClass: 'soldier',
        hp: 130,
        damage: 9,
        range: 1.4,
        cooldown: 1.3,
        armor: 4,
        speed: 1.9,
        vision: soldierVision,
        cost: { food: 65 },
        trainTime: 14,
        bonusVs: { warrior: 1.8, explorer: 1.8, bear: 1.5, goblinTorch: 1.3 },
        buildingDamage: 0.6
    },
    monk: {
        name: 'Monk',
        description: 'Heals nearby allies. Can slowly convert an enemy unit to your side.',
        unitClass: 'support',
        hp: 45,
        damage: 2,
        range: 4,
        cooldown: 1.5,
        armor: 0,
        speed: 2.1,
        vision: soldierVision,
        cost: { food: 80 },
        trainTime: 16,
        bonusVs: {},
        buildingDamage: 0
    },
    messenger: {
        name: 'Messenger',
        description: 'Carries your orders to a faraway village. Can be ambushed on the road.',
        unitClass: 'civilian',
        hp: 35,
        damage: 0,
        range: 1,
        cooldown: 1,
        armor: 0,
        speed: 3.3,
        vision: 5,
        cost: {},
        trainTime: 0,
        bonusVs: {},
        buildingDamage: 0
    },
    caravan: {
        name: 'Trade Caravan',
        description: 'Carries goods between friendly villages and earns gold on arrival.',
        unitClass: 'civilian',
        hp: 60,
        damage: 0,
        range: 1,
        cooldown: 1,
        armor: 1,
        speed: 2.0,
        vision: 5,
        cost: { food: 40, wood: 40 },
        trainTime: 10,
        bonusVs: {},
        buildingDamage: 0
    },
    goblinTorch: {
        name: 'Goblin Raider',
        description: 'A torch-wielding bandit. Sets buildings ablaze.',
        unitClass: 'bandit',
        hp: 70,
        damage: 9,
        range: 1.1,
        cooldown: 1.0,
        armor: 1,
        speed: 2.4,
        vision: 7,
        cost: { food: 40 },
        trainTime: 10,
        bonusVs: { pawn: 1.3 },
        buildingDamage: 1.4
    },
    goblinTnt: {
        name: 'Goblin Bomber',
        description: 'Throws dynamite from a distance. Hurts everything near the blast.',
        unitClass: 'bandit',
        hp: 45,
        damage: 12,
        range: 5,
        cooldown: 2.2,
        armor: 0,
        speed: 2.2,
        vision: 7,
        cost: { food: 50 },
        trainTime: 12,
        bonusVs: {},
        buildingDamage: 1.5,
        splash: 1.3
    },
    goblinBarrel: {
        name: 'Barrel Goblin',
        description: 'Runs at buildings and explodes.',
        unitClass: 'bandit',
        hp: 30,
        damage: 45,
        range: 0.9,
        cooldown: 1,
        armor: 0,
        speed: 2.7,
        vision: 7,
        cost: { food: 40 },
        trainTime: 10,
        bonusVs: {},
        buildingDamage: 2.5,
        splash: 1.6
    },
    sheep: {
        name: 'Sheep',
        description: 'Wanders the meadows. Hunt it for food.',
        unitClass: 'animal',
        hp: 20,
        damage: 0,
        range: 1,
        cooldown: 1,
        armor: 0,
        speed: 1.2,
        vision: 3,
        cost: {},
        trainTime: 0,
        bonusVs: {},
        buildingDamage: 0,
        food: 120
    },
    wolf: {
        name: 'Wolf',
        description: 'Hunts in packs, especially at night.',
        unitClass: 'animal',
        hp: 60,
        damage: 8,
        range: 1,
        cooldown: 0.9,
        armor: 0,
        speed: 3.0,
        vision: 6,
        cost: {},
        trainTime: 0,
        bonusVs: { sheep: 2, pawn: 1.3 },
        buildingDamage: 0,
        food: 60
    },
    bear: {
        name: 'Bear',
        description: 'Big, slow to anger and very dangerous.',
        unitClass: 'animal',
        hp: 160,
        damage: 16,
        range: 1.1,
        cooldown: 1.4,
        armor: 2,
        speed: 2.2,
        vision: 5,
        cost: {},
        trainTime: 0,
        bonusVs: {},
        buildingDamage: 0.4,
        food: 200
    }
};

/** The five trainable fighter types, in the order they appear in menus. */
export const FIGHTER_KINDS: readonly UnitKind[] = ['militia', 'archer', 'warrior', 'lancer', 'monk'];

export const isFighter = (kind: UnitKind): boolean => {
    const c = UNITS[kind].unitClass;
    return c === 'soldier' || c === 'hero' || c === 'bandit' || c === 'support';
};

export const isCitizenKind = (kind: UnitKind): boolean => {
    const c = UNITS[kind].unitClass;
    return c === 'worker' || c === 'soldier' || c === 'support';
};
