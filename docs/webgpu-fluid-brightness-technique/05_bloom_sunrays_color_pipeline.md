# 05 — Bloom, Sunrays, and Color Pipeline

## Brightness is an art-directed HDR-to-SDR pipeline

The display target does not need to be real HDR. The technique uses HDR-like internal buffers and compresses them into a bright SDR image.

The working pipeline is:

```txt
linear internal dye energy
  -> soft-knee bloom extraction
  -> blurred bloom chain
  -> gamma lift bloom
  -> add to base dye
  -> tone map/exposure
  -> sRGB/canvas output
```

## Color spaces and energy

Treat palette colors as linear RGB energy multipliers, not final CSS colors.

Example:

```ts
const cssLike = [0.2, 0.6, 1.0];
const dyeEnergy = 6.0;
const splatColor = cssLike.map((c) => c * dyeEnergy); // [1.2, 3.6, 6.0]
```

If you inject `[0.2, 0.6, 1.0]` directly and store it in `rgba8unorm`, bloom will be weak or absent.

## Bloom prefilter tuning

Reference values:

```txt
threshold: 0.6
softKnee:  0.7
intensity: 0.8
levels:    8
baseRes:   256
```

Interpretation:

- `threshold` controls when color energy becomes bloom.
- `softKnee` controls how gradually near-threshold values enter bloom.
- `intensity` controls how much blurred energy is added back.
- `levels` controls bloom width/radius.
- `baseRes` controls performance and softness.

## Practical WebGPU recipes

### Pavel-like default

```txt
dyeEnergy:           4.0..8.0
threshold:           0.60
softKnee:            0.70
bloomIntensity:      0.80
bloomLevels:         7..8
bloomBaseResolution: 256
exposure:            1.0..1.4
toneMapper:          ACES or Reinhard
bloomGammaLift:      on
```

### Punchier neon

```txt
dyeEnergy:           8.0..14.0
threshold:           0.45
softKnee:            0.80
bloomIntensity:      1.0..1.4
bloomLevels:         8..9
exposure:            1.2..1.8
toneMapper:          ACES
baseDyeDimming:      optional 0.85 before bloom add
```

### Dark premium/background version

```txt
dyeEnergy:           2.0..5.0
threshold:           0.70
softKnee:            0.50
bloomIntensity:      0.45..0.75
bloomLevels:         6..8
exposure:            0.9..1.2
background:          near-black
```

### Audio-reactive live-performance variant

Map audio bands to internal energy, not final brightness:

```txt
low-band transient    -> velocity force and curl
mid-band energy       -> splat radius
high-band transient   -> dyeEnergy and bloomIntensity impulse
spectral centroid     -> palette hue shift
RMS/short-term loudness -> exposure within bounded range
```

Bound everything:

```ts
const dyeEnergy = clamp(2.0 + transient * 10.0, 2.0, 14.0);
const exposure = clamp(1.0 + loudness * 0.6, 0.9, 1.8);
const bloomIntensity = clamp(0.6 + highs * 0.8, 0.4, 1.4);
```

## Gamma-lifted bloom

The upstream display shader applies a gamma curve to bloom before adding it to the base image. This is not physically strict, but it is visually important.

Without gamma-lift:

```txt
base + bloom_linear -> toneMap
```

With gamma-lift:

```txt
base + linearToGamma(bloom_linear) -> toneMap
```

The second version makes medium-strength bloom appear hotter and more present on SDR screens.

## Tone mapper choice

### ACES

Good for premium/cinematic visuals:

```wgsl
fn aces_filmic(c: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c2 = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((c * (a * c + b)) / (c * (c2 * c + d) + e), vec3f(0.0), vec3f(1.0));
}
```

### Reinhard

Simple and smooth, but can look flatter:

```wgsl
fn reinhard(c: vec3f) -> vec3f {
  return c / (vec3f(1.0) + c);
}
```

### Direct clamp

Use only for debugging:

```wgsl
return clamp(c, vec3f(0.0), vec3f(1.0));
```

Direct clamp often appears harsh and destroys gradients in hot regions.

## Sunrays

Sunrays are optional. They add radial light shafts by using the dye image as an occlusion/emission mask.

Conceptual pipeline:

```txt
dye brightness -> alpha mask -> radial blur toward center -> multiply base/bloom by sunrays factor
```

Approximate mask:

```wgsl
let br = max(c.r, max(c.g, c.b));
let alpha = 1.0 - min(max(br * 20.0, 0.0), 0.8);
```

Radial blur shape:

```wgsl
var coord = uv;
let dir = (uv - vec2f(0.5)) * density / iterations;
var illumination = 1.0;
var color = maskAt(uv);
for i in 0..iterations:
  coord -= dir;
  color += maskAt(coord) * illumination * weight;
  illumination *= decay;
return color * exposure;
```

Reference parameters:

```txt
iterations: 16
density:    0.3
decay:      0.95
exposure:   0.7
weight:     1.0
```

## Fake shading

The upstream-style shading uses local dye gradient magnitude to fake surface relief. It samples left/right/top/bottom dye, computes a normal from length differences, and multiplies base dye by a diffuse factor.

Visual effect:

- Edges feel raised.
- Flow has more depth.
- Bloom has a stronger boundary because base brightness varies spatially.

This is optional but cheap and high-impact.

## Dithering/noise

Adding tiny noise to bloom before gamma conversion reduces banding:

```txt
noise = randomOrBlueNoise(uv) * 2 - 1
bloom += noise / 255
```

A small LDR noise/blue-noise texture is enough. Use repeat wrapping or UV scaling. Do not overdo it; it should not be visible as grain.

## Alpha handling

Use `alphaMode: 'opaque'` unless the renderer must composite over HTML.

For a full-screen visual system, opaque is easier and prevents accidental premultiplied-alpha darkening.

If transparency is required, compute alpha intentionally:

```txt
alpha = saturate(max(color.r, color.g, color.b))
```

Then verify that the browser compositor is not dimming premultiplied color.

## Common brightness killers

| Symptom                            | Likely cause                                           | Fix                                                     |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| Bloom never appears                | Bloom extraction after tone map/clamp                  | Extract from HDR dye before display.                    |
| Splat visible but not hot          | Dye color limited to 0..1                              | Multiply palette by 3..10 internal energy.              |
| Looks flat/gray                    | Tone mapper/exposure too conservative                  | Increase exposure or use gamma-lifted bloom.            |
| Glow is tiny                       | Too few bloom levels or base resolution too high       | Add levels/downsampling or lower bloom base resolution. |
| Glow is blocky                     | Too little blur or too low bloom resolution            | Add separable blur or final blur.                       |
| Was bright in WebGL but not WebGPU | Using canvas/preferred format for intermediate buffers | Use offscreen `rgba16float` for dye/bloom.              |
