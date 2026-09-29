// Publishes the game to Vercel. Usage: npm run publish
// The Tiny Swords art is gitignored, and the Vercel CLI skips anything git ignores,
// so the finished build is copied to a scratch folder outside the repo and sent from there.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const art = join(root, 'public', 'assets', 'tiny-swords');

if (!existsSync(join(art, 'free')) || !existsSync(join(art, 'old'))) {
    console.error('The Tiny Swords art is missing, so the published game would be blank.');
    console.error('Download both zips from https://pixelfrog-assets.itch.io/tiny-swords and run: npm run assets');
    process.exit(1);
}

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

const stage = mkdtempSync(join(tmpdir(), 'fogbound-publish-'));
try {
    const output = join(stage, '.vercel', 'output');
    mkdirSync(output, { recursive: true });
    cpSync(join(root, 'dist'), join(output, 'static'), { recursive: true });
    writeFileSync(join(output, 'config.json'), JSON.stringify({ version: 3 }));
    cpSync(join(root, '.vercel', 'project.json'), join(stage, '.vercel', 'project.json'));
    execFileSync('npx', ['vercel', 'deploy', '--prebuilt', '--prod', '--yes'], { cwd: stage, stdio: 'inherit' });
} finally {
    rmSync(stage, { recursive: true, force: true });
}
