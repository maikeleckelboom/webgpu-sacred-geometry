
const RING_RADIUS = 0.46;
const RING_CENTER_X = 0.60;
const RING_CENTER_Y = 0.05;

struct Render {
  time: f32,
  aspect: f32,
  opacity: f32,
  pixelRatio: f32,
  viewport: vec2f,
  pointer: vec2f,
  pointerStrength: f32,
  pressure: f32,
  inkStrength: f32,
  padding: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var historyTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> render: Render;

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let position = positions[vertexIndex];

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.uv = position * 0.5 + vec2f(0.5, 0.5);
  return out;
}

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn hash22(point: vec2f) -> vec2f {
  let q = vec2f(dot(point, vec2f(127.1, 311.7)), dot(point, vec2f(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(q) * 43758.5453);
}

fn snoise2(point: vec2f) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(point + (point.x + point.y) * K1);
  let a = point - i + (i.x + i.y) * K2;
  let o = step(a.yx, a.xy);
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3f(dot(a, a), dot(b, b), dot(c, c)), vec3f(0.0));
  let n = h * h * h * h * vec3f(
    dot(a, hash22(i)),
    dot(b, hash22(i + o)),
    dot(c, hash22(i + vec2f(1.0))),
  );
  return dot(n, vec3f(70.0, 70.0, 70.0));
}

// One layer of scattered ink specks in aspect-corrected space.
// Returns (shape, cellRand, accentRand).
fn speckLayer(p: vec2f, scale: f32, threshold: f32) -> vec3f {
  let grid = p * scale;
  let cell = floor(grid);
  let local = fract(grid) - vec2f(0.5);
  let rand = hash21(cell);
  let present = step(threshold, rand);
  let offset = hash22(cell + vec2f(7.7, 3.1)) * 0.32;
  let size = 0.035 + hash21(cell + vec2f(3.3, 9.4)) * 0.05;
  let d = length(local - offset);
  let shape = (1.0 - smoothstep(size * 0.45, size, d)) * present;
  return vec3f(shape, rand, hash21(cell + vec2f(11.1, 1.7)));
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let uv = input.uv;
  let ndc = uv * 2.0 - vec2f(1.0);
  let q = vec2f(ndc.x * render.aspect, ndc.y);
  let c = vec2f(render.aspect * RING_CENTER_X, RING_CENTER_Y);
  let toRing = q - c;
  let r = length(toRing);

  // --- Paper base ---
  let grad = smoothstep(-1.1, 1.2, ndc.y * 0.55 + ndc.x * 0.2);
  var color = mix(vec3f(0.952, 0.956, 0.964), vec3f(0.932, 0.940, 0.951), grad);
  let mottle = snoise2(uv * vec2f(2.3, 1.7) + vec2f(render.time * 0.006, -render.time * 0.004));
  color += vec3f(0.006) * mottle;

  // --- Ink strokes: multiplicative absorption on the paper ---
  // v flipped for the same row-consistency reason as the accumulation pass.
  let rawInk = textureSample(historyTexture, postSampler, vec2f(uv.x, 1.0 - uv.y)).rgb * render.inkStrength;
  // Soft-cap the absorption so the densest feathers stay deep navy rather
  // than crushing to black.
  let ink = vec3f(2.2) * (vec3f(1.0) - exp(-rawInk / vec3f(1.4)));
  let absorption = exp(-ink);

  // --- Scattered specks (mostly navy, occasional saturated blue) ---
  let interior = 1.0 - smoothstep(RING_RADIUS * 0.35, RING_RADIUS * 0.95, r);
  let tx = smoothstep(-1.02, -0.86, ndc.x) * (1.0 - smoothstep(-0.12, 0.1, ndc.x));
  let ty = smoothstep(-0.66, -0.44, ndc.y) * (1.0 - smoothstep(0.42, 0.66, ndc.y));
  let speckMask = (1.0 - interior * 0.7) * (1.0 - tx * ty * 0.6);

  let coarse = speckLayer(q + vec2f(render.time * 0.0015, 0.0), 6.5, 0.962);
  let fine = speckLayer(q * 1.13 + vec2f(4.2, -1.3) - vec2f(render.time * 0.001, 0.0), 15.0, 0.94);
  let navySpeck = vec3f(0.18, 0.22, 0.34);
  let blueSpeck = vec3f(0.22, 0.44, 0.80);
  let coarseColor = mix(navySpeck, blueSpeck, step(0.86, coarse.z));
  color = mix(color, coarseColor, coarse.x * 0.8 * speckMask);
  color = mix(color, navySpeck, fine.x * 0.32 * speckMask);

  // --- Glowing aurora ring ---
  // The soft glow sits under the ink (strokes stay crisp over it); a small
  // additive core keeps the ring luminous even where feathers cross it.
  let d = r - RING_RADIUS;
  let ang = atan2(toRing.y, toRing.x);
  let arcPhase = 0.7 + 0.4 * sin(render.time * 0.12);
  let arc = 0.45 + 0.55 * pow(max(0.0, cos(ang - arcPhase)), 2.0);
  let arc2 = 0.8 + 0.2 * sin(ang * 3.0 + render.time * 0.35);
  let core = exp(-d * d / 0.00025);
  let mid = exp(-d * d / 0.007);
  let halo = exp(-d * d / 0.085);
  var glow = core * (1.1 * arc + 0.3) + mid * 0.3 * arc * arc2 + halo * 0.09;
  glow *= (0.9 + 0.1 * sin(render.time * 0.7)) * (1.0 + render.pressure * 0.4);
  let glowColor = mix(vec3f(0.42, 0.83, 0.90), vec3f(0.93, 1.0, 1.0), clamp(core * 1.2, 0.0, 1.0));
  let glowAmount = clamp(glow, 0.0, 1.0);
  color = vec3f(1.0) - (vec3f(1.0) - color) * (vec3f(1.0) - glowColor * glowAmount);
  color *= absorption;
  color += glowColor * (core * clamp(arc, 0.0, 1.0) * 0.85 + mid * 0.10 * arc);

  // --- Vignette + grain ---
  let edge = length((uv - vec2f(0.5)) * vec2f(render.aspect, 1.0));
  color *= 1.0 - smoothstep(0.62, 1.25, edge) * 0.055;
  let grain = (hash21(uv * render.viewport + vec2f(render.time * 13.0, 0.0)) - 0.5) * 0.014;
  color += vec3f(grain);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
