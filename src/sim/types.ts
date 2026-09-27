export type ResourceType = 'food' | 'wood' | 'gold' | 'stone';
export type Stock = Record<ResourceType, number>;
export const RESOURCE_TYPES: readonly ResourceType[] = ['food', 'wood', 'gold', 'stone'];

export type BiomeId = 'water' | 'grassland' | 'forest' | 'snow' | 'desert';
/** Index order used by the `biome` typed array on the map. */
export const BIOME_IDS: readonly BiomeId[] = ['water', 'grassland', 'forest', 'snow', 'desert'];

export const Ground = {
    Water: 0,
    Grass: 1,
    Sand: 2,
    Snow: 3
} as const;

/** `kingdom` is the player; independent villages are `v<id>`. */
export type FactionId = string;
export const KINGDOM = 'kingdom';
export const BANDIT = 'bandit';
export const WILD = 'wild';

export type UnitKind =
    | 'explorer'
    | 'pawn'
    | 'militia'
    | 'archer'
    | 'warrior'
    | 'lancer'
    | 'monk'
    | 'messenger'
    | 'caravan'
    | 'goblinTorch'
    | 'goblinTnt'
    | 'goblinBarrel'
    | 'sheep'
    | 'wolf'
    | 'bear';

export type BuildingKind =
    | 'townCenter'
    | 'house'
    | 'farm'
    | 'lumberCamp'
    | 'granary'
    | 'barracks'
    | 'archery'
    | 'monastery'
    | 'tower'
    | 'wall'
    | 'gate'
    | 'well'
    | 'market'
    | 'garden'
    | 'palace'
    | 'oasis'
    | 'mine'
    | 'campHut'
    | 'goblinHut'
    | 'goblinTower'
    | 'road'
    | 'pond'
    | 'landfill'
    | 'sapling';

export type ResourceKind = 'tree' | 'gold' | 'stone' | 'carcass';

export type Stance = 'passive' | 'aggressive' | 'hold';

export type AnimState = 'idle' | 'run' | 'attack' | 'work' | 'heal' | 'carry';

export interface Point {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type TraitId =
    | 'frugal'
    | 'greedy'
    | 'brave'
    | 'cautious'
    | 'pious'
    | 'natureLover'
    | 'builder'
    | 'ambitious'
    | 'lazy'
    | 'hardworking'
    | 'social'
    | 'stubborn'
    | 'loyal'
    | 'peaceful';

export interface Person {
    name: string;
    traits: TraitId[];
    /** 0-100 */
    mood: number;
    /** 1-25, index into the Tiny Swords human avatars */
    avatar: number;
}

export type MessengerOrder =
    | { type: 'build'; building: BuildingKind }
    | { type: 'train'; unit: UnitKind; count: number }
    | { type: 'focus'; resource: ResourceType }
    | { type: 'sendTroops' }
    | { type: 'gift'; resource: ResourceType; amount: number }
    | { type: 'alliance' }
    | { type: 'peace' }
    | { type: 'invite' };

export type Order =
    | { type: 'idle' }
    | { type: 'move'; x: number; y: number; attackMove: boolean }
    | { type: 'attack'; targetId: number; targetIsBuilding: boolean }
    | { type: 'gather'; resourceId: number }
    | { type: 'farm'; buildingId: number }
    | { type: 'returnCargo'; thenResourceId: number | null; thenFarmId: number | null }
    | { type: 'build'; buildingId: number }
    | { type: 'heal'; targetId: number }
    | { type: 'convert'; targetId: number; progress: number }
    | { type: 'talk'; villageId: number }
    | { type: 'deliver'; villageId: number; message: MessengerOrder; from: FactionId }
    | { type: 'trade'; fromVillage: number; toVillage: number; leg: 'toSource' | 'toDest' }
    | { type: 'follow'; targetId: number }
    | { type: 'wander'; x: number; y: number };

export interface Unit {
    id: number;
    kind: UnitKind;
    faction: FactionId;
    villageId: number | null;
    x: number;
    y: number;
    hp: number;
    stance: Stance;
    order: Order;
    path: Point[];
    pathTarget: string;
    repathAt: number;
    cooldown: number;
    carry: { type: ResourceType; amount: number } | null;
    person: Person | null;
    facing: 1 | -1;
    anim: AnimState;
    animUntil: number;
    lastAttackerId: number | null;
    lastHurtAt: number;
    /** A fight picked up on the way (self-defence, attack-move, aggressive stance). The order resumes afterwards. */
    engageId: number | null;
    idleSince: number;
    homeX: number;
    homeY: number;
    cargo: Stock | null;
    convertCooldownUntil: number;
}

export interface TrainItem {
    unit: UnitKind;
    progress: number;
}

export interface Building {
    id: number;
    kind: BuildingKind;
    faction: FactionId;
    villageId: number | null;
    x: number;
    y: number;
    w: number;
    h: number;
    hp: number;
    built: boolean;
    progress: number;
    queue: TrainItem[];
    research: { tech: TechId; progress: number } | null;
    cooldown: number;
    variant: number;
    /** Set when the player ordered it, used to judge "expensive projects" in politics. */
    orderedByPlayer: boolean;
}

export interface ResourceNode {
    id: number;
    kind: ResourceKind;
    x: number;
    y: number;
    amount: number;
    variant: number;
    /** Carcasses rot away. */
    expiresAt: number | null;
}

export type TeamColor = 'Blue' | 'Red' | 'Purple' | 'Yellow' | 'Black';

export type NeedId = 'food' | 'shelter' | 'safety' | 'water' | 'faith' | 'wealth' | 'beauty' | 'warmth';

export type AgendaId = 'grandeur' | 'military' | 'expansion' | 'prosperity' | 'faith' | 'nature' | 'safety' | 'frugality';

export type ProposalKind =
    | { type: 'build'; building: BuildingKind }
    | { type: 'army' }
    | { type: 'peace'; withFaction: FactionId }
    | { type: 'war'; withFaction: FactionId }
    | { type: 'cancelProject'; buildingId: number; building: BuildingKind };

export interface Proposal {
    id: number;
    kind: ProposalKind;
    title: string;
    reason: string;
    yes: number;
    no: number;
    createdAt: number;
    /** Who has to decide: the player (if present) or the appointed leader. */
    decider: 'player' | 'leader';
    resolved: boolean;
}

export interface Promise {
    need: NeedId;
    text: string;
    dueAt: number;
    kept: boolean | null;
}

export type Directive = MessengerOrder & { issuedAt: number };

export interface Village {
    id: number;
    name: string;
    faction: FactionId;
    biome: BiomeId;
    /** Traits common among this village's people; shapes what they want and who they get along with. */
    culture: TraitId[];
    /** Team colour used for this village's buildings and units. */
    color: TeamColor;
    cx: number;
    cy: number;
    stage: 'camp' | 'village';
    discovered: boolean;
    stock: Stock;
    leaderId: number | null;
    playerPresent: boolean;
    lastVisitAt: number;
    /** Loyalty to the player's kingdom, 0-100. For independent villages this is their opinion of you. */
    loyalty: number;
    unrest: number;
    unrestHighSince: number | null;
    happiness: number;
    needs: Record<NeedId, number>;
    proposal: Proposal | null;
    nextProposalAt: number;
    grievances: string[];
    promises: Promise[];
    directives: Directive[];
    focus: ResourceType | null;
    nextThinkAt: number;
    nextBuildAt: number;
    nextGrowthAt: number;
    lastAttackWaveAt: number;
    tradeRoutes: number[];
    eventUntil: Partial<Record<'drought' | 'plague' | 'festival' | 'harvest', number>>;
    everJoined: boolean;
    exiledPlayerAt: number | null;
    aidSentAt: number;
    /** Decisions the leader made while the explorer was away; shown when he returns. */
    awayReport: string[];
}

export type TechId =
    | 'sharpAxes'
    | 'cropRotation'
    | 'masonry'
    | 'wheelbarrow'
    | 'ironArmor'
    | 'fletching'
    | 'herbalism'
    | 'irrigation'
    | 'goldPanning';

export type DiplomacyStatus = 'allied' | 'neutral' | 'rival' | 'war';

export interface LogEntry {
    t: number;
    text: string;
    tone: 'info' | 'good' | 'bad' | 'politics';
    x?: number;
    y?: number;
}

export type UiRequest =
    | { id: number; type: 'appointLeader'; villageId: number }
    | { id: number; type: 'vote'; villageId: number; proposalId: number }
    | { id: number; type: 'exiled'; villageId: number; reasons: string[] }
    | { id: number; type: 'returnReport'; villageId: number; lines: string[] }
    | { id: number; type: 'talk'; villageId: number }
    | { id: number; type: 'event'; title: string; text: string }
    | { id: number; type: 'merchant'; x: number; y: number; villageId: number };

export type FxEvent =
    | { type: 'hit'; x: number; y: number }
    | { type: 'death'; x: number; y: number }
    | { type: 'arrow'; fromX: number; fromY: number; toX: number; toY: number }
    | { type: 'dynamite'; fromX: number; fromY: number; toX: number; toY: number }
    | { type: 'explosion'; x: number; y: number }
    | { type: 'heal'; x: number; y: number }
    | { type: 'dust'; x: number; y: number }
    | { type: 'fire'; x: number; y: number }
    | { type: 'convert'; x: number; y: number }
    | { type: 'sound'; id: SoundId; x?: number; y?: number };

export type SoundId =
    | 'click'
    | 'select'
    | 'command'
    | 'chop'
    | 'mine'
    | 'build'
    | 'complete'
    | 'sword'
    | 'bow'
    | 'hurt'
    | 'death'
    | 'explosion'
    | 'coin'
    | 'bell'
    | 'horn'
    | 'heal'
    | 'error';
