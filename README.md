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

- `/` and `/flow-field` open the flow-field study.
- `/flow-field` drives a high-key editorial composition from a single mathematical vector field: curl noise, three moving vortex attractors, an aurora shear curtain, a hidden golden-angle attractor lattice, field-metric-driven particle styling, and an accumulation buffer trail memory.
- `/aurora` keeps the older aurora particle field (sine-flow + lens attractors + curtains) as a separate study.
- `/topography` adds a grayscale terrain study with procedural contour layers, metallic lighting, fog, and a post-process lens pass.
- `/architecture` adds a premium architectural network field with clustered nodes, instanced rails, translucent planes, depth focus, and reduced-motion-aware camera drift.
- `/waves` adds a high-key graphite streamline reconstruction of the supplied WebGPU waves reference.

The architecture R&D note lives in [`docs/architecture-network-rd.md`](docs/architecture-network-rd.md).
The waves R&D note lives in [`docs/webgpu-waves-rd.md`](docs/webgpu-waves-rd.md).
