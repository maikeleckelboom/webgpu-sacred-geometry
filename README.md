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

- `/` and `/hero-flow` open the monochrome ink hero composition.
- `/hero-flow-dark` keeps the luminous particle field as a dedicated dark hero study.
- `/aurora` composes one primary aurora river, a distant supporting curtain, sparse atmosphere, and an exact local magnetic-lens hover.
- `/topography` adds a grayscale terrain study with procedural contour layers, metallic lighting, fog, and a post-process lens pass.
- `/flow-sheet` folds layered graphite trajectories through a dimensional throat with quiet drift and pointer parallax.
- `/refractive-nebula` adds a compact volumetric nebula with refractive micro-normals, star glints, and a quality selector that changes render scale plus shader detail.

During local development, `/aurora?debug=pointer` displays the CSS-to-backing-store-to-renderer coordinate mapping, interaction radius, strength, canvas bounds, DPR, and mapping drift.
