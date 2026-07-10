
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
  // Sample with v flipped so each pass reads the texel at its own screen
  // row; sampling at raw uv mirrors the image vertically every frame and
  // accumulates into a kaleidoscope artifact.
  let sampleUv = vec2f(input.uv.x, 1.0 - input.uv.y);
  let prev = textureSample(historyTexture, accumSampler, sampleUv).rgb;
  let scene = textureSample(sceneTexture, accumSampler, sampleUv).rgb;
  let decayed = prev * accum.decay;
  let combined = decayed + scene;
  // Soft-saturate so dense feathers stay layered ink instead of solid black.
  let saturated = combined / (1.0 + combined * 0.12);
  return vec4f(saturated, 1.0);
}
