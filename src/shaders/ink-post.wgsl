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

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(q) * 43758.5453);
}

fn snoise2(p: vec2f) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(p + (p.x + p.y) * K1);
  let a = p - i + (i.x + i.y) * K2;
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

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let uv = input.uv;
  let ndc = uv * 2.0 - vec2f(1.0);

  // --- Paper base ---
  let grad = smoothstep(-1.1, 1.2, ndc.y * 0.55 + ndc.x * 0.2);
  var color = mix(vec3f(0.956), vec3f(0.936), grad);
  let mottle = snoise2(uv * vec2f(2.3, 1.7) + vec2f(render.time * 0.006, -render.time * 0.004));
  color += vec3f(0.006) * mottle;

  // --- Ink strokes: multiplicative absorption on the paper ---
  // v flipped for the same row-consistency reason as the accumulation pass.
  let rawInk = textureSample(historyTexture, postSampler, vec2f(uv.x, 1.0 - uv.y)).rgb * render.inkStrength;
  // Soft-cap the absorption so the densest feathers stay deep graphite rather
  // than crushing to black.
  let ink = vec3f(2.2) * (vec3f(1.0) - exp(-rawInk / vec3f(1.4)));
  let absorption = exp(-ink);
  color *= absorption;

  // --- Vignette + grain ---
  let edge = length((uv - vec2f(0.5)) * vec2f(render.aspect, 1.0));
  color *= 1.0 - smoothstep(0.62, 1.25, edge) * 0.055;
  let grain = (hash21(uv * render.viewport + vec2f(render.time * 13.0, 0.0)) - 0.5) * 0.014;
  color += vec3f(grain);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
