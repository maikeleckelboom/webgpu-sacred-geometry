# 08 — Ready Prompt for Codex/Claude

Paste this into Codex, Claude Code, or another coding agent along with this documentation folder.

---

You are implementing a new WebGPU fluid visual renderer inspired by the bright/blooming technique documented in this folder. Do not blindly copy the upstream WebGL source. Reimplement the technique in our codebase using WebGPU/WGSL. If you import or closely translate any upstream source code, preserve the MIT license/copyright notice described in `09_attribution_license.md`.

## Goal

Build a WebGPU renderer that reproduces the important visual mechanism:

```txt
additive overbright dye splats -> rgba16float internal dye -> soft-knee bloom from HDR dye -> blurred bloom chain -> gamma-lifted additive bloom composite -> final canvas presentation
```

The renderer must not rely on a real HDR canvas. The baseline must work with `navigator.gpu.getPreferredCanvasFormat()` and internal `rgba16float` offscreen textures.

## Required implementation phases

### Phase 1 — Brightness skeleton

Implement:

1. WebGPU context/device setup.
2. Fullscreen triangle pipeline.
3. `PingPongTexture` helper.
4. `rgba16float` dye ping-pong texture.
5. Additive splat pass:
   - sample base dye
   - compute aspect-correct Gaussian
   - output `base + gaussian * color`
   - no clamp
6. Display pass to canvas.
7. Debug views:
   - dye raw
   - dye energy / 8
   - overbright mask

Acceptance:

- A synthetic splat with color `(0.0, 4.0, 12.0)` produces dye values over `1.0`.
- Overbright debug mode shows non-black pixels.

### Phase 2 — Bloom

Implement:

1. `rgba16float` bloom chain.
2. Soft-knee bloom prefilter.
3. Four-tap or separable blur/downsample.
4. Upsample/combine or equivalent accumulated bloom.
5. Display composite that samples dye and bloom.
6. Gamma-lift bloom before adding it to base.
7. Exposure/tone mapping for SDR output.

Reference parameters:

```txt
BLOOM_RESOLUTION: 256
BLOOM_ITERATIONS: 8
BLOOM_INTENSITY: 0.8
BLOOM_THRESHOLD: 0.6
BLOOM_SOFT_KNEE: 0.7
```

Acceptance:

- Bloom debug is non-black for overbright dye.
- Composite looks visibly brighter and glowy than dye-only.
- Disabling bloom clearly removes the glow.

### Phase 3 — Fluid movement

Implement:

1. Velocity ping-pong texture, preferably `rg16float` or fallback `rgba16float`.
2. Velocity splat from pointer delta times `SPLAT_FORCE`.
3. Advection pass for velocity and dye.
4. Density and velocity dissipation.

Reference parameters:

```txt
SIM_RESOLUTION: 128
DYE_RESOLUTION: 1024
DENSITY_DISSIPATION: 1.0
VELOCITY_DISSIPATION: 0.2
SPLAT_RADIUS: 0.25
SPLAT_FORCE: 6000
```

Acceptance:

- Dye stretches and flows with pointer movement.
- Brightness/bloom survives advection.

### Phase 4 — Solver polish

Implement:

1. Curl pass.
2. Vorticity confinement.
3. Divergence pass.
4. Pressure ping-pong with ~20 Jacobi iterations.
5. Gradient subtract.
6. Optional fake shading from dye gradients.
7. Optional sunrays.

Reference parameters:

```txt
PRESSURE: 0.8
PRESSURE_ITERATIONS: 20
CURL: 30
SUNRAYS: true
SUNRAYS_WEIGHT: 1.0
```

Acceptance:

- Motion is swirly and stable.
- No WebGPU validation errors.
- Resize recreates textures/bind groups cleanly.

## Architecture constraints

- Use offscreen float textures for internal dye and bloom.
- Do not use canvas format for dye or bloom.
- Do not clamp before bloom.
- Use ping-pong resources for every read/write state field.
- Avoid per-frame texture allocation.
- Clamp `dt` to avoid exploding after tab stalls.
- Prefer `alphaMode: 'opaque'` for fullscreen renderer.
- Add debug labels to all textures/pipelines.

## WGSL references

Use `04_shader_math_wgsl_templates.md` for shader formulas. Translate them into project conventions, but preserve the math and pass order.

## Debug acceptance tests

Implement a debug UI or constants for:

```txt
DebugView.Composite
DebugView.DyeEnergyDiv8
DebugView.OverbrightMask
DebugView.BloomPrefilter
DebugView.BloomFinal
```

Run these checks:

1. Strong static splat `(0, 4, 12)` creates overbright dye.
2. Bloom prefilter is non-black at threshold `0.6`.
3. Bloom final is broad after 6–8 levels.
4. Composite is glowy through SDR canvas.
5. Temporarily changing dye to `rgba8unorm` weakens glow, proving the HDR path matters.

## Deliverables

- WebGPU renderer module.
- WGSL shader modules or string literals.
- Resource manager for textures/bind groups.
- Minimal demo page/canvas hookup.
- Debug controls.
- Short README explaining the internal HDR/bloom path.

---
