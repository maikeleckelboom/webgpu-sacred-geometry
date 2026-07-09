
struct Scene {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  viewport: vec4f,
  params: vec4f,
  pointer: vec4f,
}

struct LineOut {
  @builtin(position) position: vec4f,
  @location(0) side: f32,
  @location(1) along: f32,
  @location(2) alpha: f32,
  @location(3) tone: f32,
  @location(4) phase: f32,
  @location(5) focus: f32,
}

struct NodeOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) alpha: f32,
  @location(2) tone: f32,
  @location(3) phase: f32,
  @location(4) kind: f32,
}

struct PlaneOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) tone: f32,
  @location(2) facing: f32,
  @location(3) phase: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

fn project(point: vec3f, phase: f32, layer: f32) -> vec4f {
  let time = scene.params.x;
  let motion = scene.params.y;
  let compositionOffset = vec3f(0.58, -0.13, 0.0);
  let drift = vec3f(
    sin(time * 0.17 + phase) * 0.018,
    cos(time * 0.13 + phase * 1.7) * 0.012,
    sin(time * 0.11 + phase * 0.7) * 0.018
  ) * motion * layer;
  return scene.viewProjection * vec4f(point + compositionOffset + drift, 1.0);
}

fn lineCorner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return corners[index];
}

fn spriteCorner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return corners[index];
}

fn depthFocus(world: vec3f, focus: f32) -> f32 {
  let distanceToCamera = distance(scene.cameraPosition.xyz, world);
  let focalDistance = scene.params.z + focus * 0.35;
  return 1.0 - smoothstep(0.24, 2.1, abs(distanceToCamera - focalDistance));
}

fn tonalColor(tone: f32, activation: f32, kind: f32) -> vec3f {
  let paper = vec3f(0.62, 0.63, 0.61);
  let graphite = vec3f(0.045, 0.048, 0.052);
  let accent = vec3f(0.22, 0.42, 0.5);
  let base = mix(graphite, paper, clamp(tone, 0.0, 1.0));
  return mix(base, accent, clamp(activation * 0.32 + kind * 0.12, 0.0, 0.38));
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) startAndWidth: vec4f,
  @location(1) endAndAlpha: vec4f,
  @location(2) lineInfo: vec4f
) -> LineOut {
  let corner = lineCorner(vertexIndex);
  let start = startAndWidth.xyz;
  let end = endAndAlpha.xyz;
  let phase = lineInfo.y;
  let focus = lineInfo.z;
  let layer = lineInfo.w;
  let clipA = project(start, phase, layer);
  let clipB = project(end, phase + 0.53, layer);
  let ndcA = clipA.xy / clipA.w;
  let ndcB = clipB.xy / clipB.w;
  let deltaPixels = (ndcB - ndcA) * scene.viewport.xy * 0.5;
  let normalPixels = normalize(vec2f(-deltaPixels.y, deltaPixels.x) + vec2f(0.0001, 0.0002));
  let normalNdc = normalPixels * 2.0 / scene.viewport.xy;
  let widthPixels = startAndWidth.w * scene.viewport.z * (0.78 + focus * 0.34);
  let t = corner.x;
  let ndc = mix(ndcA, ndcB, t) + normalNdc * corner.y * widthPixels;
  let w = mix(clipA.w, clipB.w, t);
  let z = mix(clipA.z / clipA.w, clipB.z / clipB.w, t) * w;
  let world = mix(start, end, t);
  let nearFocus = depthFocus(world, focus);
  let distanceFade = 1.0 - smoothstep(4.0, 6.7, distance(scene.cameraPosition.xyz, world));

  var out: LineOut;
  out.position = vec4f(ndc * w, z, w);
  out.side = corner.y;
  out.along = t;
  out.alpha = endAndAlpha.w * (0.68 + nearFocus * 0.72) * distanceFade;
  out.tone = lineInfo.x;
  out.phase = phase;
  out.focus = focus;
  return out;
}

@fragment
fn lineFragment(input: LineOut) -> @location(0) vec4f {
  let sideFade = pow(clamp(1.0 - abs(input.side), 0.0, 1.0), 1.45);
  let endFade = smoothstep(0.0, 0.06, input.along) * (1.0 - smoothstep(0.94, 1.0, input.along) * 0.18);
  let pulse = 0.88 + sin(scene.params.x * 0.45 + input.phase) * 0.08 * scene.params.y;
  let activation = smoothstep(0.72, 1.0, input.focus) * pulse;
  let color = tonalColor(input.tone, activation, 0.0);
  let alpha = input.alpha * sideFade * endFade * pulse * 1.35;
  return vec4f(color, alpha);
}

@vertex
fn nodeVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) positionAndRadius: vec4f,
  @location(1) nodeInfo: vec4f
) -> NodeOut {
  let corner = spriteCorner(vertexIndex);
  let phase = nodeInfo.z;
  let kind = nodeInfo.w;
  let clip = project(positionAndRadius.xyz, phase, 0.55 + kind * 0.4);
  let ndc = clip.xy / clip.w;
  let focus = depthFocus(positionAndRadius.xyz, kind * 0.35);
  let pointerLocal = (1.0 - smoothstep(0.16, 0.9, distance(ndc, scene.pointer.xy))) * scene.pointer.z;
  let radiusPixels = positionAndRadius.w * scene.viewport.z * (0.72 + focus * 0.44 + pointerLocal * 0.06 + kind * 0.14);
  let spriteNdc = ndc + corner * radiusPixels * 2.0 / scene.viewport.xy;

  var out: NodeOut;
  out.position = vec4f(spriteNdc * clip.w, clip.z, clip.w);
  out.local = corner;
  out.alpha = nodeInfo.x * (0.74 + focus * 0.58 + pointerLocal * 0.08);
  out.tone = nodeInfo.y;
  out.phase = phase;
  out.kind = kind;
  return out;
}

@fragment
fn nodeFragment(input: NodeOut) -> @location(0) vec4f {
  let d = length(input.local);
  let disc = smoothstep(1.0, 0.78, d);
  let core = smoothstep(0.38, 0.0, d);
  let halo = pow(clamp(1.0 - d, 0.0, 1.0), 2.4);
  let pulse = 0.9 + sin(scene.params.x * 0.72 + input.phase) * 0.06 * scene.params.y;
  let color = tonalColor(input.tone, core * pulse, input.kind) + vec3f(core * 0.12);
  let alpha = input.alpha * pulse * (disc * 0.88 + core * 0.72 + halo * 0.28);
  return vec4f(color, alpha);
}

@vertex
fn planeVertex(
  @location(0) position: vec3f,
  @location(1) alpha: f32,
  @location(2) normal: vec3f,
  @location(3) planeInfo: vec3f
) -> PlaneOut {
  let clip = project(position, planeInfo.y, 0.28);
  let view = normalize(scene.cameraPosition.xyz - position);

  var out: PlaneOut;
  out.position = clip;
  out.alpha = alpha * (0.86 + depthFocus(position, planeInfo.z) * 0.5);
  out.tone = planeInfo.x;
  out.facing = abs(dot(normalize(normal), view));
  out.phase = planeInfo.y;
  return out;
}

@fragment
fn planeFragment(input: PlaneOut) -> @location(0) vec4f {
  let scan = 0.86 + sin(scene.params.x * 0.18 + input.phase) * 0.06 * scene.params.y;
  let edge = 0.42 + input.facing * 0.58;
  let color = mix(vec3f(0.08, 0.09, 0.095), vec3f(0.82, 0.84, 0.82), input.tone) * edge;
  return vec4f(color, input.alpha * scan);
}

