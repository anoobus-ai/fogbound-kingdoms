import Phaser from 'phaser';
import { createAnimations, preloadAssets } from '../render/assets';

export class BootScene extends Phaser.Scene {
    private failed: string[] = [];

    constructor() {
        super('boot');
    }

    preload() {
        const { width, height } = this.scale;
        const box = this.add.rectangle(width / 2, height / 2, 420, 28).setStrokeStyle(2, 0xd8b47a);
        const bar = this.add.rectangle(width / 2 - 206, height / 2, 4, 20, 0xd8b47a).setOrigin(0, 0.5);
        const label = this.add
            .text(width / 2, height / 2 - 40, 'Fogbound Kingdoms', { fontFamily: 'Georgia, serif', fontSize: '32px', color: '#f3e6c8' })
            .setOrigin(0.5);
        this.load.on('progress', (p: number) => (bar.width = 412 * p));
        this.load.on('loaderror', (file: Phaser.Loader.File) => this.failed.push(file.src));
        this.load.once('complete', () => {
            box.destroy();
            bar.destroy();
            label.destroy();
        });
        preloadAssets(this);
    }

    create() {
        const artMissing = this.failed.some((src) => src.includes('tiny-swords'));
        if (artMissing) {
            const msg = [
                'The Tiny Swords art is missing.',
                '',
                '1. Download both zips from https://pixelfrog-assets.itch.io/tiny-swords',
                '   ("Tiny Swords (Free Pack)" and "TS_old version_CC0 Licensed").',
                '2. Put them in your Downloads folder.',
                '3. Run:  npm run assets',
                '4. Reload this page.'
            ].join('\n');
            this.add
                .text(this.scale.width / 2, this.scale.height / 2, msg, { fontFamily: 'monospace', fontSize: '18px', color: '#f3e6c8', align: 'left' })
                .setOrigin(0.5);
            return;
        }
        createAnimations(this);
        this.scene.start('world');
    }
}
