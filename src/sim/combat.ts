import { BUILDINGS } from '../data/buildings';
import { CARCASS_LIFETIME, EXPLORER_RESPAWN, HERO_AURA_DAMAGE, HERO_AURA_RADIUS } from '../data/balance';
import { UNITS } from '../data/units';
import type { Sim } from './sim';
import { BANDIT, KINGDOM, WILD, type Building, type FactionId, type Unit } from './types';
import { captureVillage } from './politics';

export const distToBuilding = (x: number, y: number, b: Building): number => {
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    return Math.hypot(dx, dy);
};

export const buildingCenter = (b: Building) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export const attackRange = (sim: Sim, u: Unit): number => {
    let r = UNITS[u.kind].range;
    if (u.kind === 'archer' && u.faction === KINGDOM && sim.hasTech('fletching')) r += 1;
    return r;
};

const damageMultiplier = (sim: Sim, u: Unit): number => {
    const explorer = sim.explorer();
    if (u.faction === KINGDOM && u.kind !== 'explorer' && explorer) {
        if (Math.hypot(explorer.x - u.x, explorer.y - u.y) <= HERO_AURA_RADIUS) return HERO_AURA_DAMAGE;
    }
    return 1;
};

export const unitDamage = (sim: Sim, attacker: Unit, target: Unit): number => {
    const def = UNITS[attacker.kind];
    let dmg = def.damage * (def.bonusVs[target.kind] ?? 1) * damageMultiplier(sim, attacker);
    if (attacker.kind === 'archer' && attacker.faction === KINGDOM && sim.hasTech('fletching')) dmg += 2;
    // Arrows and dynamite mostly go around shields and armor.
    const armor = def.range > 2 ? sim.armorOf(target) * 0.25 : sim.armorOf(target);
    return Math.max(1, dmg - armor);
};

export const performAttack = (sim: Sim, attacker: Unit, target: Unit | Building, isBuilding: boolean) => {
    const def = UNITS[attacker.kind];
    const tx = isBuilding ? buildingCenter(target as Building).x : (target as Unit).x;
    const ty = isBuilding ? buildingCenter(target as Building).y : (target as Unit).y;
    attacker.facing = tx < attacker.x ? -1 : 1;
    attacker.anim = 'attack';
    attacker.animUntil = sim.state.time + 0.45;
    attacker.cooldown = def.cooldown;

    if (attacker.kind === 'archer') sim.emit({ type: 'arrow', fromX: attacker.x, fromY: attacker.y, toX: tx, toY: ty });
    if (attacker.kind === 'goblinTnt') sim.emit({ type: 'dynamite', fromX: attacker.x, fromY: attacker.y, toX: tx, toY: ty });
    sim.emit({ type: 'sound', id: def.range > 2 ? 'bow' : 'sword', x: attacker.x, y: attacker.y });

    if (def.splash) {
        explode(sim, attacker, tx, ty, def.splash, def.damage);
        if (attacker.kind === 'goblinBarrel') killUnit(sim, attacker, null);
        return;
    }
    if (isBuilding) damageBuilding(sim, target as Building, def.damage * def.buildingDamage * damageMultiplier(sim, attacker), attacker.faction);
    else damageUnit(sim, target as Unit, unitDamage(sim, attacker, target as Unit), attacker);
};

const explode = (sim: Sim, attacker: Unit, x: number, y: number, radius: number, damage: number) => {
    sim.emit({ type: 'explosion', x, y });
    sim.emit({ type: 'sound', id: 'explosion', x, y });
    for (const other of sim.spatial.query(x, y, radius)) {
        if (other.id === attacker.id || !sim.hostileFactions(attacker.faction, other.faction)) continue;
        damageUnit(sim, other, Math.max(1, damage - sim.armorOf(other)), attacker);
    }
    for (const b of sim.state.buildings) {
        if (!sim.hostileFactions(attacker.faction, b.faction)) continue;
        if (distToBuilding(x, y, b) <= radius) damageBuilding(sim, b, damage * UNITS[attacker.kind].buildingDamage, attacker.faction);
    }
};

export const damageUnit = (sim: Sim, target: Unit, amount: number, attacker: Unit | null) => {
    if (target.hp <= 0) return;
    target.hp -= amount;
    target.lastHurtAt = sim.state.time;
    if (attacker) target.lastAttackerId = attacker.id;
    sim.emit({ type: 'hit', x: target.x, y: target.y });
    if (target.hp <= 0) killUnit(sim, target, attacker);
};

export const killUnit = (sim: Sim, u: Unit, killer: Unit | null) => {
    u.hp = 0;
    sim.emit({ type: 'death', x: u.x, y: u.y });
    sim.emit({ type: 'sound', id: 'death', x: u.x, y: u.y });
    const def = UNITS[u.kind];

    if (def.food && u.faction === WILD) {
        const carcass = sim.addResource('carcass', Math.floor(u.x), Math.floor(u.y), def.food, 0, sim.state.time + CARCASS_LIFETIME);
        if (killer && killer.kind === 'pawn') {
            killer.order = { type: 'gather', resourceId: carcass.id };
            killer.engageId = null;
        }
    }

    if (u.kind === 'explorer') {
        sim.state.kingdom.explorerDeadUntil = sim.state.time + EXPLORER_RESPAWN;
        sim.log('Your explorer has fallen! He will return shortly.', 'bad', u);
    } else if (u.person && u.villageId !== null) {
        const v = sim.village(u.villageId);
        if (v) {
            if (v.leaderId === u.id) {
                v.leaderId = null;
                sim.log(`${u.person.name}, leader of ${v.name}, has died.`, 'bad', u);
            } else if (v.faction === KINGDOM) {
                sim.log(`${u.person.name} of ${v.name} has died.`, 'bad', u);
            }
            for (const other of sim.citizens(v.id)) {
                if (other.person && other.id !== u.id) other.person.mood = Math.max(0, other.person.mood - 3);
            }
        }
    }
    sim.removeUnit(u);
};

export const damageBuilding = (sim: Sim, b: Building, amount: number, attackerFaction: FactionId) => {
    if (b.hp <= 0) return;
    b.hp -= amount;
    if (sim.rng.chance(0.25)) sim.emit({ type: 'dust', x: b.x + sim.rng.range(0, b.w), y: b.y + sim.rng.range(0, b.h) });
    if (b.hp > 0) return;

    const v = sim.village(b.villageId);
    const isCenter = b.kind === 'townCenter' || b.kind === 'campHut';
    if (isCenter && v && sim.townCenter(v) === b) {
        if (attackerFaction === BANDIT || attackerFaction === WILD) {
            b.hp = 1;
            return;
        }
        captureVillage(sim, v, attackerFaction);
        b.hp = Math.round(sim.buildingMaxHp(b) * 0.3);
        return;
    }
    destroyBuilding(sim, b);
};

export const destroyBuilding = (sim: Sim, b: Building) => {
    sim.emit({ type: 'explosion', x: b.x + b.w / 2, y: b.y + b.h / 2 });
    sim.emit({ type: 'sound', id: 'explosion', x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const v = sim.village(b.villageId);
    if (v && v.faction === KINGDOM && b.built) sim.log(`A ${BUILDINGS[b.kind].name} in ${v.name} was destroyed.`, 'bad', { x: b.x, y: b.y });
    if (b.faction === BANDIT) {
        const campLeft = sim.state.buildings.some((o) => o !== b && o.faction === BANDIT && Math.hypot(o.x - b.x, o.y - b.y) < 8);
        if (!campLeft) {
            const home = nearestKingdomVillage(sim, b.x, b.y);
            if (home) {
                home.stock.gold += 120;
                home.stock.food += 80;
                sim.log(`A bandit camp was destroyed! ${home.name} collects 120 gold and 80 food in loot.`, 'good', b);
            }
        }
    }
    sim.removeBuilding(b);
};

export const nearestKingdomVillage = (sim: Sim, x: number, y: number) => {
    let best = null;
    let bestD = Infinity;
    for (const v of sim.state.villages) {
        if (v.faction !== KINGDOM) continue;
        const d = Math.hypot(v.cx - x, v.cy - y);
        if (d < bestD) {
            bestD = d;
            best = v;
        }
    }
    return best;
};
