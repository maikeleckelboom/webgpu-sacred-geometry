# WebGPU Fluid Brightness Technique Handoff

This package documents the visual technique behind the bright, blooming look of Pavel Dobryakov's WebGL Fluid Simulation and translates it into a WebGPU implementation plan.

The goal is not to clone the demo verbatim. The goal is to preserve the core visual mechanism:

```txt
additive overbright dye -> half-float/HDR internal buffers -> soft-knee bloom -> blurred bloom chain -> gamma-lifted additive composite -> final SDR/HDR canvas
```

Use this as a handoff for Codex, Claude, or another engineering agent implementing a new WebGPU variant.

## Contents

| File                                 | Purpose                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `01_technique_breakdown.md`          | Exact visual mechanism: why it becomes bright, which passes matter, and which values must stay over 1.0. |
| `02_webgpu_architecture.md`          | WebGPU resource layout, texture formats, bind groups, canvas presentation, and render graph shape.       |
| `03_render_graph_and_pass_order.md`  | Frame-by-frame pass order and ping-pong rules.                                                           |
| `04_shader_math_wgsl_templates.md`   | WGSL-oriented formulas/templates for splat, advection, bloom, display, shading, and debug views.         |
| `05_bloom_sunrays_color_pipeline.md` | Bloom, sunrays, gamma, tone mapping, color energy, and tuning recipes.                                   |
| `06_porting_checklist.md`            | Implementation checklist with acceptance criteria.                                                       |
| `07_debugging_brightness_webgpu.md`  | WebGPU-specific failure modes and debug probes for “why is it not bright?”                               |
| `08_codex_claude_task_prompt.md`     | A ready-to-paste implementation prompt for Codex/Claude.                                                 |
| `09_attribution_license.md`          | Upstream license/attribution guidance and safe reuse policy.                                             |
| `10_reference_constants.md`          | Reference parameter values and suggested variant presets.                                                |

## Core takeaways

1. Do **not** store dye in `rgba8unorm` or the WebGPU canvas early. Store dye in `rgba16float`.
2. Do **not** clamp dye before bloom. Bloom must see values above `1.0`.
3. Inject dye with additive Gaussian splats. The color/intensity may be well above `1.0` internally.
4. Extract bloom from the HDR dye, blur it through a downsample chain, then add it back during the display pass.
5. For SDR canvas output, tone-map/gamma at the final pass only. For HDR canvas output, still keep the internal post stack; HDR canvas is optional, not required.

## Source basis

This package is based on analysis of the public MIT-licensed repository:

- PavelDoGreat/WebGL-Fluid-Simulation
- Runtime demo: `https://paveldogreat.github.io/WebGL-Fluid-Simulation/`
- Repository: `https://github.com/PavelDoGreat/WebGL-Fluid-Simulation`

The upstream source is MIT licensed. See `09_attribution_license.md` before copying source code directly. A clean WebGPU rewrite can use the algorithms, equations, and parameter targets documented here without importing the upstream JavaScript verbatim.
