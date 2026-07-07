# WebGPU Sacred Geometry Study

A Vite + TypeScript + WebGPU recreation of the supplied luminous geometric reference.

## R&D notes

- WebGPU TypeScript projects still need `@webgpu/types` in `devDependencies` and `compilerOptions.types`.
- Thick luminous linework is built as expanded triangle strips, following the same core idea used by GPU line renderers: draw each segment as geometry, then use additive layers for glow.
- The bloom look is approximated procedurally by drawing larger transparent glow passes behind the crisp lines and node sprites. That keeps this project compact while matching the reference image's electric cyan, violet, white, and amber light language.

## Run

```sh
npm install
npm run dev
```

Open the local Vite URL in a WebGPU-capable browser.

## Pages

- `/` keeps the original luminous mandala study.
- `/flow-field` adds the high-key editorial composition with a compute-driven WebGPU particle field.
