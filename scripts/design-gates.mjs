import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const BASELINE_PATH = path.join(ROOT, "scripts", "design-gates-baseline.json");
const UPDATE = process.argv.includes("--update-baseline");

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const ARBITRARY_RE =
  /\b(?:(?:bg|text|border(?:-[tblrsexy])?|from|via|to|fill|stroke|ring|outline|decoration|divide|accent|caret)-\[#|rounded(?:-[tblrse]{1,2})?-\[|shadow-\[)/g;
const STYLE_PROP_RE = /style=\{/g;
const LEGACY_RE = /legacy-/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(SRC);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

const cssFiles = files.filter((f) => f.endsWith(".css")).map(rel);
const sourceFiles = files.filter((f) => /\.(ts|tsx|css)$/.test(f));

const current = { legacy: 0, hex: {}, arbitrary: {}, styleProp: {} };

for (const file of sourceFiles) {
  const name = rel(file);
  const text = readFileSync(file, "utf8");

  current.legacy += (text.match(LEGACY_RE) || []).length;

  if (name !== "src/index.css") {
    const hex = (text.match(HEX_RE) || []).length;
    if (hex > 0) current.hex[name] = hex;
  }

  if (!file.endsWith(".css")) {
    const arb = (text.match(ARBITRARY_RE) || []).length;
    if (arb > 0) current.arbitrary[name] = arb;
    const style = (text.match(STYLE_PROP_RE) || []).length;
    if (style > 0) current.styleProp[name] = style;
  }
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  console.log(`design-gates: baseline written (legacy=${current.legacy})`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error("design-gates: missing scripts/design-gates-baseline.json — run node scripts/design-gates.mjs --update-baseline");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const failures = [];
let improved = false;

const allowedCss = new Set(["src/index.css", "src/App.css"]);
for (const css of cssFiles) {
  if (!allowedCss.has(css)) failures.push(`new css file: ${css} — styles belong in components via tokens, not new stylesheets`);
}

if (current.legacy > baseline.legacy) {
  failures.push(`legacy ratchet: ${current.legacy} "legacy-" occurrences in src/ vs baseline ${baseline.legacy} — never add legacy usages; build on the design tokens instead`);
} else if (current.legacy < baseline.legacy) {
  improved = true;
}

for (const gate of ["hex", "arbitrary", "styleProp"]) {
  const base = baseline[gate] || {};
  const cur = current[gate];
  const label = { hex: "raw hex colors", arbitrary: "arbitrary Tailwind values (bg-[#…], rounded-[…], shadow-[…])", styleProp: "style= props" }[gate];
  for (const [file, count] of Object.entries(cur)) {
    const allowed = base[file] || 0;
    if (count > allowed) {
      failures.push(`${label}: ${file} has ${count}, baseline allows ${allowed} — use the design tokens`);
    } else if (count < allowed) {
      improved = true;
    }
  }
  for (const file of Object.keys(base)) {
    if (!(file in cur)) improved = true;
  }
}

if (failures.length > 0) {
  console.error("design-gates: FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("  Semantic tokens only (.claude/rules/frontend.md). If a burn-down improved elsewhere, refresh the baseline with: node scripts/design-gates.mjs --update-baseline");
  process.exit(1);
}

if (improved) {
  console.log(`design-gates: PASS — offenders decreased (legacy now ${current.legacy}, baseline ${baseline.legacy}). Update the baseline in this PR: node scripts/design-gates.mjs --update-baseline`);
} else {
  console.log(`design-gates: PASS (legacy=${current.legacy})`);
}
