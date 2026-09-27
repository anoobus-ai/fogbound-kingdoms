import type { BuildingKind, NeedId, ResourceType, Stock, TechId, UnitKind } from '../sim/types';

export type BuildCategory = 'core' | 'economy' | 'military' | 'grand' | 'terrain' | 'hidden';

export interface BuildingDef {
    name: string;
    description: string;
    category: BuildCategory;
    w: number;
    h: number;
    hp: number;
    cost: Partial<Stock>;
    buildTime: number;
    popCap: number;
    trains: UnitKind[];
    researches: TechId[];
    dropoff: ResourceType[];
    vision: number;
    attack?: { damage: number; range: number; cooldown: number };
    /** How much this building satisfies each village need. */
    satisfies: Partial<Record<NeedId, number>>;
    /** Grand projects are what villagers call "too expensive". */
    grand?: boolean;
    blocksMovement: boolean;
    requiresTech?: TechId;
}

const base = {
    popCap: 0,
    trains: [] as UnitKind[],
    researches: [] as TechId[],
    dropoff: [] as ResourceType[],
    vision: 4,
    satisfies: {},
    blocksMovement: true
};

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
    townCenter: {
        ...base,
        name: 'Town Center',
        description: 'The heart of a village. Trains villagers and caravans, stores every resource.',
        category: 'core',
        w: 5,
        h: 3,
        hp: 1400,
        cost: { wood: 400, stone: 100 },
        buildTime: 40,
        popCap: 5,
        trains: ['pawn', 'caravan'],
        researches: ['wheelbarrow', 'sharpAxes', 'cropRotation', 'irrigation', 'masonry', 'goldPanning'],
        dropoff: ['food', 'wood', 'gold', 'stone'],
        vision: 8,
        attack: { damage: 6, range: 6, cooldown: 2 },
        satisfies: { safety: 15, warmth: 10 }
    },
    house: {
        ...base,
        name: 'House',
        description: 'Room for 5 more people. Keeps villagers warm in the cold.',
        category: 'economy',
        w: 2,
        h: 2,
        hp: 300,
        cost: { wood: 50 },
        buildTime: 14,
        popCap: 5,
        satisfies: { warmth: 8 }
    },
    farm: {
        ...base,
        name: 'Farm',
        description: 'Villagers work it for a steady supply of food. Yield depends on the land and season.',
        category: 'economy',
        w: 3,
        h: 3,
        hp: 150,
        cost: { wood: 60 },
        buildTime: 12,
        blocksMovement: false
    },
    lumberCamp: {
        ...base,
        name: 'Lumber Camp',
        description: 'A place to drop off wood close to the forest.',
        category: 'economy',
        w: 2,
        h: 2,
        hp: 250,
        cost: { wood: 80 },
        buildTime: 12,
        dropoff: ['wood']
    },
    mine: {
        ...base,
        name: 'Mining Camp',
        description: 'Drop-off point for gold and stone. Build it next to a deposit.',
        category: 'economy',
        w: 3,
        h: 2,
        hp: 300,
        cost: { wood: 80 },
        buildTime: 14,
        dropoff: ['gold', 'stone']
    },
    granary: {
        ...base,
        name: 'Granary',
        description: 'Stores food for the winter. Food can be dropped off here.',
        category: 'economy',
        w: 2,
        h: 2,
        hp: 350,
        cost: { wood: 100 },
        buildTime: 18,
        dropoff: ['food'],
        satisfies: { food: 15, warmth: 10 }
    },
    well: {
        ...base,
        name: 'Spring Well',
        description: 'Fresh water. Desert villages badly need one. Nearby farms grow better.',
        category: 'economy',
        w: 1,
        h: 1,
        hp: 200,
        cost: { wood: 40, stone: 30 },
        buildTime: 14,
        satisfies: { water: 45 }
    },
    market: {
        ...base,
        name: 'Market',
        description: 'Brings wealth. Slowly earns gold and makes trade caravans more profitable.',
        category: 'economy',
        w: 3,
        h: 2,
        hp: 400,
        cost: { wood: 180, gold: 30 },
        buildTime: 25,
        satisfies: { wealth: 35 }
    },
    barracks: {
        ...base,
        name: 'Barracks',
        description: 'Trains Militia, Warriors and Lancers.',
        category: 'military',
        w: 3,
        h: 2,
        hp: 600,
        cost: { wood: 150 },
        buildTime: 25,
        trains: ['militia', 'warrior', 'lancer'],
        researches: ['ironArmor'],
        satisfies: { safety: 12 }
    },
    archery: {
        ...base,
        name: 'Archery Range',
        description: 'Trains Archers.',
        category: 'military',
        w: 3,
        h: 2,
        hp: 500,
        cost: { wood: 150 },
        buildTime: 22,
        trains: ['archer'],
        researches: ['fletching'],
        satisfies: { safety: 8 }
    },
    monastery: {
        ...base,
        name: 'Monastery',
        description: 'Trains Monks and gives villagers a place of faith.',
        category: 'military',
        w: 3,
        h: 2,
        hp: 500,
        cost: { wood: 180, gold: 40 },
        buildTime: 28,
        trains: ['monk'],
        researches: ['herbalism'],
        satisfies: { faith: 70 }
    },
    tower: {
        ...base,
        name: 'Watch Tower',
        description: 'Shoots arrows at enemies and sees far.',
        category: 'military',
        w: 2,
        h: 2,
        hp: 600,
        cost: { wood: 100, stone: 60 },
        buildTime: 22,
        vision: 9,
        attack: { damage: 8, range: 7, cooldown: 1.5 },
        satisfies: { safety: 18 }
    },
    wall: {
        ...base,
        name: 'Stone Wall',
        description: 'Blocks everyone. Keeps predators and raiders out.',
        category: 'military',
        w: 1,
        h: 1,
        hp: 400,
        cost: { stone: 6, wood: 2 },
        buildTime: 4,
        vision: 2,
        satisfies: { safety: 1.2 }
    },
    gate: {
        ...base,
        name: 'Gate',
        description: 'A wall piece that lets your own people through.',
        category: 'military',
        w: 1,
        h: 1,
        hp: 450,
        cost: { stone: 20, wood: 10 },
        buildTime: 8,
        vision: 2,
        satisfies: { safety: 2 }
    },
    garden: {
        ...base,
        name: 'Garden',
        description: 'Flowers, pumpkins and bushes. Makes the village beautiful.',
        category: 'grand',
        w: 2,
        h: 2,
        hp: 100,
        cost: { wood: 40, gold: 20 },
        buildTime: 10,
        satisfies: { beauty: 22 },
        blocksMovement: false
    },
    oasis: {
        ...base,
        name: 'Oasis',
        description: 'A lush pool of water. Beautiful and life-giving, but costly.',
        category: 'grand',
        w: 3,
        h: 3,
        hp: 500,
        cost: { wood: 150, gold: 150, stone: 60 },
        buildTime: 40,
        satisfies: { water: 70, beauty: 40 },
        grand: true
    },
    palace: {
        ...base,
        name: 'Gold Palace',
        description: 'A glittering golden palace. Houses 10 and dazzles visitors. Very expensive.',
        category: 'grand',
        w: 5,
        h: 3,
        hp: 2000,
        cost: { wood: 400, gold: 350, stone: 200 },
        buildTime: 90,
        popCap: 10,
        vision: 8,
        satisfies: { beauty: 45, wealth: 45, safety: 10 },
        grand: true
    },
    road: {
        ...base,
        name: 'Road',
        description: 'Units walk 40% faster on roads.',
        category: 'terrain',
        w: 1,
        h: 1,
        hp: 50,
        cost: { stone: 2 },
        buildTime: 2,
        vision: 1,
        blocksMovement: false
    },
    pond: {
        ...base,
        name: 'Dig Pond',
        description: 'Turn land into water. Farms near water grow better.',
        category: 'terrain',
        w: 1,
        h: 1,
        hp: 50,
        cost: { wood: 10 },
        buildTime: 6,
        vision: 1,
        satisfies: { water: 4 },
        blocksMovement: false
    },
    landfill: {
        ...base,
        name: 'Landfill',
        description: 'Fill in shallow water to make new land.',
        category: 'terrain',
        w: 1,
        h: 1,
        hp: 50,
        cost: { stone: 15, wood: 5 },
        buildTime: 6,
        vision: 1,
        blocksMovement: false
    },
    sapling: {
        ...base,
        name: 'Plant Tree',
        description: 'Plant a sapling that grows into a tree. Nature lovers appreciate it.',
        category: 'terrain',
        w: 1,
        h: 1,
        hp: 20,
        cost: { food: 5 },
        buildTime: 3,
        vision: 1,
        satisfies: { beauty: 0.5 },
        blocksMovement: false
    },
    campHut: {
        ...base,
        name: 'Camp Hut',
        description: 'A humble shelter.',
        category: 'hidden',
        w: 2,
        h: 2,
        hp: 250,
        cost: { wood: 40 },
        buildTime: 10,
        popCap: 4,
        dropoff: ['food', 'wood', 'gold', 'stone'],
        satisfies: { warmth: 6 }
    },
    goblinHut: {
        ...base,
        name: 'Goblin Hut',
        description: 'Home of raiders.',
        category: 'hidden',
        w: 2,
        h: 2,
        hp: 350,
        cost: {},
        buildTime: 10
    },
    goblinTower: {
        ...base,
        name: 'Goblin Watchtower',
        description: 'Raiders keep watch from here.',
        category: 'hidden',
        w: 3,
        h: 2,
        hp: 500,
        cost: {},
        buildTime: 10,
        attack: { damage: 6, range: 6, cooldown: 1.8 }
    }
};

export const BUILD_MENU: Record<Exclude<BuildCategory, 'hidden' | 'core'>, BuildingKind[]> = {
    economy: ['house', 'farm', 'lumberCamp', 'mine', 'granary', 'well', 'market'],
    military: ['barracks', 'archery', 'monastery', 'tower', 'wall', 'gate'],
    grand: ['garden', 'oasis', 'palace'],
    terrain: ['road', 'pond', 'landfill', 'sapling']
};

export const isTerraform = (kind: BuildingKind): boolean => BUILDINGS[kind].category === 'terrain';
