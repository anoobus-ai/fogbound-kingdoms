import Phaser from 'phaser';
import { TILE } from '../data/balance';
import type { SoundId } from '../sim/types';

const THROTTLE: Partial<Record<SoundId, number>> = { chop: 0.25, mine: 0.25, build: 0.25, sword: 0.12, bow: 0.12, death: 0.2 };

export class SoundManager {
    private lastPlayed = new Map<SoundId, number>();
    private music: Phaser.Sound.BaseSound | null = null;
    private track = 0;
    sfxVolume = 0.7;
    musicVolume = 0.4;

    constructor(private readonly scene: Phaser.Scene) {}

    play(id: SoundId, x?: number, y?: number) {
        const now = this.scene.time.now / 1000;
        const gap = THROTTLE[id] ?? 0.05;
        if (now - (this.lastPlayed.get(id) ?? -1) < gap) return;
        this.lastPlayed.set(id, now);
        let volume = this.sfxVolume;
        if (x !== undefined && y !== undefined) {
            const cam = this.scene.cameras.main;
            const cx = cam.worldView.centerX / TILE;
            const cy = cam.worldView.centerY / TILE;
            const d = Math.hypot(x - cx, y - cy);
            volume *= Math.max(0.15, 1 - d / 30);
        }
        if (volume <= 0.01) return;
        this.scene.sound.play(`sfx-${id}`, { volume: volume * (id === 'horn' || id === 'bell' ? 0.8 : 0.55) });
    }

    startMusic() {
        if (this.music || this.musicVolume <= 0) return;
        this.nextTrack();
    }

    private nextTrack() {
        this.music?.destroy();
        this.track = (this.track % 2) + 1;
        this.music = this.scene.sound.add(`music-${this.track}`, { volume: this.musicVolume });
        this.music.once(Phaser.Sound.Events.COMPLETE, () => this.nextTrack());
        this.music.play();
    }

    setMusicVolume(v: number) {
        this.musicVolume = v;
        if (this.music && 'setVolume' in this.music) (this.music as Phaser.Sound.WebAudioSound).setVolume(v);
        if (v > 0) this.startMusic();
    }
}
