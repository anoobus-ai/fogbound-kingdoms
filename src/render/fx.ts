import Phaser from 'phaser';
import { TILE } from '../data/balance';
import type { Sim } from '../sim/sim';
import type { FxEvent } from '../sim/types';
import type { SoundManager } from '../audio/sound';
import { DEPTH } from './terrain';

const FX_DEPTH = DEPTH.fog - 20;

export class FxRenderer {
    constructor(private readonly scene: Phaser.Scene, private readonly sound: SoundManager) {}

    drain(sim: Sim) {
        const events = sim.fx;
        sim.fx = [];
        const cam = this.scene.cameras.main.worldView;
        const onScreen = (x: number, y: number) =>
            x * TILE > cam.x - 200 && x * TILE < cam.right + 200 && y * TILE > cam.y - 200 && y * TILE < cam.bottom + 200;
        const seen = (x: number, y: number) => {
            const { map } = sim.state;
            const tx = Math.floor(x);
            const ty = Math.floor(y);
            if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
            return sim.visible[ty * map.w + tx] > 0;
        };
        let played = 0;
        for (const e of events) {
            if (e.type === 'sound') {
                if (played < 4 && (e.x === undefined || (onScreen(e.x, e.y!) && seen(e.x, e.y!)))) {
                    this.sound.play(e.id, e.x, e.y);
                    played++;
                }
                continue;
            }
            const x = 'x' in e ? e.x : e.fromX;
            const y = 'y' in e ? e.y : e.fromY;
            if (!onScreen(x, y) || !seen(x, y)) continue;
            this.spawn(e);
        }
    }

    private spawn(e: Exclude<FxEvent, { type: 'sound' }>) {
        const s = this.scene;
        const once = (key: string, x: number, y: number, scale = 1, tint?: number) => {
            const sp = s.add.sprite(x * TILE, y * TILE, key).setDepth(FX_DEPTH).setScale(scale);
            if (tint !== undefined) sp.setTint(tint);
            sp.play(key);
            sp.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sp.destroy());
        };
        switch (e.type) {
            case 'hit':
                once('fx-dust', e.x, e.y - 0.2, 0.45);
                return;
            case 'death':
                once('fx-dead', e.x, e.y - 0.1, 0.7);
                return;
            case 'explosion':
                once('fx-explosion', e.x, e.y - 0.3, 0.8);
                return;
            case 'heal':
                once('fx-heal', e.x, e.y - 0.3, 0.6);
                return;
            case 'convert':
                once('fx-heal', e.x, e.y - 0.3, 0.9, 0xffd34d);
                return;
            case 'dust':
                once('fx-dust', e.x, e.y, 1);
                return;
            case 'fire':
                once('fx-fire', e.x, e.y, 1);
                return;
            case 'arrow': {
                const a = s.add.image(e.fromX * TILE, (e.fromY - 0.4) * TILE, 'arrow').setDepth(FX_DEPTH);
                a.setRotation(Math.atan2(e.toY - e.fromY, e.toX - e.fromX));
                const dist = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
                s.tweens.add({
                    targets: a,
                    x: e.toX * TILE,
                    y: (e.toY - 0.3) * TILE,
                    duration: 80 + dist * 45,
                    onComplete: () => a.destroy()
                });
                return;
            }
            case 'dynamite': {
                const d = s.add.sprite(e.fromX * TILE, (e.fromY - 0.4) * TILE, 'dynamite').setDepth(FX_DEPTH).play('dynamite');
                const dist = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
                s.tweens.add({
                    targets: d,
                    x: e.toX * TILE,
                    y: e.toY * TILE,
                    duration: 150 + dist * 60,
                    onComplete: () => d.destroy()
                });
                return;
            }
            default: {
                const never: never = e;
                throw new Error(`Unknown effect ${JSON.stringify(never)}`);
            }
        }
    }
}
