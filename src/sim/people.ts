import { FIRST_NAMES, VILLAGE_PREFIXES, VILLAGE_SUFFIXES } from '../data/names';
import { TRAITS, TRAIT_CONFLICTS, TRAIT_IDS } from '../data/traits';
import type { Rng } from './rng';
import type { Person, TraitId, Unit } from './types';

const conflicts = (a: TraitId, b: TraitId) => a === b || TRAIT_CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export const makePerson = (rng: Rng, culture: readonly TraitId[] = []): Person => {
    const traits: TraitId[] = [];
    if (culture.length && rng.chance(0.65)) traits.push(rng.pick(culture));
    while (traits.length < 2) {
        const t = rng.chance(0.3) && culture.length ? rng.pick(culture) : rng.pick(TRAIT_IDS);
        if (traits.every((o) => !conflicts(o, t))) traits.push(t);
    }
    return {
        name: rng.pick(FIRST_NAMES),
        traits,
        mood: rng.int(55, 75),
        avatar: rng.int(1, 25)
    };
};

export const makeCulture = (rng: Rng): TraitId[] => {
    const out: TraitId[] = [];
    while (out.length < 3) {
        const t = rng.pick(TRAIT_IDS);
        if (out.every((o) => !conflicts(o, t))) out.push(t);
    }
    return out;
};

export const villageName = (rng: Rng, taken: Set<string>): string => {
    for (let i = 0; i < 50; i++) {
        const name = rng.pick(VILLAGE_PREFIXES) + rng.pick(VILLAGE_SUFFIXES);
        if (!taken.has(name)) {
            taken.add(name);
            return name;
        }
    }
    return `Village ${taken.size + 1}`;
};

export const describeTraits = (p: Person): string => p.traits.map((t) => TRAITS[t].name).join(', ');

/** How good a leader someone would be, from the people's point of view. */
export const popularity = (u: Unit): number => {
    if (!u.person) return 0;
    let score = u.person.mood;
    for (const t of u.person.traits) {
        if (t === 'social') score += 15;
        if (t === 'loyal') score += 5;
        if (t === 'stubborn') score -= 8;
        if (t === 'ambitious') score += 6;
    }
    return score;
};
