import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const projectDir = process.argv[2] ?? '.';
const file = join(projectDir, 'node_modules', '@revideo', 'renderer', 'lib', 'server', 'render-video.js');
const original = "if (!args.includes('--single-process')) {";
const patched = "if (process.platform !== 'win32' && !args.includes('--single-process')) {";

let src;
try {
  src = readFileSync(file, 'utf8');
} catch {
  console.error(`not found: ${file} — run npm install first, or pass the project dir as the first argument`);
  process.exit(1);
}

if (src.includes(patched)) {
  console.log('already patched');
} else if (src.includes(original)) {
  writeFileSync(file, src.replace(original, patched));
  console.log(`patched: ${file}`);
} else {
  console.error('pattern not found — @revideo/renderer changed; manually guard the forced --single-process arg behind process.platform !== "win32" in render-video.js');
  process.exit(1);
}
