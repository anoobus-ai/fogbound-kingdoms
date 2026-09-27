import type { Sim } from '../sim/sim';
import type { BuildingKind, Unit } from '../sim/types';
import { isCommandable } from '../sim/commands';

export type ToastTone = 'info' | 'good' | 'bad' | 'politics';

/** Shared state between the Phaser world scene and the HTML interface. */
export class Controller extends EventTarget {
    selectedUnits = new Set<number>();
    selectedBuilding: number | null = null;
    placing: BuildingKind | null = null;
    follow = false;
    hover: number | null = null;
    /** Set by the scene so the interface can move the camera. */
    focusCamera: (x: number, y: number) => void = () => {};

    constructor(public sim: Sim) {
        super();
    }

    setSim(sim: Sim) {
        this.sim = sim;
        this.clearSelection();
        this.placing = null;
        this.dispatchEvent(new Event('sim-changed'));
    }

    selectedUnitList(): Unit[] {
        const out: Unit[] = [];
        for (const id of this.selectedUnits) {
            const u = this.sim.unitById.get(id);
            if (u) out.push(u);
            else this.selectedUnits.delete(id);
        }
        return out;
    }

    commandableSelection(): Unit[] {
        return this.selectedUnitList().filter((u) => isCommandable(this.sim, u));
    }

    selectUnits(ids: number[], add = false) {
        if (!add) this.selectedUnits.clear();
        for (const id of ids) this.selectedUnits.add(id);
        this.selectedBuilding = null;
        this.dispatchEvent(new Event('selection'));
    }

    selectBuilding(id: number | null) {
        this.selectedUnits.clear();
        this.selectedBuilding = id;
        this.dispatchEvent(new Event('selection'));
    }

    clearSelection() {
        this.selectedUnits.clear();
        this.selectedBuilding = null;
        this.dispatchEvent(new Event('selection'));
    }

    startPlacing(kind: BuildingKind | null) {
        this.placing = kind;
        this.dispatchEvent(new Event('placing'));
    }

    toast(text: string, tone: ToastTone = 'info') {
        this.dispatchEvent(new CustomEvent('toast', { detail: { text, tone } }));
    }
}
