struct Scene {
  viewport: vec4f,
  pointer: vec4f,
  grab: vec4f,
  params: vec4f,
}

struct DeformedPoint {
  point: vec3f,
  impact: f32,
}

struct ProjectedPoint {
  clip: vec2f,
  depth: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) side: f32,
  @location(1) alpha: f32,
  @location(2) tone: f32,
  @location(3) softness: f32,
  @location(4) depth: f32,
  @location(5) impact: f32,
}

struct SurfaceVertexOut {
  @builtin(position) position: vec4f,
  @location(0) light: f32,
  @location(1) impact: f32,
  @location(2) foldSide: f32,
  @location(3) depth: f32,
  @location(4) edgeFade: f32,
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

fn clipToUv(clip: vec2f) -> vec2f {
  return vec2f(clip.x * 0.5 + 0.5, 0.5 - clip.y * 0.5);
}

fn square(value: f32) -> f32 {
  return value * value;
}

fn rotateY(point: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(
    point.x * c + point.z * s,
    point.y,
    -point.x * s + point.z * c,
  );
}

fn rotateX(point: vec3f, angle: f32) -> vec3f {
  let c = cos(angle);
  let s = sin(angle);
  return vec3f(
    point.x,
    point.y * c - point.z * s,
    point.y * s + point.z * c,
  );
}

fn projectPoint(world: vec3f) -> ProjectedPoint {
  let time = scene.params.x;
  let motionScale = scene.pointer.w;
  let yaw = sin(time * 0.18) * 0.075 +
    (scene.pointer.x - 0.5) * scene.pointer.z * motionScale * 0.05;
  let pitch = -0.28 + sin(time * 0.14) * 0.035 +
    (scene.pointer.y - 0.53) * scene.pointer.z * motionScale * 0.04;
  let centered = world - vec3f(0.5, 0.53, 0.0);
  let rotated = rotateX(rotateY(centered, yaw), pitch);
  let perspective = 1.0 / max(0.62, 1.0 - rotated.z * 0.5);
  let uv = vec2f(0.5, 0.53) + rotated.xy * perspective;

  var out: ProjectedPoint;
  out.clip = uvToClip(uv);
  out.depth = clamp(0.5 - rotated.z * 0.28, 0.0, 1.0);
  return out;
}

fn deformPoint(world: vec3f, phase: f32) -> DeformedPoint {
  let aspect = max(scene.viewport.w, 0.001);
  let motionScale = scene.pointer.w;
  let time = scene.params.x;
  let baseUv = clipToUv(projectPoint(world).clip);

  let flowPhase = world.x * 7.0 + world.y * 2.4 + phase + time * 0.9;
  let crossPhase = world.x * 3.2 - world.y * 5.1 + phase * 0.7 - time * 0.55;
  let ambient = vec3f(
    sin(crossPhase) * (0.002 + abs(world.z) * 0.0015),
    (sin(flowPhase) + sin(flowPhase * 0.47 + phase) * 0.38) *
      (0.009 + abs(world.z) * 0.004),
    (sin(flowPhase * 0.61 - time * 0.7) + cos(crossPhase * 0.8) * 0.45) *
      (0.016 + abs(world.z) * 0.008),
  ) * motionScale;
  let throatWeight = exp(-square((world.x - 0.5) / 0.3));
  let throatBreath = sin(time * 0.72 + phase * 0.25) * throatWeight * motionScale;
  let sheetPulse = vec3f(
    (world.x - 0.5) * throatBreath * 0.018,
    (world.y - 0.53) * throatBreath * 0.04,
    world.z * throatBreath * 0.06,
  );
  let layerDrift = vec3f(
    sin(time * 0.45 + phase) * world.z * 0.003,
    cos(time * 0.38 + phase * 1.3) * world.z * 0.003,
    sin(time * 0.32 + phase * 0.8) * 0.012,
  ) * motionScale;

  let hoverDelta = (baseUv - scene.pointer.xy) * vec2f(aspect, 1.0);
  let hoverDistance = length(hoverDelta);
  let hoverDirection = hoverDelta / max(hoverDistance, 0.0001);
  let hoverRadial = vec2f(hoverDirection.x / aspect, hoverDirection.y);
  let hoverTangent = vec2f(-hoverDirection.y / aspect, hoverDirection.x);
  let hover = exp(-hoverDistance * hoverDistance * 3.4) *
    scene.pointer.z * motionScale;
  let hoverPush = vec3f(
    hoverRadial.x * hover * 0.006,
    hoverRadial.y * hover * 0.012,
    hover * hoverDistance * 0.045,
  );
  let hoverOrbit = vec3f(hoverTangent * hover * world.z * 0.008, 0.0);

  let grabStrength = scene.grab.z * motionScale;
  let foldDelta = baseUv - scene.grab.xy;
  let foldInfluence = exp(
    -square(foldDelta.x / 0.42) - square(foldDelta.y / 0.68)
  ) * grabStrength;
  let foldAngle = foldInfluence * 1.18;
  let smoothDistanceFromCrease = sqrt(foldDelta.y * foldDelta.y + 0.0009) - 0.03;
  let foldedY = world.y - foldDelta.y * (1.0 - cos(foldAngle));
  let foldedZ = world.z +
    smoothDistanceFromCrease * sin(foldAngle) * 0.92;
  let grabCompression = vec3f(
    -foldDelta.x * foldInfluence * 0.02,
    foldedY - world.y,
    foldedZ - world.z,
  );
  let impact = clamp(foldInfluence * 0.95, 0.0, 1.0);
  let flowRetention = 1.0 - clamp(max(hover, foldInfluence), 0.0, 1.0);

  var out: DeformedPoint;
  out.point = world + (ambient + sheetPulse + layerDrift) * flowRetention +
    hoverPush + hoverOrbit + grabCompression;
  out.impact = impact;
  return out;
}

@vertex
fn surfaceVertexMain(
  @location(0) world: vec3f,
  @location(1) baseNormal: vec3f,
) -> SurfaceVertexOut {
  let phase = world.y * 2.0;
  let center = deformPoint(world, phase);
  let tangentX = deformPoint(world + vec3f(0.006, 0.0, 0.0), phase).point - center.point;
  let tangentY = deformPoint(world + vec3f(0.0, 0.006, 0.0), phase).point - center.point;
  let deformedNormal = normalize(cross(normalize(tangentX), normalize(tangentY)));
  let foldNormal = normalize(deformedNormal + baseNormal * 0.12);
  let lightDirection = normalize(vec3f(-0.35, -0.55, 0.75));
  let projected = projectPoint(center.point);

  var out: SurfaceVertexOut;
  out.position = vec4f(projected.clip, projected.depth, 1.0);
  out.light = dot(foldNormal, lightDirection) * 0.5 + 0.5;
  out.impact = center.impact;
  let baseUv = clipToUv(projectPoint(world).clip);
  out.foldSide = clamp((baseUv.y - scene.grab.y) * 3.0, -1.0, 1.0);
  out.depth = center.point.z;
  let verticalFade = 1.0 - smoothstep(0.82, 1.0, abs((world.y - 0.53) / 0.47));
  let horizontalFade = smoothstep(-0.2, 0.0, world.x) *
    (1.0 - smoothstep(1.0, 1.2, world.x));
  out.edgeFade = verticalFade * horizontalFade;
  return out;
}

@fragment
fn surfaceFragmentMain(input: SurfaceVertexOut) -> @location(0) vec4f {
  let faceContrast = input.foldSide * input.impact * 0.16;
  let depthShade = clamp(input.depth * 0.12, -0.08, 0.12);
  let crease = exp(-abs(input.foldSide) * 10.0) * input.impact;
  let foldCeiling = mix(0.985, 0.945, input.impact);
  let value = clamp(
    0.76 + input.light * 0.22 - input.impact * 0.04 - crease * 0.12 -
      faceContrast - depthShade,
    0.42,
    foldCeiling,
  );
  let alpha = (0.72 + input.impact * 0.18) * input.edgeFade;
  return vec4f(vec3f(value), alpha);
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) startData: vec4f,
  @location(1) endData: vec4f,
  @location(2) style: vec4f,
  @location(3) motion: vec4f,
) -> VertexOut {
  let c = corner(vertexIndex);
  let deformationPhase = motion.x + motion.y * 2.0 + motion.z * 1.2;
  let startDeformed = deformPoint(startData.xyz, deformationPhase);
  let endDeformed = deformPoint(endData.xyz, deformationPhase);
  let start = projectPoint(startDeformed.point);
  let end = projectPoint(endDeformed.point);
  let deltaPixels = (end.clip - start.clip) * scene.viewport.xy * 0.5;
  let directionPixels = normalize(deltaPixels + vec2f(0.0001, 0.0002));
  let normalPixels = vec2f(-directionPixels.y, directionPixels.x);
  let halfWidthPixels = max(0.5, style.x * scene.viewport.z * 0.5);
  let normalNdc = normalPixels * halfWidthPixels * 2.0 / scene.viewport.xy;
  let extensionPixels = max(0.4, halfWidthPixels * 0.55);
  let extensionNdc = directionPixels * extensionPixels * 2.0 / scene.viewport.xy;
  let extendedStart = start.clip - extensionNdc;
  let extendedEnd = end.clip + extensionNdc;
  let position = mix(extendedStart, extendedEnd, c.x) + normalNdc * c.y;

  var out: VertexOut;
  out.position = vec4f(position, mix(start.depth, end.depth, c.x), 1.0);
  out.side = c.y;
  out.alpha = style.y;
  out.tone = style.z;
  out.softness = style.w;
  out.depth = mix(startDeformed.point.z, endDeformed.point.z, c.x);
  out.impact = mix(startDeformed.impact, endDeformed.impact, c.x);
  return out;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let sideDistance = abs(input.side);
  let crispEdge = smoothstep(1.0, 0.58, sideDistance);
  let softEdge = pow(clamp(1.0 - sideDistance, 0.0, 1.0), 1.45);
  let edgeAlpha = mix(crispEdge, softEdge, input.softness);
  let depthLift = clamp(-input.depth * 0.12, -0.05, 0.05);
  let restingGraphite = mix(0.58 + depthLift, 0.035, clamp(input.tone, 0.0, 1.0));
  let graphite = mix(restingGraphite, 0.01, input.impact * 0.72);
  let alpha = clamp(input.alpha * edgeAlpha * (1.0 + input.impact * 1.8), 0.0, 0.72);
  return vec4f(vec3f(graphite), alpha);
}
