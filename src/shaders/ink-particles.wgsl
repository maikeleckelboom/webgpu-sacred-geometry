
const RING_RADIUS = 0.46;
const RING_CENTER_X = 0.60;
const RING_CENTER_Y = 0.05;

struct Particle {
  position: vec2f,
  velocity: vec2f,
  seed: f32,
  depth: f32,
  age: f32,
  lane: f32,
  mSpeed: f32,
  mCurl: f32,
  mDiv: f32,
  mEnergy: f32,
}

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
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> render: Render;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn lifeFade(particle: Particle) -> f32 {
  let lifetime = mix(7.0, 14.0, hash11(particle.seed * 3.91));
  let birth = smoothstep(0.0, 1.1, particle.age);
  let death = 1.0 - smoothstep(lifetime - 2.0, lifetime, particle.age);
  return clamp(birth * death, 0.0, 1.0);
}

// Fades strokes at the frame edges, inside the glowing ring, and over the
// hero text block on the left so the copy keeps clean paper behind it.
fn inkMask(position: vec2f) -> f32 {
  let horizontal = smoothstep(-1.12, -0.9, position.x) * (1.0 - smoothstep(1.5, 1.68, position.x));
  let vertical = 1.0 - smoothstep(1.02, 1.24, abs(position.y));

  let q = vec2f(position.x * render.aspect, position.y);
  let c = vec2f(render.aspect * RING_CENTER_X, RING_CENTER_Y);
  let r = length(q - c);
  let interior = 1.0 - smoothstep(RING_RADIUS * 0.55, RING_RADIUS * 1.0, r);

  let tx = smoothstep(-1.02, -0.86, position.x) * (1.0 - smoothstep(-0.12, 0.1, position.x));
  let ty = smoothstep(-0.66, -0.44, position.y) * (1.0 - smoothstep(0.42, 0.66, position.y));
  let textShield = tx * ty;

  // The composition breathes from clean paper on the left into dense
  // feathering around the ring on the right.
  let leftFade = 0.08 + 0.92 * smoothstep(-0.55, 0.45, position.x);

  return horizontal * vertical * leftFade * (1.0 - interior * 0.93) * (1.0 - textShield * 0.85);
}

// Per-channel absorption coefficients: the post pass composes strokes as
// paper * exp(-accumulated * strength), so red-heavy absorption reads as
// navy ink on paper.
fn inkAbsorption(particle: Particle) -> vec3f {
  let h = hash11(particle.seed * 9.71);
  let slate = vec3f(1.05, 0.95, 0.75);
  let navy = vec3f(1.9, 1.45, 0.7);
  let blue = vec3f(2.4, 1.5, 0.35);
  var absorb = mix(slate, navy, smoothstep(0.1, 0.8, h));
  absorb = mix(absorb, blue, step(0.965, h));
  return absorb;
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let speed = particle.mSpeed;
  let direction = normalize(particle.velocity + vec2f(0.0001, 0.0002));
  let screenDirection = normalize(vec2f(direction.x * render.viewport.x, direction.y * render.viewport.y));
  let screenNormal = vec2f(-screenDirection.y, screenDirection.x);
  let ndcPixel = vec2f(2.0 / render.viewport.x, 2.0 / render.viewport.y);
  let normal = vec2f(screenNormal.x * ndcPixel.x, screenNormal.y * ndcPixel.y);

  let toPointer = particle.position - render.pointer;
  let pointerDistance = length(vec2f(toPointer.x * render.aspect, toPointer.y));
  let wakeRadius = 0.45 + render.pressure * 0.35;
  let pointerWake = (1.0 - smoothstep(0.03, wakeRadius, pointerDistance)) * render.pointerStrength * (1.0 + render.pressure * 0.6);

  let trail = 0.010 + speed * 0.05 + particle.depth * 0.008 + pointerWake * 0.03;
  let head = particle.position;
  let tail = head - direction * trail;
  let center = mix(tail, head, corner.x);
  let widthPixels = 0.35 + particle.depth * 0.45 + min(abs(particle.mCurl), 1.0) * 0.6 + pointerWake * 0.5;
  let position = center + normal * corner.y * widthPixels;
  let mask = inkMask(particle.position);

  // Broken, dashed strokes read as hand-hatched pen marks instead of
  // continuous marbled contours.
  let dash = 0.55 + 0.45 * sin(particle.age * (5.0 + hash11(particle.seed * 6.13) * 7.0) + particle.seed * 6.2831);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = inkAbsorption(particle);
  let baseAlpha = 0.014 + speed * 0.07 + abs(particle.mCurl) * 0.10 + particle.mEnergy * 0.04;
  out.alpha = render.opacity * mask * lifeFade(particle) * dash * (baseAlpha + pointerWake * 0.06);
  return out;
}

@fragment
fn lineFragment(input: VertexOut) -> @location(0) vec4f {
  let side = pow(clamp(1.0 - abs(input.local.y), 0.0, 1.0), 1.15);
  let headFade = smoothstep(0.0, 0.14, input.local.x);
  let tailFade = 1.0 - smoothstep(0.8, 1.0, input.local.x) * 0.3;
  let alpha = input.alpha * side * headFade * tailFade;
  return vec4f(input.color, alpha);
}

@vertex
fn spriteVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  let corner = corners[vertexIndex];
  let ndcPixel = vec2f(2.0 / render.viewport.x, 2.0 / render.viewport.y);

  let marker = step(0.985, hash11(particle.seed * 17.17));
  let blueDot = step(0.9965, hash11(particle.seed * 29.17));
  let dotted = max(marker, blueDot);
  let sizeHash = hash11(particle.seed * 41.83);
  let radiusPixels = (0.7 + sizeHash * 1.3 + blueDot * 1.5) * (0.75 + particle.depth * 0.5) * dotted;
  let position = particle.position + corner * ndcPixel * radiusPixels;
  let mask = inkMask(particle.position);

  var navyDotInk = vec3f(2.2, 1.7, 0.9);
  let blueInk = vec3f(2.6, 1.35, 0.2);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = mix(navyDotInk, blueInk, blueDot);
  out.alpha = render.opacity * mask * lifeFade(particle) * (marker * 0.22 + blueDot * 0.4);
  return out;
}

@fragment
fn spriteFragment(input: VertexOut) -> @location(0) vec4f {
  let distance = length(input.local);
  let disc = smoothstep(1.0, 0.35, distance);
  return vec4f(input.color, input.alpha * disc);
}
