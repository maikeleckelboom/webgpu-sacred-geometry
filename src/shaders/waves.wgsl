
struct Scene {
  viewport: vec4f,
  params: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) side: f32,
  @location(1) along: f32,
  @location(2) alpha: f32,
  @location(3) tone: f32,
  @location(4) softness: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

fn corner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );

  return corners[index];
}

fn uvToClip(uv: vec2f) -> vec2f {
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) startEnd: vec4f,
  @location(1) style: vec4f,
) -> VertexOut {
  let c = corner(vertexIndex);
  let start = uvToClip(startEnd.xy);
  let end = uvToClip(startEnd.zw);
  let deltaPixels = (end - start) * scene.viewport.xy * 0.5;
  let directionPixels = normalize(deltaPixels + vec2f(0.0001, 0.0002));
  let normalPixels = vec2f(-directionPixels.y, directionPixels.x);
  let halfWidthPixels = max(0.35, style.x * scene.viewport.z * 0.5);
  let normalNdc = normalPixels * halfWidthPixels * 2.0 / scene.viewport.xy;
  let position = mix(start, end, c.x) + normalNdc * c.y;

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.side = c.y;
  out.along = c.x;
  out.alpha = style.y;
  out.tone = style.z;
  out.softness = style.w;
  return out;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let sideDistance = abs(input.side);
  let crispEdge = smoothstep(1.0, 0.62, sideDistance);
  let softEdge = pow(clamp(1.0 - sideDistance, 0.0, 1.0), 1.5);
  let sideAlpha = mix(crispEdge, softEdge, input.softness);
  let graphite = mix(0.72, 0.075, clamp(input.tone, 0.0, 1.0));
  let alpha = input.alpha * sideAlpha;

  return vec4f(vec3f(graphite), alpha);
}

