// Unpacks the two Tiny Swords zips (downloaded from itch.io) into public/assets/tiny-swords.
// Usage: npm run assets -- [folder containing the zips]   (defaults to ~/Downloads)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, cpSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const sourceDir = process.argv[2] ?? join(homedir(), 'Downloads');
const target = join(process.cwd(), 'public', 'assets', 'tiny-swords');

const zips = readdirSync(sourceDir).filter((f) => f.endsWith('.zip'));
const freeZip = zips.find((f) => /free/i.test(f) || f === 'ts_free.zip');
const oldZip = zips.find((f) => /old|cc0/i.test(f) || f === 'ts_old.zip');

if (!freeZip || !oldZip) {
    console.error(`Could not find both Tiny Swords zips in ${sourceDir}.`);
    console.error('Download "Tiny Swords (Free Pack).zip" and "TS_old version_CC0 Licensed" from');
    console.error('https://pixelfrog-assets.itch.io/tiny-swords and run this again.');
    process.exit(1);
}

const unpack = (zip, name) => {
    const tmp = mkdtempSync(join(tmpdir(), 'ts-'));
    execFileSync('unzip', ['-q', join(sourceDir, zip), '-d', tmp]);
    const root = readdirSync(tmp).find((d) => d !== '__MACOSX');
    const dest = join(target, name);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(join(tmp, root), dest, {
        recursive: true,
        filter: (src) => !src.endsWith('.aseprite') && !src.includes('__MACOSX')
    });
    rmSync(tmp, { recursive: true, force: true });
    console.log(`Unpacked ${zip} -> ${dest}`);
};

unpack(freeZip, 'free');
unpack(oldZip, 'old');
if (!existsSync(join(target, 'free', 'Units'))) {
    console.error('Unexpected zip layout; check the files manually.');
    process.exit(1);
}
