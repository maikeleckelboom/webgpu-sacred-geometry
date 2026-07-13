struct Particle {
  position: vec2f,
  velocity: vec2f,
  seed: f32,
  depth: f32,
  age: f32,
  lane: f32,
}

struct Render {
  time: f32,
  aspect: f32,
  opacity: f32,
  pixelRatio: f32,
  viewport: vec2f,
  pointer: vec2f,
  pointerStrength: f32,
  pointerRadiusCss: f32,
  compactness: f32,
  exposure: f32,
  trailPixels: f32,
  maxDisplacementCss: f32,
  clearing: f32,
  edgeGain: f32,
  primaryWidth: f32,
  secondaryWidth: f32,
  revealStart: f32,
  compactVisibleShare: f32,
  sceneGain: f32,
  glowGain: f32,
  spriteOpacity: f32,
  primaryShare: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> render: Render;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn quadCorner(vertexIndex: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  return corners[vertexIndex];
}

fn spriteCorner(vertexIndex: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  return corners[vertexIndex];
}

fn lifeFade(particle: Particle) -> f32 {
  let lifetime = mix(24.0, 44.0, hash11(particle.seed * 3.91));
  let birth = smoothstep(0.0, 1.4, particle.age);
  let death = 1.0 - smoothstep(lifetime - 3.2, lifetime, particle.age);
  return clamp(birth * death, 0.0, 1.0);
}

fn layerValue(seed: f32) -> f32 {
  return hash11(seed * 5.19);
}

fn revealMask(position: vec2f) -> f32 {
  let reveal = smoothstep(render.revealStart - 0.3, render.revealStart + 0.34, position.x);
  let rightFade = 1.0 - smoothstep(1.18, 1.38, position.x);
  let verticalFade = 1.0 - smoothstep(1.02, 1.2, abs(position.y));
  return reveal * rightFade * verticalFade;
}

fn populationMask(seed: f32) -> f32 {
  let visibleShare = mix(1.0, render.compactVisibleShare, render.compactness);
  return 1.0 - step(visibleShare, hash11(seed * 37.13));
}

fn layerOpacity(seed: f32) -> f32 {
  let layer = layerValue(seed);

  if (layer < render.primaryShare) {
    return 1.0;
  }

  if (layer < 0.96) {
    return 0.0;
  }

  return 0.0;
}

fn auroraColor(particle: Particle) -> vec3f {
  let layer = layerValue(particle.seed);
  let along = smoothstep(-0.2, 1.1, particle.position.x);
  let primary = 1.0 - step(render.primaryShare, layer);
  let coreLane = 1.0 - smoothstep(0.05, 0.2, abs(particle.lane));
  let deepCyan = vec3f(0.035, 0.28, 0.31);
  let mint = vec3f(0.08, 0.61, 0.48);
  let blue = vec3f(0.055, 0.34, 0.62);
  let violet = vec3f(0.29, 0.15, 0.47);
  var color = mix(deepCyan, mint, smoothstep(0.12, 0.9, particle.depth));

  color = mix(color, blue, along * (0.28 + particle.depth * 0.18));

  if (layer >= render.primaryShare) {
    color = mix(blue, violet, 0.2 + particle.depth * 0.22);
  }

  color = mix(color, vec3f(0.14, 0.82, 0.68), primary * coreLane * 0.78);

  return color;
}

// Returns NDC displacement in xy and circular CSS-pixel falloff in z.
fn pointerLens(point: vec2f, fallback: vec2f) -> vec3f {
  let cssViewport = render.viewport / max(render.pixelRatio, 0.001);
  let deltaCss = (point - render.pointer) * cssViewport * 0.5;
  let distanceCss = length(deltaCss);

  if (distanceCss >= render.pointerRadiusCss || render.pointerStrength <= 0.0001) {
    return vec3f(0.0);
  }

  let directionCss = select(normalize(fallback + vec2f(0.001, 0.0)), deltaCss / max(distanceCss, 0.001), distanceCss > 1.0);
  let falloff = 1.0 - smoothstep(render.pointerRadiusCss * 0.22, render.pointerRadiusCss, distanceCss);
  let displacementCss = min(render.maxDisplacementCss, render.maxDisplacementCss * falloff) * render.pointerStrength;
  let displacementNdc = directionCss * displacementCss * 2.0 / max(cssViewport, vec2f(1.0));
  return vec3f(displacementNdc, falloff);
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = quadCorner(vertexIndex);
  let direction = normalize(particle.velocity + vec2f(0.0001, 0.0001));
  let screenDirection = normalize(vec2f(direction.x * render.viewport.x, direction.y * render.viewport.y));
  let screenNormal = vec2f(-screenDirection.y, screenDirection.x);
  let cssPixelNdc = 2.0 * render.pixelRatio / max(render.viewport, vec2f(1.0));
  let trailPixels = render.trailPixels * mix(0.72, 1.06, particle.depth);
  let trailOffset = screenDirection * cssPixelNdc * trailPixels;
  let head = particle.position;
  let tail = head - trailOffset;
  let fallback = screenNormal * select(-1.0, 1.0, particle.lane >= 0.0);
  let tailLens = pointerLens(tail, fallback);
  let headLens = pointerLens(head, fallback);
  let center = mix(tail + tailLens.xy, head + headLens.xy, corner.x);
  let lensFalloff = mix(tailLens.z, headLens.z, corner.x);
  let focus = 1.0 - abs(particle.depth - 0.56) * 1.8;
  let widthCss = 0.58 + clamp(focus, 0.0, 1.0) * 0.68 + particle.depth * 0.24;
  let position = center + screenNormal * cssPixelNdc * corner.y * widthCss;
  let ring = 4.0 * lensFalloff * (1.0 - lensFalloff);
  let coreLane = 1.0 - smoothstep(0.045, 0.2, abs(particle.lane));
  let primary = 1.0 - step(render.primaryShare, layerValue(particle.seed));
  let interactionAlpha =
    (1.0 - lensFalloff * render.clearing) * (1.0 + ring * render.edgeGain);
  let baseAlpha = mix(0.082, 0.15, particle.depth) * (1.0 + coreLane * primary * 0.72);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = auroraColor(particle);
  out.alpha =
    render.opacity *
    baseAlpha *
    layerOpacity(particle.seed) *
    revealMask(particle.position) *
    populationMask(particle.seed) *
    lifeFade(particle) *
    interactionAlpha;
  return out;
}

@fragment
fn lineFragment(input: VertexOut) -> @location(0) vec4f {
  let edge = clamp(1.0 - abs(input.local.y), 0.0, 1.0);
  let softEdge = smoothstep(0.0, 0.7, edge);
  let fineCore = pow(edge, 4.0);
  let tailFade = smoothstep(0.0, 0.16, input.local.x);
  let headFade = 1.0 - smoothstep(0.86, 1.0, input.local.x);
  let alpha = input.alpha * (softEdge * 0.68 + fineCore * 0.32) * tailFade * headFade;
  return vec4f(input.color * (0.9 + fineCore * 0.38), alpha);
}

@vertex
fn spriteVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = spriteCorner(vertexIndex);
  let atmosphere = step(0.96, layerValue(particle.seed));
  let marker = step(0.79, hash11(particle.seed * 17.17)) * atmosphere;
  let cssPixelNdc = 2.0 * render.pixelRatio / max(render.viewport, vec2f(1.0));
  let radiusCss = mix(0.62, 1.35, hash11(particle.seed * 29.17));
  let position = particle.position + corner * cssPixelNdc * radiusCss;

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = mix(vec3f(0.18, 0.48, 0.58), vec3f(0.34, 0.68, 0.62), particle.depth);
  out.alpha =
    render.spriteOpacity *
    marker *
    revealMask(particle.position) *
    populationMask(particle.seed) *
    lifeFade(particle) *
    0.42;
  return out;
}

@fragment
fn spriteFragment(input: VertexOut) -> @location(0) vec4f {
  let distanceToCenter = length(input.local);
  let disc = 1.0 - smoothstep(0.12, 1.0, distanceToCenter);
  let core = 1.0 - smoothstep(0.0, 0.32, distanceToCenter);
  return vec4f(input.color * (0.72 + core * 0.32), input.alpha * (disc * 0.72 + core * 0.28));
}
