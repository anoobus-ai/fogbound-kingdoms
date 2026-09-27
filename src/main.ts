import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';

const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-container',
    backgroundColor: '#47aba9',
    pixelArt: true,
    scale: {
        mode: Phaser.Scale.RESIZE,
        width: window.innerWidth,
        height: window.innerHeight
    },
    scene: [BootScene, WorldScene]
});

// Handy for poking at the game from the browser console.
(window as unknown as { game: Phaser.Game }).game = game;
