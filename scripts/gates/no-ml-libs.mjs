#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { DEFAULT_ROOTS, countScannedFiles, scanForPatterns, walkFiles } from './scan.mjs';

/**
 * CI gate: no-ml-libs stubs (B+I-11, Ten Laws #5).
 * The canonical pipeline is deterministic + on-device: no generative
 * alteration, no model cutout/segmentation/classification, no server-side
 * per-image inference, no AI-derived facts — enforced here as (a) a banned
 * ML/generative/inference dependency list over every workspace package.json
 * and (b) a banned import scan over source. Deterministic image libs are not
 * on the list; models are.
 */
const BANNED_LIBS = [
  'tensorflow',
  '@tensorflow',
  'onnx',
  'torch',
  'pytorch',
  'mediapipe',
  '@mediapipe',
  'ml5',
  'brain.js',
  '@xenova',
  '@huggingface',
  'openai',
  '@anthropic-ai',
  'replicate',
  'cohere',
  'diffusers',
  'stable-diffusion',
  'face-api',
  'opencv',
  'deepface',
  'clarifai',
  'or-tools',
  'ortools',
  'vroom',
  'routific',
  'graphhopper',
  'route-optimiz',
  'eta-predict',
];

const args = process.argv.slice(2);
const roots = args.length > 0 ? args : DEFAULT_ROOTS;
if (countScannedFiles(roots) === 0) {
  console.error(`no-ml-libs ERROR — no scannable files under ${roots.join(', ')}; refusing to pass on an empty scan`);
  process.exit(2);
}
const problems = [];

// (a) dependency scan over workspace package manifests
for (const root of roots) {
  for (const file of walkFiles(root)) {
    if (!file.endsWith('package.json')) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const depNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];
    for (const dep of depNames) {
      for (const banned of BANNED_LIBS) {
        if (dep.toLowerCase().includes(banned)) {
          problems.push(`${file}: banned ML/inference dependency "${dep}" (matches "${banned}")`);
        }
      }
    }
  }
}

// (b) import scan over source
const importPatterns = BANNED_LIBS.map((lib) => ({
  name: `import:${lib}`,
  regex: new RegExp(`(from\\s+|require\\(|import\\()\\s*['"\`][^'"\`]*${lib.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
}));
for (const hit of scanForPatterns(roots, importPatterns)) {
  problems.push(`${hit.file}:${hit.lineNo} [${hit.pattern}] ${hit.line}`);
}

if (problems.length === 0) {
  console.log(`no-ml-libs OK — no ML/generative/inference dependency or import in ${roots.join(', ')} (SE §5.3 deterministic only — no ML, no route-optimization/ETA model)`);
  process.exit(0);
}
console.error(`no-ml-libs FAILED (SE §5.3 deterministic only — no ML, no route-optimization/ETA model) — ${problems.length} problem(s):`);
for (const p of problems) console.error(`  ${p}`);
process.exit(1);
