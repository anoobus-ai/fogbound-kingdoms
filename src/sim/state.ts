import type { MapData } from './map';
import type {
    AgendaId,
    Building,
    DiplomacyStatus,
    LogEntry,
    Point,
    ResourceNode,
    TechId,
    UiRequest,
    Unit,
    Village
} from './types';

export interface KingdomState {
    explorerId: number;
    explorerDeadUntil: number;
    respawn: Point;
    respawnVillageId: number | null;
    agenda: AgendaId[];
    techs: TechId[];
}

export interface DiplomacyState {
    /** Keyed by pairKey(a, b); -100 (hatred) to 100 (friendship). */
    relations: Record<string, number>;
    status: Record<string, DiplomacyStatus>;
}

export interface WorldClock {
    nextRaidAt: number;
    nextEventAt: number;
    nextWildlifeAt: number;
    nextDiplomacyAt: number;
}

export interface Settings {
    /** When on, enemy units are only shown while something of yours can see them. */
    sightFog: boolean;
    musicVolume: number;
    sfxVolume: number;
}

export interface GameState {
    version: 1;
    seed: number;
    time: number;
    nextId: number;
    rngState: number;
    map: MapData;
    explored: Uint8Array;
    units: Unit[];
    buildings: Building[];
    resources: ResourceNode[];
    villages: Village[];
    kingdom: KingdomState;
    diplomacy: DiplomacyState;
    clock: WorldClock;
    log: LogEntry[];
    requests: UiRequest[];
    settings: Settings;
}

export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
