# 07 — Debugging Brightness in WebGPU

## First question: are there values above 1.0?

Add a debug display mode that outputs:

```wgsl
let c = sampleDye(uv).rgb;
let over = step(vec3f(1.0), c);
return vec4f(over, 1.0);
```

If this is black after splatting, the problem is before bloom.

Likely causes:

- Dye texture is `rgba8unorm`/`bgra8unorm`.
- Splat color is too small.
- Splat output is clamped.
- Wrong ping-pong binding: writing to one texture but displaying another.
- Splat radius is too tiny due to aspect/resolution mismatch.

## Second question: is bloom prefilter non-black?

Display prefilter output directly.

Expected:

```txt
A bright core/mask appears wherever dye brightness exceeds threshold or soft-knee range.
```

If dye overbright exists but prefilter is black:

- Threshold too high.
- Soft-knee curve wrong.
- Bloom prefilter reads the wrong texture.
- Bind group still points at old texture view after resize/swap.
- Texture sample type/sampler mismatch caused shader/pipeline fallback or validation issue.

## Third question: is blur chain preserving energy?

Display each bloom level:

```txt
bloom0: sharp-ish prefiltered image
bloom1: smaller, softer
bloom2: softer still
...
final: broad glow
```

If lower levels are black:

- Downsample source/destination dimensions are wrong.
- Texture view points to the wrong level/texture.
- Uniform texel size belongs to the destination instead of source, or vice versa.
- Clearing pass runs after blur and erases output.

## Fourth question: is final display killing it?

Temporarily bypass tone mapping:

```wgsl
return vec4f(clamp(base + bloom, vec3f(0.0), vec3f(1.0)), 1.0);
```

Then try:

```wgsl
return vec4f(linear_to_srgb_approx(clamp(base + linear_to_srgb_approx(bloom), vec3f(0.0), vec3f(1.0))), 1.0);
```

If the second looks closer, your issue is display transfer/tone mapping.

## WebGPU-specific traps

### Trap: using preferred canvas format internally

`navigator.gpu.getPreferredCanvasFormat()` is for presenting SDR content efficiently. It is usually an 8-bit unorm format. Do not use it for dye/bloom.

Correct:

```txt
internal dye/bloom: rgba16float
final canvas: preferred format
```

Wrong:

```txt
dye: preferred canvas format
bloom: preferred canvas format
```

### Trap: standard canvas tone mapping clamps

The default WebGPU canvas path is SDR. Values outside `[0, 1]` do not magically become visible unless you tone-map/compress them or use optional HDR configuration. The reliable path is to tone-map in the final shader.

### Trap: premultiplied alpha dimming

If `alphaMode: 'premultiplied'` and your shader outputs alpha below 1.0, the browser compositor may make the result appear dimmer.

For fullscreen visuals:

```ts
alphaMode: "opaque";
```

and shader:

```wgsl
return vec4f(color, 1.0);
```

### Trap: bind groups stale after ping-pong swap

If your bind group captures `dye.readView` at creation time, swapping the wrapper does not mutate the bind group.

Solutions:

1. Rebuild the bind group for passes whose inputs changed.
2. Store two bind groups per ping-pong direction.
3. Use a render graph helper that resolves current views each pass.

### Trap: using storage textures unnecessarily

A fragment-render-pass implementation does not need storage textures. Starting with storage textures increases validation complexity. Use render attachments plus sampled textures first.

### Trap: wrong coordinate scale in advection

Advection uses velocity in simulation units and texel size. If dye smears instantly or barely moves:

- Check `dt` clamp.
- Check velocity force scale.
- Check whether you used velocity texel size or dye texel size in the backtrace.

### Trap: gamma double-encoding

If the final is washed out or milky, you may be applying sRGB conversion twice.

Use one clear policy:

```txt
Internal textures: linear float.
Final shader: tone map + encode to target expectation.
Canvas format: know whether it is srgb/unorm and test visually.
```

For `rgba8unorm`/`bgra8unorm` canvas, many WebGPU examples output linear-ish values and the browser displays them. For a stylized renderer, choose the transfer empirically, but do not encode repeatedly.

## Debug UI switches

Expose these toggles:

```ts
enum DebugView {
  Composite,
  DyeRaw,
  DyeEnergyDiv8,
  OverbrightMask,
  BloomPrefilter,
  BloomFinal,
  Velocity,
  Curl,
  Divergence,
  Pressure,
}
```

Also expose numeric sliders:

```txt
dyeEnergy
bloomThreshold
bloomSoftKnee
bloomIntensity
exposure
splatRadius
curl
velocityDissipation
densityDissipation
```

## Diagnostic ladder

Run this exact ladder when it is not bright:

1. Set fluid solver off. Only splat dye.
2. Set splat color to `(0, 4, 12)`.
3. Display dye energy divided by 8.0.
4. Display overbright mask.
5. Display bloom prefilter.
6. Display bloom final.
7. Display composite with tone map disabled.
8. Display composite with gamma-lifted bloom enabled.
9. Re-enable advection.
10. Re-enable pressure/vorticity.

The first step where the image becomes wrong is the broken pass.

## Expected numeric ranges

These are rough but useful:

```txt
After one strong splat:
  dye max:          3..12
  bloom prefilter:  non-zero, often 1..10 near core
  bloom final:      0.05..3 after blur, depending on levels/intensity

After repeated dragging:
  dye max:          8..40 transiently
  final color:      compressed to 0..1 for SDR canvas
```

If dye max never exceeds 1.0, the HDR pipeline is not functioning.

## Simple CPU-side readback debug

In debug builds only, copy a small dye texture or mip-like debug buffer to CPU and compute max RGB.

Acceptance:

```txt
max(dye.rgb) > 1.0 after a strong splat
max(bloom.rgb) > 0.0 after prefilter
```

Do not read back full-resolution buffers every frame in production.
