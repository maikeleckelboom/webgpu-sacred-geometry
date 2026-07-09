
struct Scene {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirection: vec4f,
  viewport: vec4f,
  params: vec4f,
  pointer: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> scene: Scene;

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

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

fn sampleScene(uv: vec2f, offset: vec2f) -> vec4f {
  return textureSample(sceneTexture, postSampler, uv + offset);
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let texel = 1.0 / max(scene.viewport.xy, vec2f(1.0, 1.0));
  let center = sampleScene(input.uv, vec2f(0.0));
  let opticalFalloff = smoothstep(0.2, 0.9, length((input.uv - vec2f(0.64, 0.48)) * vec2f(1.16, 1.0)));
  let foregroundFalloff = smoothstep(0.7, 0.98, input.uv.y) * 0.28;
  let blur = clamp(center.a * 0.54 + opticalFalloff * 0.22 + foregroundFalloff, 0.0, 1.0);
  let radius = texel * (0.24 + blur * 6.5);

  var color = center.rgb * 0.52;
  color = color + sampleScene(input.uv, radius * vec2f(1.0, 0.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(-1.0, 0.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(0.0, 1.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(0.0, -1.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(0.72, 0.72)).rgb * 0.05;
  color = color + sampleScene(input.uv, radius * vec2f(-0.72, 0.72)).rgb * 0.05;
  color = color + sampleScene(input.uv, radius * vec2f(0.72, -0.72)).rgb * 0.05;
  color = color + sampleScene(input.uv, radius * vec2f(-0.72, -0.72)).rgb * 0.05;

  let bloomRadius = radius * 3.2;
  let bloom =
    sampleScene(input.uv, bloomRadius * vec2f(1.0, 0.18)).rgb +
    sampleScene(input.uv, bloomRadius * vec2f(-1.0, -0.18)).rgb +
    sampleScene(input.uv, bloomRadius * vec2f(0.18, 1.0)).rgb +
    sampleScene(input.uv, bloomRadius * vec2f(-0.18, -1.0)).rgb;
  let bloomAmount = smoothstep(0.54, 1.05, max(max(bloom.r, bloom.g), bloom.b) * 0.25);
  color = color + bloom * bloomAmount * 0.035;

  let leftPaper = smoothstep(0.48, 0.02, input.uv.x) * smoothstep(1.02, 0.18, input.uv.y);
  color = mix(color, vec3f(0.93, 0.93, 0.9), leftPaper * 0.2);
  let vignette = smoothstep(1.0, 0.24, length((input.uv - vec2f(0.57, 0.5)) * vec2f(1.02, 0.86)));
  color = color * mix(0.9, 1.06, vignette);

  let grain = hash21(input.uv * scene.viewport.xy + scene.params.x * 11.0);
  color = color + vec3f((grain - 0.5) * 0.012);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}

