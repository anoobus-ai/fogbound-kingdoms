import type { BiomeId, NeedId } from '../sim/types';

export interface BiomeDef {
    name: string;
    description: string;
    farmYield: number;
    /** Extra farm penalty in winter (multiplied on top of farmYield). */
    winterFarm: number;
    foodUse: number;
    /** Base importance of each need for villages living here. */
    needWeights: Record<NeedId, number>;
    minimapColor: number;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
    water: {
        name: 'Water',
        description: '',
        farmYield: 0,
        winterFarm: 0,
        foodUse: 1,
        needWeights: { food: 0, shelter: 0, safety: 0, water: 0, faith: 0, wealth: 0, beauty: 0, warmth: 0 },
        minimapColor: 0x3f8fa8
    },
    grassland: {
        name: 'Grassy Hills',
        description: 'Gentle hills where farms grow easily. Food is rarely a worry, so people dream of beauty and wealth.',
        farmYield: 1.5,
        winterFarm: 0.5,
        foodUse: 1,
        needWeights: { food: 0.7, shelter: 1, safety: 0.6, water: 0.2, faith: 0.6, wealth: 1, beauty: 1.1, warmth: 0.2 },
        minimapColor: 0x86b04a
    },
    forest: {
        name: 'Deep Forest',
        description: 'Endless wood, but wolves and bears prowl between the trees. People here want walls.',
        farmYield: 0.9,
        winterFarm: 0.4,
        foodUse: 1,
        needWeights: { food: 1, shelter: 1, safety: 1.4, water: 0.2, faith: 0.7, wealth: 0.6, beauty: 0.5, warmth: 0.5 },
        minimapColor: 0x4e7d3a
    },
    snow: {
        name: 'Snowy Mountains',
        description: 'Cold and harsh. Farms barely grow and winter is deadly. Food stores and warm homes come first.',
        farmYield: 0.45,
        winterFarm: 0.1,
        foodUse: 1.35,
        needWeights: { food: 1.6, shelter: 1.2, safety: 0.8, water: 0.1, faith: 0.8, wealth: 0.4, beauty: 0.3, warmth: 1.6 },
        minimapColor: 0xdfe8ee
    },
    desert: {
        name: 'Dry Desert',
        description: 'Hot sand and little water. Wells and oases decide whether a village thrives.',
        farmYield: 0.55,
        winterFarm: 0.9,
        foodUse: 1.1,
        needWeights: { food: 1.1, shelter: 0.8, safety: 0.8, water: 1.8, faith: 0.8, wealth: 0.9, beauty: 0.6, warmth: 0 },
        minimapColor: 0xe0c26a
    }
};

export const NEED_LABELS: Record<NeedId, string> = {
    food: 'Food',
    shelter: 'Shelter',
    safety: 'Safety',
    water: 'Water',
    faith: 'Faith',
    wealth: 'Wealth',
    beauty: 'Beauty',
    warmth: 'Warmth'
};
