
const BLOOM_UPSAMPLE_WEIGHT = 0.6200;

struct BloomPref {
  curve: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn bloomVertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
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

@group(0) @binding(0) var bloomSampler: sampler;
@group(0) @binding(1) var bloomSource: texture_2d<f32>;
@group(0) @binding(2) var bloomHigh: texture_2d<f32>;
@group(0) @binding(3) var<uniform> prefilterUniform: BloomPref;

@fragment
fn bloomPrefilter(input: VertexOut) -> @location(0) vec4f {
  let c = textureSample(bloomSource, bloomSampler, input.uv).rgb;
  let br = max(c.r, max(c.g, c.b));
  var rq = clamp(br - prefilterUniform.curve.x, 0.0, prefilterUniform.curve.y);
  rq = prefilterUniform.curve.z * rq * rq;
  let contribution = max(rq, br - prefilterUniform.curve.w) / max(br, 0.0001);
  return vec4f(c * contribution, 1.0);
}

@fragment
fn bloomDownsample(input: VertexOut) -> @location(0) vec4f {
  let dims = textureDimensions(bloomSource, 0);
  let tx = 1.0 / vec2f(f32(dims.x), f32(dims.y));
  let uv = input.uv;
  let c = textureSample(bloomSource, bloomSampler, uv);
  let l = textureSample(bloomSource, bloomSampler, uv + vec2f(-tx.x, 0.0));
  let r = textureSample(bloomSource, bloomSampler, uv + vec2f(tx.x, 0.0));
  let t = textureSample(bloomSource, bloomSampler, uv + vec2f(0.0, tx.y));
  let b = textureSample(bloomSource, bloomSampler, uv + vec2f(0.0, -tx.y));
  return (c + l + r + t + b) * 0.2;
}

@fragment
fn bloomUpsample(input: VertexOut) -> @location(0) vec4f {
  let lo = textureSample(bloomSource, bloomSampler, input.uv);
  let hi = textureSample(bloomHigh, bloomSampler, input.uv);
  return lo + hi * BLOOM_UPSAMPLE_WEIGHT;
}

