import type { AgendaId, BuildingKind, NeedId, TraitId } from '../sim/types';

export interface TraitDef {
    name: string;
    description: string;
    /** How much people with this trait care about each need (added to the biome weight). */
    needs: Partial<Record<NeedId, number>>;
    /** How they feel about particular buildings: positive likes, negative dislikes. */
    likes: Partial<Record<BuildingKind, number>>;
    /** How they feel about each of the player's agenda goals. */
    agenda: Partial<Record<AgendaId, number>>;
    /** Leader behaviour: chance modifier to ignore the people's vote. */
    ignoresVotes: number;
    /** Leader behaviour: chance modifier to obey the player's messengers. */
    obeys: number;
    workSpeed: number;
    /** -1 hates war, +1 loves it. */
    warlike: number;
}

export const TRAITS: Record<TraitId, TraitDef> = {
    frugal: {
        name: 'Frugal',
        description: 'Hates waste. Wants full stores, not fancy buildings.',
        needs: { food: 0.4 },
        likes: { granary: 1, palace: -2, oasis: -1.5, garden: -0.5, market: -0.3 },
        agenda: { frugality: 1, grandeur: -1.5, prosperity: 0.2 },
        ignoresVotes: 0,
        obeys: 0,
        workSpeed: 1,
        warlike: -0.2
    },
    greedy: {
        name: 'Greedy',
        description: 'Loves gold, markets and palaces.',
        needs: { wealth: 0.8 },
        likes: { market: 1.5, palace: 1.2, mine: 0.8 },
        agenda: { prosperity: 1.2, grandeur: 0.6, faith: -0.4 },
        ignoresVotes: 0.1,
        obeys: -0.1,
        workSpeed: 1,
        warlike: 0.2
    },
    brave: {
        name: 'Brave',
        description: 'Wants a strong army and is not afraid of war.',
        needs: { safety: -0.2 },
        likes: { barracks: 1.2, archery: 0.8, tower: 0.4 },
        agenda: { military: 1.2, expansion: 0.5 },
        ignoresVotes: 0.05,
        obeys: 0.05,
        workSpeed: 1,
        warlike: 0.8
    },
    cautious: {
        name: 'Cautious',
        description: 'Worries about raiders and wild animals. Wants walls and towers.',
        needs: { safety: 0.9 },
        likes: { wall: 1.2, tower: 1.2, gate: 0.8 },
        agenda: { safety: 1.2, expansion: -0.6, military: 0.3 },
        ignoresVotes: -0.05,
        obeys: 0.05,
        workSpeed: 1,
        warlike: -0.4
    },
    pious: {
        name: 'Pious',
        description: 'Wants a monastery and values faith above riches.',
        needs: { faith: 1 },
        likes: { monastery: 1.8, palace: -0.6 },
        agenda: { faith: 1.4, grandeur: -0.4 },
        ignoresVotes: -0.05,
        obeys: 0.1,
        workSpeed: 1,
        warlike: -0.3
    },
    natureLover: {
        name: 'Nature Lover',
        description: 'Loves trees, gardens and water. Dislikes big stone projects.',
        needs: { beauty: 0.7, water: 0.3 },
        likes: { garden: 1.4, oasis: 1.5, sapling: 0.6, pond: 0.5, palace: -0.8, wall: -0.3 },
        agenda: { nature: 1.5, grandeur: -0.5, military: -0.3 },
        ignoresVotes: 0,
        obeys: 0,
        workSpeed: 1,
        warlike: -0.4
    },
    builder: {
        name: 'Builder',
        description: 'Happiest when something new is going up.',
        needs: { shelter: 0.4 },
        likes: { house: 0.8, market: 0.4, palace: 0.6, tower: 0.4, road: 0.4 },
        agenda: { grandeur: 0.6, expansion: 0.6 },
        ignoresVotes: 0,
        obeys: 0.05,
        workSpeed: 1.15,
        warlike: 0
    },
    ambitious: {
        name: 'Ambitious',
        description: 'Dreams big. As a leader, often ignores what the people want.',
        needs: { wealth: 0.4 },
        likes: { palace: 1.4, barracks: 0.5, market: 0.5 },
        agenda: { grandeur: 1, expansion: 1, frugality: -0.6 },
        ignoresVotes: 0.3,
        obeys: -0.2,
        workSpeed: 1.05,
        warlike: 0.4
    },
    lazy: {
        name: 'Lazy',
        description: 'Works slowly and dislikes big projects.',
        needs: { shelter: 0.2 },
        likes: { palace: -0.5, oasis: -0.4, wall: -0.4 },
        agenda: { grandeur: -0.5, frugality: 0.3 },
        ignoresVotes: 0.05,
        obeys: -0.05,
        workSpeed: 0.75,
        warlike: -0.2
    },
    hardworking: {
        name: 'Hardworking',
        description: 'Gathers and builds faster than anyone.',
        needs: {},
        likes: { farm: 0.5, lumberCamp: 0.5 },
        agenda: { prosperity: 0.4 },
        ignoresVotes: 0,
        obeys: 0.1,
        workSpeed: 1.3,
        warlike: 0
    },
    social: {
        name: 'Social',
        description: 'Loves markets, festivals and crowded streets.',
        needs: { wealth: 0.2, beauty: 0.3 },
        likes: { market: 1, garden: 0.6, house: 0.5 },
        agenda: { prosperity: 0.8, expansion: 0.3 },
        ignoresVotes: -0.1,
        obeys: 0.05,
        workSpeed: 1,
        warlike: -0.2
    },
    stubborn: {
        name: 'Stubborn',
        description: 'Never changes their mind. As a leader, ignores votes and messengers.',
        needs: {},
        likes: {},
        agenda: {},
        ignoresVotes: 0.35,
        obeys: -0.3,
        workSpeed: 1,
        warlike: 0.1
    },
    loyal: {
        name: 'Loyal',
        description: 'Trusts you and follows your orders.',
        needs: {},
        likes: {},
        agenda: {},
        ignoresVotes: -0.1,
        obeys: 0.35,
        workSpeed: 1,
        warlike: 0
    },
    peaceful: {
        name: 'Peaceful',
        description: 'Hates war and wants friendly neighbours.',
        needs: { safety: 0.3 },
        likes: { barracks: -0.8, archery: -0.6, garden: 0.5, market: 0.4 },
        agenda: { military: -1.2, prosperity: 0.5, expansion: -0.4 },
        ignoresVotes: -0.05,
        obeys: 0,
        workSpeed: 1,
        warlike: -1
    }
};

export const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

/** Pairs that don't make sense on one person. */
export const TRAIT_CONFLICTS: [TraitId, TraitId][] = [
    ['frugal', 'greedy'],
    ['brave', 'cautious'],
    ['lazy', 'hardworking'],
    ['brave', 'peaceful'],
    ['ambitious', 'lazy']
];
