import type { AgendaId, Stock, TechId } from '../sim/types';

export interface TechDef {
    name: string;
    description: string;
    cost: Partial<Stock>;
    time: number;
    requires?: TechId;
}

export const TECHS: Record<TechId, TechDef> = {
    wheelbarrow: {
        name: 'Wheelbarrow',
        description: 'Villagers carry 50% more per trip.',
        cost: { food: 100, wood: 80 },
        time: 30
    },
    sharpAxes: {
        name: 'Sharp Axes',
        description: 'Wood is chopped 30% faster.',
        cost: { food: 80, wood: 60 },
        time: 25
    },
    cropRotation: {
        name: 'Crop Rotation',
        description: 'Farms produce 30% more food.',
        cost: { food: 60, wood: 120 },
        time: 30
    },
    irrigation: {
        name: 'Irrigation',
        description: 'Farms in deserts and snow produce 50% more food.',
        cost: { wood: 150, stone: 50 },
        time: 35,
        requires: 'cropRotation'
    },
    masonry: {
        name: 'Masonry',
        description: 'All buildings get 30% more health.',
        cost: { wood: 100, stone: 100 },
        time: 35
    },
    goldPanning: {
        name: 'Gold Panning',
        description: 'Gold and stone are mined 30% faster.',
        cost: { food: 100, wood: 100 },
        time: 30
    },
    ironArmor: {
        name: 'Iron Armor',
        description: 'Soldiers get +2 armor.',
        cost: { food: 150, gold: 50 },
        time: 40
    },
    fletching: {
        name: 'Fletching',
        description: 'Archers and towers shoot 1 tile farther and deal +2 damage.',
        cost: { food: 100, wood: 80, gold: 20 },
        time: 35
    },
    herbalism: {
        name: 'Herbalism',
        description: 'Monks heal 50% more and villages resist plague.',
        cost: { food: 120, gold: 60 },
        time: 35
    }
};

export interface AgendaDef {
    name: string;
    description: string;
}

export const AGENDAS: Record<AgendaId, AgendaDef> = {
    grandeur: { name: 'Grandeur', description: 'Palaces, oases and glittering monuments.' },
    military: { name: 'Military Might', description: 'A strong army that fears no one.' },
    expansion: { name: 'Expansion', description: 'Bring every village under your banner.' },
    prosperity: { name: 'Prosperity', description: 'Markets, trade and full coffers.' },
    faith: { name: 'Faith', description: 'Monasteries and spiritual peace.' },
    nature: { name: 'Harmony with Nature', description: 'Gardens, forests and clean water.' },
    safety: { name: 'Safety First', description: 'Walls, towers and watchful guards.' },
    frugality: { name: 'Frugality', description: 'Full granaries and no wasted coin.' }
};

export const MAX_AGENDA = 3;
