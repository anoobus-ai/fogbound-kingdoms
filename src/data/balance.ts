// Tweak these numbers to change how the game feels. Times are in seconds, distances in tiles.

export const TILE = 64;
export const MAP_SIZE = 128;

export const DAY_SECONDS = 60;
export const DAYS_PER_SEASON = 5;
export const NIGHT_START = 0.72;
export const NIGHT_END = 0.08;
export const NIGHT_VISION_MULT = 0.7;

/** Explorer within this distance of a village center counts as "in the village". */
export const PRESENCE_RADIUS = 12;
/** Kingdom units within this distance of the explorer can be commanded directly. */
export const COMMAND_RADIUS = 18;
/** Citizens needed before the village starts voting on decisions. */
export const VOTE_THRESHOLD = 12;
export const PROPOSAL_INTERVAL = DAY_SECONDS * 1.2;
export const LEADER_DECISION_DELAY = 8;
/** Unrest at or above this level counts as "high". */
export const UNREST_HIGH = 75;
/** How long unrest can stay high before the village rebels. */
export const REBELLION_AFTER = DAY_SECONDS * 1.5;
/** Minimum time away before a returning explorer faces judgement. */
export const JUDGEMENT_AFTER_AWAY = DAY_SECONDS * 0.75;

export const EXPLORER_RESPAWN = 10;
export const HERO_AURA_RADIUS = 5;
export const HERO_AURA_DAMAGE = 1.2;

export const FOOD_PER_CITIZEN_PER_DAY = 2.2;
export const GROWTH_INTERVAL = 30;
export const IDLE_AUTOWORK_AFTER = 6;
export const CARCASS_LIFETIME = DAY_SECONDS * 3;

export const BANDIT_RAID_INTERVAL = DAY_SECONDS * 2.5;
export const EVENT_INTERVAL = DAY_SECONDS * 2;

export const STARTING_STOCK = { food: 150, wood: 150, gold: 0, stone: 0 };
