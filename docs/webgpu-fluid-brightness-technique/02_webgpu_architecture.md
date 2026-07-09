# 02 — WebGPU Architecture

## Render path overview

Use WebGPU as a render-pass based full-screen quad/triangle pipeline. The port can be implemented with fragment shaders first; compute shaders can be introduced later, but they are not necessary for the visual technique.

```txt
Canvas/WebGPU context
  -> device/queue
  -> fullscreen triangle vertex shader
  -> pass pipelines
  -> offscreen float textures
  -> final canvas texture
```

## Required texture classes

### Ping-pong texture abstraction

Every simulated field that reads previous state and writes next state needs ping-pong storage:

```ts
interface PingPongTexture {
  read: GPUTexture;
  readView: GPUTextureView;
  write: GPUTexture;
  writeView: GPUTextureView;
  width: number;
  height: number;
  format: GPUTextureFormat;
  swap(): void;
}
```

Do not bind the same texture as a sampled source and render target in one pass. WebGPU validation will reject it, and even if it did not, the result would be undefined.

### Recommended formats

| Resource            | Format                                              | Why                                                                   |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| Dye                 | `rgba16float`                                       | Stores overbright RGB energy. Alpha can be unused or derived.         |
| Velocity            | `rg16float`                                         | Stores XY velocity. Use `rgba16float` if adapter/device issues arise. |
| Divergence          | `r16float`                                          | Scalar. Use `rgba16float` fallback for simplicity.                    |
| Curl                | `r16float`                                          | Scalar vorticity. Use `rgba16float` fallback for simplicity.          |
| Pressure            | `r16float` ping-pong                                | Scalar pressure solve. Use `rgba16float` fallback for simplicity.     |
| Bloom chain         | `rgba16float`                                       | Must preserve overbright bloom energy.                                |
| Sunrays mask        | `rgba16float` or `r16float`                         | Alpha/brightness mask. Simpler as rgba.                               |
| Canvas SDR          | `navigator.gpu.getPreferredCanvasFormat()`          | Usually `rgba8unorm` or `bgra8unorm`, final pass only.                |
| Canvas HDR optional | `rgba16float` + `toneMapping: { mode: 'extended' }` | Optional where supported. Still keep the internal bloom stack.        |

For maximum portability during first implementation, use `rgba16float` for all scalar fields. Optimize to `rg16float`/`r16float` once the render graph is stable.

## Texture usage flags

For offscreen render-pass textures:

```ts
const usage =
  GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.TEXTURE_BINDING |
  GPUTextureUsage.COPY_SRC |
  GPUTextureUsage.COPY_DST;
```

`COPY_SRC` is useful for debugging readbacks. `COPY_DST` is useful for clears/uploads. Remove them later if desired.

For compute/storage variants, add `GPUTextureUsage.STORAGE_BINDING` only to textures that are actually written by compute shaders.

## Samplers

Use two samplers:

```ts
const linearSampler = device.createSampler({
  magFilter: "linear",
  minFilter: "linear",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
});

const nearestSampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge",
});
```

Use linear sampling for dye/advection and bloom where available. Use nearest for pressure/curl/divergence if matching the grid math strictly.

If a texture format/device combination cannot use filtering where needed, implement manual bilinear sampling in WGSL using four `textureSampleLevel` calls with the nearest sampler.

## Canvas configuration

### Baseline SDR path

```ts
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format: canvasFormat,
  alphaMode: "opaque",
});
```

Use this for the reliable baseline. All HDR-like work happens offscreen in float textures, then the display pass compresses it into SDR.

### Optional HDR canvas path

Where supported:

```ts
context.configure({
  device,
  format: "rgba16float",
  alphaMode: "opaque",
  toneMapping: { mode: "extended" },
});
```

Do not rely on this for the look. Treat it as an optional enhancement. The demo-style bloom look must work through the SDR path too.

## Bind group model

Prefer a small set of reusable layouts:

### Single source texture pass

```txt
binding 0: sampler
binding 1: texture_2d<f32>
binding 2: uniform buffer: texelSize, dt, dissipation, etc.
```

### Two source texture pass

```txt
binding 0: sampler
binding 1: primary texture
binding 2: secondary texture
binding 3: uniform buffer
```

### Splat pass

```txt
binding 0: sampler
binding 1: target texture read view
binding 2: uniform buffer:
  point: vec2f
  color: vec3f or vec4f
  radius: f32
  aspectRatio: f32
```

### Display pass

```txt
binding 0: linear sampler
binding 1: dye texture
binding 2: bloom texture
binding 3: sunrays texture, optional
binding 4: dithering/noise texture, optional
binding 5: display uniform buffer
```

## Pipeline inventory

Minimum pipelines for the visual technique:

```txt
copy / clear
splat
advection
curl
vorticity
pressure divergence
pressure solve
gradient subtract
bloom prefilter
bloom blur/downsample
bloom final/upsample/combine
display
```

You can initially stub the fluid solver and still validate the brightness stack with only:

```txt
clear dye
splat dye
bloom prefilter
bloom blur
display
```

That is the fastest route to verify the “bright like Pavel” look before spending time on pressure projection.

## Uniform buffer alignment

WebGPU uniform buffers require careful alignment. Prefer structs padded to 16-byte boundaries.

Example splat uniform:

```wgsl
struct SplatUniforms {
  point: vec2f,
  radius: f32,
  aspect_ratio: f32,
  color: vec4f,
};
```

Example display uniform:

```wgsl
struct DisplayUniforms {
  texel_size: vec2f,
  dither_scale: vec2f,
  bloom_intensity: f32,
  exposure: f32,
  gamma_mode: f32,
  _pad0: f32,
};
```

## Resize/reallocation policy

On canvas resize:

1. Recompute dye and sim resolution from aspect ratio.
2. Recreate all offscreen textures.
3. Preserve old dye/velocity by rendering/copying into new textures if desired.
4. Recreate bloom chain from configured bloom base resolution.
5. Recreate any bind groups holding old texture views.

Do not update views in place; WebGPU views are tied to texture objects.

## Initial implementation phases

### Phase 1 — brightness skeleton

```txt
canvas -> offscreen rgba16float dye -> additive splat -> bloom -> display
```

Acceptance: one mouse drag produces bloom brighter than base dye.

### Phase 2 — fluid movement

Add velocity splats and dye advection.

Acceptance: dye flows and stretches, but brightness remains.

### Phase 3 — pressure projection

Add divergence, pressure iterations, and gradient subtract.

Acceptance: motion becomes swirly and incompressible-looking.

### Phase 4 — polish

Add vorticity confinement, sunrays, fake shading, palettes, responsive scaling, and performance throttles.
