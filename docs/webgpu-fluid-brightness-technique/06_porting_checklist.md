# 06 — Porting Checklist

## Non-negotiables

- [ ] Dye buffer is `rgba16float` or equivalent float HDR storage.
- [ ] Bloom buffers are `rgba16float`.
- [ ] Splat pass writes `base + gaussian * color`.
- [ ] Splat color can exceed `1.0` internally.
- [ ] No clamp/saturate before bloom prefilter.
- [ ] Bloom prefilter reads the current HDR dye texture.
- [ ] Final canvas pass is the only SDR compression point.
- [ ] Ping-pong resources are used for dye, velocity, and pressure.
- [ ] Same texture is never sampled and rendered into in a single pass.
- [ ] `alphaMode` is intentionally chosen, preferably `opaque`.

## Implementation sequence

### Milestone A — WebGPU boot and fullscreen pass

- [ ] Request adapter/device.
- [ ] Configure canvas.
- [ ] Create fullscreen triangle pipeline.
- [ ] Draw a solid color.
- [ ] Draw a sampled offscreen texture to canvas.

Acceptance:

```txt
Canvas presents a generated offscreen texture without validation errors.
```

### Milestone B — HDR dye target

- [ ] Create `dye` ping-pong as `rgba16float`.
- [ ] Clear dye to black.
- [ ] Render dye to canvas through display pass.
- [ ] Add debug view that maps dye energy `/ 8.0`.

Acceptance:

```txt
Debug view can show values above 1.0 when injected manually.
```

### Milestone C — Additive dye splat

- [ ] Implement splat pipeline.
- [ ] Pointer events produce UV and aspect-correct radius.
- [ ] Inject dye color with energy multiplier.
- [ ] Splat pass writes to `dye.write`, then swaps.

Acceptance:

```txt
Dragging creates visible color. Debug overbright view shows pixels > 1.0.
```

### Milestone D — Bloom stack

- [ ] Create bloom chain: base 256-ish, descending halves.
- [ ] Implement soft-knee prefilter.
- [ ] Implement blur/downsample.
- [ ] Implement upsample/combine or chained accumulation.
- [ ] Implement final bloom intensity.
- [ ] Add display debug modes: `dye`, `bloomPrefilter`, `bloomFinal`, `composite`.

Acceptance:

```txt
Bloom debug is non-black for bright splats.
Composite is visibly brighter than dye-only.
```

### Milestone E — Display polish

- [ ] Add gamma-lifted bloom before base add.
- [ ] Add tone mapper and exposure.
- [ ] Add optional fake shading.
- [ ] Add dither/noise.

Acceptance:

```txt
Image has hot bloom, not just a blurred overlay.
```

### Milestone F — Velocity and advection

- [ ] Create velocity ping-pong texture.
- [ ] Add velocity splat using pointer delta * force.
- [ ] Implement advection.
- [ ] Advect velocity and dye.

Acceptance:

```txt
Dye moves, stretches, and fades slowly without losing bloom.
```

### Milestone G — Projection and vorticity

- [ ] Create divergence, curl, pressure ping-pong.
- [ ] Implement curl pass.
- [ ] Implement vorticity confinement.
- [ ] Implement divergence pass.
- [ ] Implement pressure clear/decay.
- [ ] Run pressure Jacobi iterations.
- [ ] Implement gradient subtract.

Acceptance:

```txt
Flow becomes swirly and incompressible-looking. Brightness remains unchanged.
```

### Milestone H — Sunrays and variant-specific behavior

- [ ] Add sunrays mask.
- [ ] Add radial blur.
- [ ] Multiply base/bloom by sunrays in display.
- [ ] Add palette and audio/input modulation.

Acceptance:

```txt
Sunrays are optional and can be toggled without changing the main bloom brightness.
```

## Definition of done

The WebGPU variant is ready when:

1. Dragging quickly produces color values above `1.0` in dye.
2. Bloom prefilter is non-black before display.
3. Bloom final has a broad glow radius.
4. Display composite is brighter than dye-only.
5. Switching the canvas format from SDR preferred format to optional HDR path is not required for the aesthetic.
6. No WebGPU validation errors occur during resize or ping-pong swaps.
7. Performance remains stable at target resolution.

## Test scenes

### Static hot splat

On startup, inject one large splat:

```txt
center: (0.5, 0.5)
radius: 0.08
color: (0.0, 3.0, 8.0)
```

Expected:

- Dye-only shows a blue/cyan blob.
- Overbright debug shows center as over 1.0.
- Bloom debug shows a halo.
- Composite has a bright center and soft glow.

### Repeated accumulation

Inject the same splat for 30 frames.

Expected:

- Dye energy increases.
- Bloom grows stronger.
- If it saturates too harshly, tone mapping/exposure is too aggressive.

### Bloom threshold sweep

Run threshold values:

```txt
0.3, 0.6, 0.9, 1.2
```

Expected:

- Low threshold: many regions glow.
- High threshold: only hot cores glow.
- If all thresholds look the same, prefilter math or input range is wrong.

### Format sabotage test

Temporarily change dye to `rgba8unorm`.

Expected:

- Bloom weakens or disappears.
- This validates that the float path is actually responsible.

Do not ship with the sabotage format.

## Performance checklist

- [ ] Use lower simulation resolution than dye resolution.
- [ ] Bloom starts at 128–256 px on the smaller axis.
- [ ] Reuse bind groups where texture views are stable.
- [ ] Recreate bind groups only after swaps/resizes if needed.
- [ ] Avoid CPU readbacks except in debug mode.
- [ ] Avoid per-frame texture allocation.
- [ ] Clamp `dt`.
- [ ] Pause/reduce resolution when tab hidden.

## API safety checklist

- [ ] Each texture has correct usage flags.
- [ ] Uniform buffers are 16-byte aligned.
- [ ] Render target format matches pipeline color target format.
- [ ] Canvas texture is acquired once per frame.
- [ ] `device.lost` is handled or logged.
- [ ] Resize does not use destroyed textures.
- [ ] Optional HDR canvas path is feature-detected or guarded.
