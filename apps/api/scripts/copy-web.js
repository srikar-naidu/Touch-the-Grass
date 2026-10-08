import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDist = path.resolve(apiRoot, '../web/dist');
const target = path.resolve(apiRoot, 'dist/web');

if (!existsSync(webDist)) {
  throw new Error(`Web build not found at ${webDist}. Run the web build before the API build.`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(webDist, target, { recursive: true });
console.log(`Copied web build to ${target}`);
