
struct Accum {
  decay: f32,
  time: f32,
  aspect: f32,
  motion: f32,
  viewport: vec2f,
  padding: vec2f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var accumSampler: sampler;
@group(0) @binding(1) var historyTexture: texture_2d<f32>;
@group(0) @binding(2) var sceneTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> accum: Accum;

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

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let prev = textureSample(historyTexture, accumSampler, input.uv).rgb;
  let scene = textureSample(sceneTexture, accumSampler, input.uv).rgb;
  let decayed = prev * accum.decay;
  let combined = decayed + scene;
  let saturated = combined / (1.0 + combined * 0.045);
  return vec4f(saturated, 1.0);
}

