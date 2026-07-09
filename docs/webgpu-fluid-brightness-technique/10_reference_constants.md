# 10 — Reference Constants and Presets

## Upstream-style defaults

```ts
export const fluidDefaults = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 1024,
  CAPTURE_RESOLUTION: 512,

  DENSITY_DISSIPATION: 1.0,
  VELOCITY_DISSIPATION: 0.2,
  PRESSURE: 0.8,
  PRESSURE_ITERATIONS: 20,
  CURL: 30,

  SPLAT_RADIUS: 0.25,
  SPLAT_FORCE: 6000,

  SHADING: true,
  COLORFUL: true,
  COLOR_UPDATE_SPEED: 10,

  BLOOM: true,
  BLOOM_ITERATIONS: 8,
  BLOOM_RESOLUTION: 256,
  BLOOM_INTENSITY: 0.8,
  BLOOM_THRESHOLD: 0.6,
  BLOOM_SOFT_KNEE: 0.7,

  SUNRAYS: true,
  SUNRAYS_RESOLUTION: 196,
  SUNRAYS_WEIGHT: 1.0,
};
```

## WebGPU-specific defaults

```ts
export const webgpuFluidDefaults = {
  canvasAlphaMode: "opaque" as GPUCanvasAlphaMode,
  canvasFormatMode: "preferred-sdr",

  dyeFormat: "rgba16float" as GPUTextureFormat,
  velocityFormat: "rg16float" as GPUTextureFormat,
  scalarFormat: "r16float" as GPUTextureFormat,
  bloomFormat: "rgba16float" as GPUTextureFormat,

  useManualBilerp: false,
  clampDt: 1 / 30,

  dyeEnergy: 6.0,
  exposure: 1.2,
  toneMapper: "aces",
  gammaLiftBloom: true,
};
```

## Recommended presets

### Baseline faithful

```ts
export const presetFaithful = {
  simResolution: 128,
  dyeResolution: 1024,
  densityDissipation: 1.0,
  velocityDissipation: 0.2,
  pressure: 0.8,
  pressureIterations: 20,
  curl: 30,
  splatRadius: 0.25,
  splatForce: 6000,
  dyeEnergy: 6.0,
  bloomIterations: 8,
  bloomResolution: 256,
  bloomIntensity: 0.8,
  bloomThreshold: 0.6,
  bloomSoftKnee: 0.7,
  exposure: 1.15,
  toneMapper: "aces",
  gammaLiftBloom: true,
};
```

### Performance/mobile

```ts
export const presetMobile = {
  simResolution: 64,
  dyeResolution: 512,
  densityDissipation: 1.0,
  velocityDissipation: 0.25,
  pressure: 0.8,
  pressureIterations: 12,
  curl: 24,
  splatRadius: 0.28,
  splatForce: 4500,
  dyeEnergy: 5.0,
  bloomIterations: 5,
  bloomResolution: 128,
  bloomIntensity: 0.75,
  bloomThreshold: 0.6,
  bloomSoftKnee: 0.7,
  exposure: 1.1,
};
```

### Neon/high-energy

```ts
export const presetNeon = {
  simResolution: 128,
  dyeResolution: 1024,
  densityDissipation: 0.85,
  velocityDissipation: 0.16,
  pressure: 0.82,
  pressureIterations: 20,
  curl: 38,
  splatRadius: 0.18,
  splatForce: 8000,
  dyeEnergy: 10.0,
  bloomIterations: 8,
  bloomResolution: 256,
  bloomIntensity: 1.2,
  bloomThreshold: 0.45,
  bloomSoftKnee: 0.8,
  exposure: 1.35,
};
```

### Premium dark/background

```ts
export const presetPremiumDark = {
  simResolution: 96,
  dyeResolution: 768,
  densityDissipation: 1.2,
  velocityDissipation: 0.22,
  pressure: 0.8,
  pressureIterations: 16,
  curl: 28,
  splatRadius: 0.22,
  splatForce: 5500,
  dyeEnergy: 4.0,
  bloomIterations: 7,
  bloomResolution: 192,
  bloomIntensity: 0.65,
  bloomThreshold: 0.7,
  bloomSoftKnee: 0.5,
  exposure: 1.05,
};
```

## Bloom curve utility

```ts
export function getBloomCurve(threshold: number, softKnee: number) {
  const knee = threshold * softKnee + 0.0001;
  return {
    curve: [threshold - knee, knee * 2, 0.25 / knee, 0] as const,
    threshold,
  };
}
```

## Color palette energy utility

```ts
export function toDyeEnergyColor(
  linearRgb: [number, number, number],
  energy: number,
): [number, number, number] {
  return [linearRgb[0] * energy, linearRgb[1] * energy, linearRgb[2] * energy];
}
```

## Pointer splat utility

```ts
export function computeSplat(
  pointer: {
    uv: [number, number];
    delta: [number, number];
    colorLinear: [number, number, number];
  },
  cfg: {
    splatForce: number;
    dyeEnergy: number;
  },
) {
  return {
    velocityColor: [pointer.delta[0] * cfg.splatForce, pointer.delta[1] * cfg.splatForce, 0] as [
      number,
      number,
      number,
    ],
    dyeColor: toDyeEnergyColor(pointer.colorLinear, cfg.dyeEnergy),
  };
}
```

## Recommended debug constants

```ts
export const debugSplat = {
  point: [0.5, 0.5] as [number, number],
  radius: 0.08,
  color: [0.0, 4.0, 12.0] as [number, number, number],
};
```

Expected debug result:

```txt
max dye channel > 1.0
bloom prefilter non-black
bloom final soft halo
composite visibly brighter than dye-only
```
