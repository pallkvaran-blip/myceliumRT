/* Kept as the name the workflow, CLAUDE.md and muscle memory all use. The build moved to
 * `make-web-zip.mjs` when a second target (CrazyGames) arrived; this is the itch entry point. */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const r = spawnSync(process.execPath, [path.join(HERE, 'make-web-zip.mjs'), '--platform', 'itch',
                                       ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
