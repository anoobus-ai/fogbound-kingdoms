import Phaser from 'phaser';
import { TILE } from '../data/balance';
import type { Sim } from '../sim/sim';
import { DEPTH } from './terrain';

const UNEXPLORED = 255;
/** Explored land that nobody is looking at right now gets a light haze (when "fog of sight" is on). */
const REMEMBERED = 70;

export class FogRenderer {
    private texture: Phaser.Textures.CanvasTexture;
    private image: Phaser.GameObjects.Image;
    private pixels: ImageData;
    private timer = 0;

    constructor(scene: Phaser.Scene, private sim: Sim) {
        const { w, h } = sim.state.map;
        if (scene.textures.exists('fog')) scene.textures.remove('fog');
        this.texture = scene.textures.createCanvas('fog', w, h)!;
        this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        this.pixels = this.texture.getContext().createImageData(w, h);
        this.image = scene.add.image(0, 0, 'fog').setOrigin(0, 0).setScale(TILE).setDepth(DEPTH.fog);
        this.redraw();
    }

    setSim(sim: Sim) {
        this.sim = sim;
        this.redraw();
    }

    update(dt: number) {
        this.timer -= dt;
        if (this.timer > 0) return;
        this.timer = 0.15;
        this.redraw();
    }

    private redraw() {
        const { explored, settings } = this.sim.state;
        const visible = this.sim.visible;
        const p = this.pixels.data;
        const haze = settings.sightFog ? REMEMBERED : 0;
        for (let i = 0; i < explored.length; i++) {
            const o = i * 4;
            p[o] = 8;
            p[o + 1] = 10;
            p[o + 2] = 18;
            p[o + 3] = explored[i] ? (visible[i] ? 0 : haze) : UNEXPLORED;
        }
        this.texture.getContext().putImageData(this.pixels, 0, 0);
        this.texture.refresh();
        this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    }

    destroy() {
        this.image.destroy();
    }
}
