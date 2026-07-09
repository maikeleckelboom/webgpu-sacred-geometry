# 03 — Render Graph and Pass Order

## Frame structure

A full frame should be encoded in this order:

```txt
1. Update input state
2. Apply pointer splats to velocity and dye
3. Fluid simulation step
4. Bloom extraction and blur
5. Optional sunrays
6. Final display/composite to canvas
7. Submit command buffer
```

For visual fidelity, the bloom stage must use the dye texture **after** splats/advection and **before** final presentation.

## Minimal bright prototype frame

This is the smallest render graph that validates the bright technique:

```txt
for each frame:
  if pointer moved:
    splat(dye.read -> dye.write, overbright_color)
    dye.swap()

  bloom = buildBloom(dye.read)
  display(dye.read, bloom -> canvas)
```

This will already show the bright/glowy aesthetic even without real fluid dynamics.

## Full frame pass order

### 1. Input update

Update pointer data:

```ts
pointer.deltaX = currentX - previousX;
pointer.deltaY = currentY - previousY;
pointer.moved = abs(deltaX) + abs(deltaY) > epsilon;
pointer.color = palette.nextColor() * dyeEnergyScale;
```

Velocity splat color is force-like:

```txt
velocityColor = vec2(deltaX, deltaY) * SPLAT_FORCE
```

Dye splat color is HDR color energy:

```txt
dyeColor = paletteColor * dyeEnergy
```

### 2. Velocity splat

```txt
pipeline: splat
read:  velocity.read
write: velocity.write
uniforms:
  point = pointer.uv
  color = vec3(deltaX * SPLAT_FORCE, deltaY * SPLAT_FORCE, 0)
  radius = velocitySplatRadius
swap velocity
```

### 3. Dye splat

```txt
pipeline: splat
read:  dye.read
write: dye.write
uniforms:
  point = pointer.uv
  color = vec3(r, g, b) * dyeEnergy
  radius = dyeSplatRadius
swap dye
```

Use a separate radius for dye if you want softer color than velocity injection.

### 4. Curl pass

```txt
curl.write = curl(velocity.read)
```

### 5. Vorticity confinement

```txt
velocity.write = velocity.read + vorticityForce(curl, CURL) * dt
swap velocity
```

Vorticity confinement is a visual swirl amplifier. It is a major part of the satisfying motion, but it is not the reason for brightness.

### 6. Divergence pass

```txt
divergence.write = divergence(velocity.read)
```

### 7. Pressure clear/decay

```txt
pressure.write = pressure.read * PRESSURE
swap pressure
```

### 8. Pressure solve iterations

```txt
for i in 0..PRESSURE_ITERATIONS:
  pressure.write = jacobi(pressure.read, divergence)
  swap pressure
```

Default upstream-style iteration count is around `20`.

### 9. Gradient subtract

```txt
velocity.write = velocity.read - gradient(pressure.read)
swap velocity
```

### 10. Advect velocity

```txt
velocity.write = advect(
  velocityField = velocity.read,
  source        = velocity.read,
  dissipation   = VELOCITY_DISSIPATION,
  dt            = dt
)
swap velocity
```

### 11. Advect dye

```txt
dye.write = advect(
  velocityField = velocity.read,
  source        = dye.read,
  dissipation   = DENSITY_DISSIPATION,
  dt            = dt
)
swap dye
```

Dye must remain `rgba16float`; advection must not clamp.

### 12. Bloom prefilter

```txt
bloom[0] = bloomPrefilter(dye.read, threshold, softKnee)
```

This pass reads the HDR dye buffer directly.

### 13. Bloom downsample/blur chain

```txt
for i in 1..bloomLevels-1:
  bloom[i] = blurDownsample(bloom[i - 1])
```

The upstream visual uses roughly 8 iterations. Stop earlier if the level becomes too small.

### 14. Bloom upsample/combine

Two approaches are acceptable:

#### Approach A — mimic additive upsample

```txt
for i in reversed(1..bloomLevels-1):
  bloom[i - 1] += blurUpsample(bloom[i])
```

This is broad and luminous.

#### Approach B — accumulate in display pass

Bind all bloom levels and sum weighted samples. This is less convenient in WebGPU due to bind group limits and dynamic texture counts. Prefer Approach A.

### 15. Bloom final intensity

```txt
bloomFinal = blur(bloom[0]) * BLOOM_INTENSITY
```

Use a final blur/tap to reduce blockiness.

### 16. Optional sunrays

Sunrays are optional for the first WebGPU variant. If included:

```txt
sunMask = brightnessToAlphaMask(dye.read)
sunrays = radialBlurFromCenter(sunMask)
```

Then multiply base dye and bloom by `sunrays` in the display pass.

### 17. Display pass

```txt
base = sample(dye)
base = applyFakeShading(base, dyeNeighbors) optional
bloom = sample(bloomFinal)
bloom += ditherNoise / 255
bloom = linearToGamma(max(bloom, 0))
color = base + bloom
color = toneMap(color, exposure)
out = encodeToCanvas(color)
```

For the “Pavel-like” look, gamma-lift bloom before adding it.

## Ping-pong safety rules

1. Never sample from the current render attachment.
2. Swap immediately after a pass that writes next state.
3. Rebuild bind groups or use dynamic resource wrappers after swapping.
4. Name textures in debug labels: `dye.read`, `dye.write`, etc.
5. For pressure iterations, avoid allocation per iteration. Reuse the two pressure textures.

## Command encoder strategy

Simplest structure:

```ts
const encoder = device.createCommandEncoder();

runPass(encoder, splatPipeline, velocity.writeView, ...);
velocity.swap();

runPass(encoder, splatPipeline, dye.writeView, ...);
dye.swap();

// fluid passes...
// bloom passes...

const canvasView = context.getCurrentTexture().createView();
runPass(encoder, displayPipeline, canvasView, ...);

device.queue.submit([encoder.finish()]);
```

Do not create a separate command buffer for every pass unless debugging. One command encoder per frame is fine.

## Timing and dt

Clamp `dt` to avoid explosion after tab stalls:

```ts
const dt = Math.min((now - lastNow) / 1000, 1 / 30);
```

The upstream aesthetic is not physically exact; stable, responsive motion is more important than strict simulation time.

## Pass validation order

Implement in this order:

1. Fullscreen triangle to canvas.
2. Clear `rgba16float` dye and display it.
3. Add one dye splat and display it.
4. Add bloom prefilter and display prefilter debug view.
5. Add blur chain and display bloom debug view.
6. Composite dye + bloom.
7. Add velocity and advection.
8. Add pressure projection.
9. Add vorticity.
10. Add sunrays/shading.

This order avoids losing days on fluid solver issues before proving the brightness stack.
