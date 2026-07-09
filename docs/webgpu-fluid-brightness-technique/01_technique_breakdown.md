# 01 — Technique Breakdown

## What makes the demo bright

The visual brightness is not caused by WebGL itself. It is a deliberate HDR-style post-processing stack:

```txt
pointer/mouse input
  -> additive velocity splat
  -> additive dye splat with high internal color energy
  -> dye advection with slow dissipation
  -> bloom prefilter from unclamped HDR dye
  -> multi-resolution blur/downsample chain
  -> final display pass: dye + gamma-lifted bloom + optional sunrays/shading
```

The important mental model is:

> The fluid buffer is a carrier of color energy, not a final display image.

The dye texture must be allowed to hold values greater than `1.0`. The canvas may eventually clamp or tone-map, but the bloom extraction must happen before that clamp.

## Upstream facts to preserve

The public implementation uses these default visual controls:

```txt
SIM_RESOLUTION:        128
DYE_RESOLUTION:        1024
DENSITY_DISSIPATION:   1
VELOCITY_DISSIPATION:  0.2
PRESSURE:              0.8
PRESSURE_ITERATIONS:   20
CURL:                  30
SPLAT_RADIUS:          0.25
SPLAT_FORCE:           6000
BLOOM:                 true
BLOOM_ITERATIONS:      8
BLOOM_RESOLUTION:      256
BLOOM_INTENSITY:       0.8
BLOOM_THRESHOLD:       0.6
BLOOM_SOFT_KNEE:       0.7
SUNRAYS:               true
SUNRAYS_RESOLUTION:    196
SUNRAYS_WEIGHT:        1.0
```

Observed upstream locations on 2026-07-08:

- Config defaults: `script.js`, around lines 84–135 in the GitHub source.
- WebGL half-float render target selection: around lines 200–237.
- Display shader: around lines 878–975.
- Bloom prefilter/blur/final shaders: around lines 981–1079.
- Splat shader: around lines 1158–1189.
- Advection shader: around lines 1191–1248.
- FBO initialization: around lines 1582 onward.

## The additive splat is the root of the brightness

The splat pass conceptually does this:

```wgsl
let p = uv - splat_center;
let gaussian = exp(-dot(p, p) / radius);
let injected = gaussian * splat_color;
output = existing_dye + injected;
```

The critical part is `existing_dye + injected`. It accumulates. It does not replace. It does not clamp to `[0, 1]`.

In a WebGPU port, the dye splat should write into an offscreen float target:

```txt
source: dye.read  rgba16float
write:  dye.write rgba16float
result: dye.swap()
```

For the visual style, `splat_color` should often represent internal energy, not CSS color. A good practical range is:

```txt
subtle:      1.0..2.5 per channel
bright:      2.5..8.0 per channel
explosive:   8.0..20.0 per channel for brief impacts
```

Then bloom decides what becomes visibly luminous.

## Half-float/HDR internal storage is mandatory

The upstream implementation checks for floating/half-floating renderable formats and uses half-float textures for dye, velocity, divergence, curl, pressure, and bloom buffers.

WebGPU equivalent:

```txt
dye:        rgba16float, ping-pong
velocity:   rg16float or rgba16float, ping-pong
divergence: r16float or rgba16float
curl:       r16float or rgba16float
pressure:   r16float or rgba16float, ping-pong
bloom:      rgba16float chain
sunrays:    r16float or rgba16float
canvas:     preferred SDR format or rgba16float HDR canvas, final pass only
```

The most common WebGPU mistake is using `rgba8unorm` for dye or bloom. That silently converts/clamps energy into the `[0, 1]` range and kills the look.

## Bloom prefilter uses a soft knee

The bloom prefilter is not a simple hard threshold. It uses a knee region around the threshold so that near-threshold highlights enter bloom gradually.

Conceptual formula:

```txt
threshold = 0.6
softKnee  = 0.7
knee      = threshold * softKnee + epsilon
curve.x   = threshold - knee
curve.y   = 2 * knee
curve.z   = 0.25 / knee

brightness = max(color.r, color.g, color.b)
soft        = clamp(brightness - curve.x, 0, curve.y)
soft        = curve.z * soft * soft
contribution = max(soft, brightness - threshold) / max(brightness, 0.0001)
bloomColor   = color * contribution
```

This lets saturated fluid edges glow before they are pure white.

## Blur chain shape

A practical bloom chain is:

```txt
bloom0: 256xN or Nx256, rgba16float
bloom1: half bloom0
bloom2: half bloom1
...
8 levels total by default when dimensions allow
```

Each level receives a simple blur/downsample. Then the chain is combined/upsampled back into the base bloom target. A four-tap average is enough to reproduce the broad soft glow; a separable Gaussian can be substituted for higher quality.

## Final display pass must add bloom after sampling dye

The upstream display logic does these visual operations:

1. Sample base dye.
2. Optionally multiply by fake shading derived from dye gradients.
3. Optionally multiply base and bloom by sunrays.
4. Add small dither/noise to bloom.
5. Gamma-lift bloom.
6. Add bloom into base dye.
7. Output to canvas.

The key implementation point:

```txt
final_color = display_tonemap(base_dye + gamma_lift(bloom))
```

Do not do:

```txt
final_color = display_tonemap(base_dye)
bloom = extract(final_color)
```

That extracts from an already-compressed/clamped image and will look weak.

## The exact “brightness stack” in one dependency graph

```txt
[Pointer velocity/delta]
   |
   |--> [velocity splat] rg16float
   |
   '--> [dye splat] rgba16float: base + gaussian * overbright_color
             |
             v
       [advect dye] rgba16float, dissipation around 1.0
             |
             +--> [display base]
             |
             '--> [bloom prefilter from HDR dye]
                    -> [downsample/blur chain]
                    -> [upsample/combine]
                    -> [gamma lift + add to base]
                    -> [tone map/gamma/SDR canvas]
```

## What can be changed safely for a new variant

Safe to change:

- Color palette generation.
- Splat radius and injection energy.
- Bloom threshold/intensity/iterations.
- Sunrays on/off.
- Display shading strength.
- Tone mapper.
- Fluid solver resolution.
- Velocity/dye dissipation.

Do not change until the baseline works:

- Float internal dye storage.
- Additive splat behavior.
- Bloom extraction before clamp/tone-map.
- Ping-pong read/write separation.
- Final compositing order.
