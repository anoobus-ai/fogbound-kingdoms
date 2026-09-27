# Fogbound Kingdoms

A fog-of-war, open-world RTS that runs in your browser. You are an explorer in a world hidden in darkness.
Find the people living in tiny camps, invite them into your kingdom, and grow them into prosperous villages —
but villagers have minds of their own. Ignore them for too long and they may exile you.

Built with [Phaser 4](https://phaser.io), TypeScript and Vite, using the free
[Tiny Swords](https://pixelfrog-assets.itch.io/tiny-swords) art by Pixel Frog.

## Playing it

You need [Node.js](https://nodejs.org) (already installed on this Mac).

```bash
npm install        # first time only
npm run dev        # starts the game
```

Then open <http://localhost:5173>. Add `?seed=1234` to the address to play a specific map again.

### Getting the art (only needed on a new computer)

The Tiny Swords license does not allow sharing the art files, so they are not stored in git.

1. Download both files from <https://pixelfrog-assets.itch.io/tiny-swords> (enter $0 if you like):
   **Tiny Swords (Free Pack).zip** and **TS_old version_CC0 Licensed**.
2. Leave them in your Downloads folder and run `npm run assets`.

## Controls

| Action | How |
| --- | --- |
| Select | Left click, or drag a box around your units |
| Move / attack / gather / build / talk | Right click (it depends on what you click) |
| March and attack everything on the way | Ctrl + right click |
| Move the camera | WASD, arrow keys, push the mouse to the screen edge, or right-drag |
| Zoom | Mouse wheel |
| Follow your explorer | F |
| Jump to / select your explorer | Space / H |
| Cancel | Esc or right click |

The in-game **?** button explains everything again.

## How the game works

- **Fog of war:** the map starts black. Anything your people see stays revealed forever. Enemy units only show
  while someone of yours can see them (you can turn this off in the menu).
- **Presence:** you command units within 18 tiles of your explorer. Faraway villages get orders by **messenger**,
  who walks there and can be killed. The village leader may refuse.
- **Leaders:** when you leave a village you choose who rules. Their personality decides what they build. When you
  return you get a report and can keep or replace them.
- **Votes:** at 12 people, villagers vote on decisions. You have the final say, but going against them raises unrest
  and creates grievances.
- **Exile:** when you come back to a village whose people disagree with you (your agenda, expensive projects like
  the Gold Palace, ignored votes, broken promises) they may vote to throw you out. Rally allies, build an army and
  capture their Town Center to take it back.
- **Needs from the land:** snowy villages need food and warmth, forest villages want walls against wolves and
  bears, desert villages need wells or an oasis, hillside villages dream of beauty and wealth.
- **Soldiers cost food.** Warriors beat Archers, Lancers beat Warriors, Archers beat Lancers. Militia are cheap;
  Monks heal and convert enemies.
- **Death is permanent** for everyone except your explorer, who returns at the last friendly village he visited.

## Where things live in the code

| Folder | What's inside |
| --- | --- |
| `src/data/` | **Numbers you can tweak**: unit stats and costs, buildings, personality traits, biomes, techs, timings (`balance.ts`). |
| `src/sim/` | The game rules, with no drawing code: map generation, pathfinding, combat, economy, villages, politics, diplomacy, saving. |
| `src/render/` | Drawing the world with Phaser: terrain, units, buildings, fog, effects. |
| `src/scenes/` | Phaser scenes: `BootScene` loads the art, `WorldScene` runs the camera, mouse and keyboard. |
| `src/ui/` | The HTML interface on top of the game: resource bar, panels, pop-ups, minimap. |
| `src/audio/` | Sound effects and music. |

Run the automated tests with `npm test`.

See [CREDITS.md](CREDITS.md) for all art, sound and music sources.
