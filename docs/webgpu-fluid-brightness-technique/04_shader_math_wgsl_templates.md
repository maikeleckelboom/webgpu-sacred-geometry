# 04 — Shader Math and WGSL Templates

These are implementation templates, not a drop-in complete renderer. They are designed to preserve the important math while fitting typical WebGPU/WGSL conventions.

## Fullscreen triangle vertex

Prefer a fullscreen triangle over a quad to avoid index buffers and diagonal interpolation seams.

```wgsl
struct VsOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );

  let p = positions[vertex_index];

  var out: VsOut;
  out.position = vec4f(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2f(0.5);
  return out;
}
```

## Neighbor UV helper

```wgsl
struct TexelUniforms {
  texel_size: vec2f,
  _pad: vec2f,
};

fn uv_left(uv: vec2f, texel: vec2f) -> vec2f { return uv - vec2f(texel.x, 0.0); }
fn uv_right(uv: vec2f, texel: vec2f) -> vec2f { return uv + vec2f(texel.x, 0.0); }
fn uv_top(uv: vec2f, texel: vec2f) -> vec2f { return uv + vec2f(0.0, texel.y); }
fn uv_bottom(uv: vec2f, texel: vec2f) -> vec2f { return uv - vec2f(0.0, texel.y); }
```

## Manual bilinear sample

Use this if filtered sampling fails for a target/device/format combination or if you want identical behavior across formats.

```wgsl
@group(0) @binding(0) var nearest_sampler: sampler;
@group(0) @binding(1) var source_tex: texture_2d<f32>;

fn bilerp(tex: texture_2d<f32>, s: sampler, uv: vec2f, texel_size: vec2f) -> vec4f {
  let st = uv / texel_size - vec2f(0.5);
  let iuv = floor(st);
  let fuv = fract(st);

  let a_uv = (iuv + vec2f(0.5, 0.5)) * texel_size;
  let b_uv = (iuv + vec2f(1.5, 0.5)) * texel_size;
  let c_uv = (iuv + vec2f(0.5, 1.5)) * texel_size;
  let d_uv = (iuv + vec2f(1.5, 1.5)) * texel_size;

  let a = textureSampleLevel(tex, s, a_uv, 0.0);
  let b = textureSampleLevel(tex, s, b_uv, 0.0);
  let c = textureSampleLevel(tex, s, c_uv, 0.0);
  let d = textureSampleLevel(tex, s, d_uv, 0.0);

  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
```

## Additive splat fragment

This is the brightness-critical pass.

```wgsl
struct SplatUniforms {
  point: vec2f,
  radius: f32,
  aspect_ratio: f32,
  color: vec4f,
};

@group(0) @binding(0) var linear_sampler: sampler;
@group(0) @binding(1) var target_tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> splat: SplatUniforms;

@fragment
fn fs_splat(@location(0) uv: vec2f) -> @location(0) vec4f {
  var p = uv - splat.point;
  p.x *= splat.aspect_ratio;

  let g = exp(-dot(p, p) / max(splat.radius, 0.00001));
  let injected = g * splat.color.rgb;
  let base = textureSampleLevel(target_tex, linear_sampler, uv, 0.0).rgb;

  return vec4f(base + injected, 1.0);
}
```

Do not clamp the return value.

## Advection fragment

```wgsl
struct AdvectionUniforms {
  velocity_texel_size: vec2f,
  source_texel_size: vec2f,
  dt: f32,
  dissipation: f32,
};

@group(0) @binding(0) var advect_sampler: sampler;
@group(0) @binding(1) var velocity_tex: texture_2d<f32>;
@group(0) @binding(2) var source_tex_advect: texture_2d<f32>;
@group(0) @binding(3) var<uniform> adv: AdvectionUniforms;

@fragment
fn fs_advect(@location(0) uv: vec2f) -> @location(0) vec4f {
  let velocity = textureSampleLevel(velocity_tex, advect_sampler, uv, 0.0).xy;
  let coord = uv - adv.dt * velocity * adv.velocity_texel_size;
  let result = textureSampleLevel(source_tex_advect, advect_sampler, coord, 0.0);
  let decay = 1.0 + adv.dissipation * adv.dt;
  return result / decay;
}
```

Notes:

- For dye advection, `source_tex_advect` is dye.
- For velocity advection, `source_tex_advect` is velocity.
- Do not clamp dye output.

## Curl fragment

```wgsl
@group(0) @binding(0) var nearest_sampler_curl: sampler;
@group(0) @binding(1) var velocity_for_curl: texture_2d<f32>;
@group(0) @binding(2) var<uniform> texel: TexelUniforms;

@fragment
fn fs_curl(@location(0) uv: vec2f) -> @location(0) vec4f {
  let L = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_left(uv, texel.texel_size), 0.0).y;
  let R = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_right(uv, texel.texel_size), 0.0).y;
  let T = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_top(uv, texel.texel_size), 0.0).x;
  let B = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_bottom(uv, texel.texel_size), 0.0).x;
  let vorticity = R - L - T + B;
  return vec4f(0.5 * vorticity, 0.0, 0.0, 1.0);
}
```

## Vorticity confinement fragment

```wgsl
struct VorticityUniforms {
  texel_size: vec2f,
  curl_strength: f32,
  dt: f32,
};

@group(0) @binding(0) var nearest_sampler_vort: sampler;
@group(0) @binding(1) var velocity_vort: texture_2d<f32>;
@group(0) @binding(2) var curl_tex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> vort: VorticityUniforms;

@fragment
fn fs_vorticity(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ts = vort.texel_size;
  let L = textureSampleLevel(curl_tex, nearest_sampler_vort, uv_left(uv, ts), 0.0).x;
  let R = textureSampleLevel(curl_tex, nearest_sampler_vort, uv_right(uv, ts), 0.0).x;
  let T = textureSampleLevel(curl_tex, nearest_sampler_vort, uv_top(uv, ts), 0.0).x;
  let B = textureSampleLevel(curl_tex, nearest_sampler_vort, uv_bottom(uv, ts), 0.0).x;
  let C = textureSampleLevel(curl_tex, nearest_sampler_vort, uv, 0.0).x;

  var force = 0.5 * vec2f(abs(T) - abs(B), abs(R) - abs(L));
  force = force / (length(force) + 0.0001);
  force *= vort.curl_strength * C;
  force.y *= -1.0;

  var velocity = textureSampleLevel(velocity_vort, nearest_sampler_vort, uv, 0.0).xy;
  velocity += force * vort.dt;
  velocity = clamp(velocity, vec2f(-1000.0), vec2f(1000.0));

  return vec4f(velocity, 0.0, 1.0);
}
```

## Divergence fragment

```wgsl
@fragment
fn fs_divergence(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ts = texel.texel_size;
  let C = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv, 0.0).xy;

  var L = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_left(uv, ts), 0.0).x;
  var R = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_right(uv, ts), 0.0).x;
  var T = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_top(uv, ts), 0.0).y;
  var B = textureSampleLevel(velocity_for_curl, nearest_sampler_curl, uv_bottom(uv, ts), 0.0).y;

  if (uv.x - ts.x < 0.0) { L = -C.x; }
  if (uv.x + ts.x > 1.0) { R = -C.x; }
  if (uv.y + ts.y > 1.0) { T = -C.y; }
  if (uv.y - ts.y < 0.0) { B = -C.y; }

  let div = 0.5 * (R - L + T - B);
  return vec4f(div, 0.0, 0.0, 1.0);
}
```

## Pressure Jacobi fragment

```wgsl
@group(0) @binding(0) var nearest_sampler_pressure: sampler;
@group(0) @binding(1) var pressure_tex: texture_2d<f32>;
@group(0) @binding(2) var divergence_tex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> pressure_texel: TexelUniforms;

@fragment
fn fs_pressure(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ts = pressure_texel.texel_size;
  let L = textureSampleLevel(pressure_tex, nearest_sampler_pressure, uv_left(uv, ts), 0.0).x;
  let R = textureSampleLevel(pressure_tex, nearest_sampler_pressure, uv_right(uv, ts), 0.0).x;
  let T = textureSampleLevel(pressure_tex, nearest_sampler_pressure, uv_top(uv, ts), 0.0).x;
  let B = textureSampleLevel(pressure_tex, nearest_sampler_pressure, uv_bottom(uv, ts), 0.0).x;
  let divergence = textureSampleLevel(divergence_tex, nearest_sampler_pressure, uv, 0.0).x;
  let pressure = (L + R + B + T - divergence) * 0.25;
  return vec4f(pressure, 0.0, 0.0, 1.0);
}
```

## Gradient subtract fragment

```wgsl
@group(0) @binding(0) var nearest_sampler_grad: sampler;
@group(0) @binding(1) var pressure_grad: texture_2d<f32>;
@group(0) @binding(2) var velocity_grad: texture_2d<f32>;
@group(0) @binding(3) var<uniform> grad_texel: TexelUniforms;

@fragment
fn fs_gradient_subtract(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ts = grad_texel.texel_size;
  let L = textureSampleLevel(pressure_grad, nearest_sampler_grad, uv_left(uv, ts), 0.0).x;
  let R = textureSampleLevel(pressure_grad, nearest_sampler_grad, uv_right(uv, ts), 0.0).x;
  let T = textureSampleLevel(pressure_grad, nearest_sampler_grad, uv_top(uv, ts), 0.0).x;
  let B = textureSampleLevel(pressure_grad, nearest_sampler_grad, uv_bottom(uv, ts), 0.0).x;

  var velocity = textureSampleLevel(velocity_grad, nearest_sampler_grad, uv, 0.0).xy;
  velocity -= vec2f(R - L, T - B);
  return vec4f(velocity, 0.0, 1.0);
}
```

## Bloom prefilter fragment

```wgsl
struct BloomPrefilterUniforms {
  curve: vec4f,       // x = threshold - knee, y = 2*knee, z = 0.25/knee, w unused
  threshold: f32,
  _pad0: vec3f,
};

@group(0) @binding(0) var linear_sampler_bloom: sampler;
@group(0) @binding(1) var hdr_dye_tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> bloom_pref: BloomPrefilterUniforms;

@fragment
fn fs_bloom_prefilter(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(hdr_dye_tex, linear_sampler_bloom, uv, 0.0).rgb;
  let br = max(c.r, max(c.g, c.b));

  var rq = clamp(br - bloom_pref.curve.x, 0.0, bloom_pref.curve.y);
  rq = bloom_pref.curve.z * rq * rq;

  let contribution = max(rq, br - bloom_pref.threshold) / max(br, 0.0001);
  return vec4f(c * contribution, 0.0);
}
```

CPU-side curve setup:

```ts
function bloomCurve(threshold: number, softKnee: number) {
  const knee = threshold * softKnee + 0.0001;
  return {
    curve: [threshold - knee, knee * 2, 0.25 / knee, 0],
    threshold,
  };
}
```

## Four-tap bloom blur/downsample

```wgsl
@group(0) @binding(0) var linear_sampler_blur: sampler;
@group(0) @binding(1) var bloom_source: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blur_texel: TexelUniforms;

@fragment
fn fs_bloom_blur4(@location(0) uv: vec2f) -> @location(0) vec4f {
  let ts = blur_texel.texel_size;
  var sum = vec4f(0.0);
  sum += textureSampleLevel(bloom_source, linear_sampler_blur, uv_left(uv, ts), 0.0);
  sum += textureSampleLevel(bloom_source, linear_sampler_blur, uv_right(uv, ts), 0.0);
  sum += textureSampleLevel(bloom_source, linear_sampler_blur, uv_top(uv, ts), 0.0);
  sum += textureSampleLevel(bloom_source, linear_sampler_blur, uv_bottom(uv, ts), 0.0);
  return sum * 0.25;
}
```

## Separable blur alternative

For cleaner bloom, use horizontal and vertical passes:

```wgsl
@fragment
fn fs_blur_axis(@location(0) uv: vec2f) -> @location(0) vec4f {
  let axis = blur_axis_uniform.axis_texel; // vec2f(texel.x, 0) or vec2f(0, texel.y)
  var sum = textureSampleLevel(bloom_source, linear_sampler_blur, uv, 0.0) * 0.29411764;
  sum += textureSampleLevel(bloom_source, linear_sampler_blur, uv - axis * 1.3333333, 0.0) * 0.35294117;
  sum += textureSampleLevel(bloom_source, linear_sampler_blur, uv + axis * 1.3333333, 0.0) * 0.35294117;
  return sum;
}
```

## Display shader: base + gamma-lifted bloom

```wgsl
struct DisplayUniforms {
  texel_size: vec2f,
  dither_scale: vec2f,
  exposure: f32,
  bloom_strength: f32,
  shading_strength: f32,
  _pad0: f32,
};

@group(0) @binding(0) var display_sampler: sampler;
@group(0) @binding(1) var dye_tex: texture_2d<f32>;
@group(0) @binding(2) var bloom_tex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> display: DisplayUniforms;

fn linear_to_srgb_approx(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return max(1.055 * pow(x, vec3f(1.0 / 2.4)) - vec3f(0.055), vec3f(0.0));
}

fn reinhard(c: vec3f) -> vec3f {
  return c / (vec3f(1.0) + c);
}

fn aces_filmic(c: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c2 = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((c * (a * c + b)) / (c * (c2 * c + d) + e), vec3f(0.0), vec3f(1.0));
}

fn fake_shading(uv: vec2f, base: vec3f) -> vec3f {
  let ts = display.texel_size;
  let lc = textureSampleLevel(dye_tex, display_sampler, uv_left(uv, ts), 0.0).rgb;
  let rc = textureSampleLevel(dye_tex, display_sampler, uv_right(uv, ts), 0.0).rgb;
  let tc = textureSampleLevel(dye_tex, display_sampler, uv_top(uv, ts), 0.0).rgb;
  let bc = textureSampleLevel(dye_tex, display_sampler, uv_bottom(uv, ts), 0.0).rgb;

  let dx = length(rc) - length(lc);
  let dy = length(tc) - length(bc);
  let n = normalize(vec3f(dx, dy, length(ts)));
  let l = vec3f(0.0, 0.0, 1.0);
  let diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
  return mix(base, base * diffuse, display.shading_strength);
}

@fragment
fn fs_display(@location(0) uv: vec2f) -> @location(0) vec4f {
  var base = textureSampleLevel(dye_tex, display_sampler, uv, 0.0).rgb;
  base = fake_shading(uv, base);

  var bloom = textureSampleLevel(bloom_tex, display_sampler, uv, 0.0).rgb * display.bloom_strength;

  // Key Pavel-like lift: gamma-map bloom before adding it.
  bloom = linear_to_srgb_approx(bloom);

  var color = base + bloom;

  // SDR path. Choose one tone mapper. ACES usually looks more cinematic.
  color *= display.exposure;
  color = aces_filmic(color);

  return vec4f(linear_to_srgb_approx(color), 1.0);
}
```

Important: the upstream-style display adds bloom after gamma-lifting bloom. If your WebGPU version adds bloom purely linearly and then uses a conservative tone map, it will look less hot.

## Debug shaders

### Show unclamped dye energy

```wgsl
@fragment
fn fs_debug_dye_energy(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(dye_tex, display_sampler, uv, 0.0).rgb;
  let energy = max(c.r, max(c.g, c.b));
  return vec4f(vec3f(energy / 8.0), 1.0);
}
```

Expected: white regions mean dye is around `8.0`, not `1.0`.

### Show bloom mask

```wgsl
@fragment
fn fs_debug_bloom_mask(@location(0) uv: vec2f) -> @location(0) vec4f {
  let b = textureSampleLevel(bloom_tex, display_sampler, uv, 0.0).rgb;
  return vec4f(b, 1.0);
}
```

Expected: mask is visibly non-black immediately after bright splats.

### Show over-1.0 regions

```wgsl
@fragment
fn fs_debug_overbright(@location(0) uv: vec2f) -> @location(0) vec4f {
  let c = textureSampleLevel(dye_tex, display_sampler, uv, 0.0).rgb;
  let over = step(vec3f(1.0), c);
  return vec4f(over, 1.0);
}
```

Expected: after active splatting, many pixels should be over `1.0` in at least one channel.
