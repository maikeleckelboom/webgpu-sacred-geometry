
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
  fieldGain: f32,
  padding: vec2f,
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
  let lifetime = mix(10.0, 20.0, hash11(particle.seed * 3.91));
  let birth = smoothstep(0.0, 1.2, particle.age);
  let death = 1.0 - smoothstep(lifetime - 2.4, lifetime, particle.age);
  return clamp(birth * death, 0.0, 1.0);
}

fn basin(point: vec2f, center: vec2f, radius: f32) -> f32 {
  return 1.0 - smoothstep(radius * 0.14, radius, length(point - center));
}

fn fieldEnergy(point: vec2f, time: f32) -> f32 {
  let centerA = vec2f(0.34 + sin(time * 0.09) * 0.045, -0.04 + cos(time * 0.11) * 0.035);
  let centerB = vec2f(0.72 + cos(time * 0.13) * 0.052, 0.32 + sin(time * 0.10) * 0.045);
  let centerC = vec2f(0.78 + sin(time * 0.10) * 0.048, -0.42 + cos(time * 0.12) * 0.055);
  let centerD = vec2f(1.13 + cos(time * 0.08) * 0.045, 0.03 + sin(time * 0.16) * 0.05);
  let centerE = vec2f(0.05 + cos(time * 0.07) * 0.045, 0.55 + sin(time * 0.09) * 0.04);
  let centerF = vec2f(0.08 + sin(time * 0.06) * 0.05, -0.73 + cos(time * 0.10) * 0.05);
  let primary = max(max(basin(point, centerA, 1.02), basin(point, centerB, 0.76)), max(basin(point, centerC, 0.78), basin(point, centerD, 0.7)));
  let outer = max(basin(point, centerE, 0.78), basin(point, centerF, 0.78)) * 0.86;
  return clamp(max(primary, outer), 0.0, 1.0);
}

fn auroraCurtain(point: vec2f, time: f32, phase: f32) -> f32 {
  let sweep = sin(point.x * 3.2 + sin(point.y * 2.1 + phase) * 0.82 + time * 0.16 + phase);
  let fold = sin(point.x * 11.0 + point.y * 2.7 + phase * 1.7 + time * 0.21);
  let ridgeY = mix(-0.72, 0.72, fract(phase * 0.173)) + sweep * 0.1 + fold * 0.036;
  let width = 0.13 + 0.035 * (0.5 + 0.5 * sin(phase + time * 0.05));
  let band = 1.0 - smoothstep(width, width * 3.1, abs(point.y - ridgeY));
  let columnWave = 0.5 + 0.5 * sin(point.x * 38.0 + phase * 5.2 + sin(point.y * 5.0 + time * 0.22) * 2.0);
  let columns = 0.46 + 0.54 * columnWave * columnWave;
  let view = smoothstep(-0.96, -0.46, point.x) * (1.0 - smoothstep(1.4, 1.66, point.x));
  return band * columns * view;
}

fn auroraEnergy(point: vec2f, time: f32) -> f32 {
  let high = auroraCurtain(point, time, 2.31) * 0.85;
  let middle = auroraCurtain(point + vec2f(0.08, -0.18), time, 4.97) * 0.76;
  let low = auroraCurtain(point + vec2f(-0.16, 0.28), time, 8.41) * 0.62;
  return clamp(high + middle + low, 0.0, 1.0);
}

fn auroraColor(point: vec2f, depth: f32, energy: f32, time: f32, seed: f32) -> vec3f {
  let rhythm = 0.5 + 0.5 * sin(seed * 0.013 + point.x * 5.4 + point.y * 2.1 + time * 0.18);
  let green = vec3f(0.25, 1.0, 0.58);
  let cyan = vec3f(0.14, 0.78, 1.0);
  let violet = vec3f(0.82, 0.32, 1.0);
  let gold = vec3f(1.0, 0.76, 0.34);
  var color = mix(green, cyan, smoothstep(0.16, 0.8, rhythm));
  color = mix(color, violet, smoothstep(0.58, 1.0, energy) * (0.24 + depth * 0.18));
  color = mix(color, gold, smoothstep(0.94, 1.0, hash11(seed * 9.71)) * 0.5);
  return color;
}

fn sceneMask(position: vec2f) -> f32 {
  let horizontal = smoothstep(-1.02, -0.58, position.x) * (1.0 - smoothstep(1.46, 1.68, position.x));
  let vertical = 1.0 - smoothstep(1.04, 1.28, abs(position.y));
  let textRelief = mix(0.42, 1.0, smoothstep(-0.28, 0.16, position.x));
  return horizontal * vertical * textRelief;
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = quadCorner(vertexIndex);
  let speed = length(particle.velocity);
  let direction = normalize(particle.velocity + vec2f(0.0001, 0.0002));
  let screenDirection = normalize(vec2f(direction.x * render.viewport.x, direction.y * render.viewport.y));
  let screenNormal = vec2f(-screenDirection.y, screenDirection.x);
  let ndcPixel = vec2f(2.0 / render.viewport.x, 2.0 / render.viewport.y);
  let normal = vec2f(screenNormal.x * ndcPixel.x, screenNormal.y * ndcPixel.y);
  let pointerWake = (1.0 - smoothstep(0.035, 0.5, length(particle.position - render.pointer))) * render.pointerStrength;
  let energy = fieldEnergy(particle.position, render.time);
  let aurora = auroraEnergy(particle.position, render.time);
  let trail = 0.026 + speed * 0.128 + particle.depth * 0.026 + aurora * 0.038 + pointerWake * 0.07;
  let head = particle.position;
  let tail = head - direction * trail;
  let center = mix(tail, head, corner.x);
  let focusBand = 1.0 - abs(particle.depth - 0.56) * 1.7;
  let blur = smoothstep(0.82, 1.0, particle.depth) + smoothstep(0.08, 0.0, particle.depth);
  let widthPixels = 0.62 + clamp(focusBand, 0.0, 1.0) * 0.72 + blur * 0.9 + speed * 4.4 + aurora * 0.82 + pointerWake * 1.45;
  let position = center + normal * corner.y * widthPixels;
  let mask = sceneMask(particle.position);
  let glint = step(0.976, hash11(particle.seed * 23.71));

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = auroraColor(particle.position, particle.depth, aurora, render.time, particle.seed);
  out.color = mix(out.color, vec3f(1.0, 0.94, 0.74), glint * 0.45);
  out.alpha = render.opacity * mask * lifeFade(particle) * (0.042 + energy * 0.08 + aurora * 0.115 + (1.0 - particle.depth) * 0.018 + glint * 0.16 + pointerWake * 0.15);
  return out;
}

@fragment
fn lineFragment(input: VertexOut) -> @location(0) vec4f {
  let side = pow(clamp(1.0 - abs(input.local.y), 0.0, 1.0), 1.08);
  let headFade = smoothstep(0.0, 0.16, input.local.x);
  let tailFade = 1.0 - smoothstep(0.82, 1.0, input.local.x) * 0.24;
  let alpha = input.alpha * side * headFade * tailFade;
  return vec4f(input.color * 1.18, alpha);
}

@vertex
fn spriteVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = spriteCorner(vertexIndex);
  let ndcPixel = vec2f(2.0 / render.viewport.x, 2.0 / render.viewport.y);
  let marker = smoothstep(0.92, 0.998, hash11(particle.seed * 17.17));
  let node = step(0.9992, hash11(particle.seed * 29.17));
  let glint = step(0.966, hash11(particle.seed * 41.83));
  let energy = fieldEnergy(particle.position, render.time);
  let aurora = auroraEnergy(particle.position, render.time);
  let pointerWake = (1.0 - smoothstep(0.02, 0.43, length(particle.position - render.pointer))) * render.pointerStrength;
  let pulse = 0.9 + sin(render.time * 1.8 + particle.seed * 0.031) * 0.1;
  let radiusPixels = (0.65 + marker * (2.8 + energy * 2.0 + aurora * 3.0) + node * 1.4 + glint * 5.4 + pointerWake * 3.6) * pulse;
  let position = particle.position + corner * ndcPixel * radiusPixels;
  let mask = sceneMask(particle.position);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = auroraColor(particle.position, particle.depth, aurora, render.time, particle.seed);
  out.color = mix(out.color, vec3f(1.0, 0.94, 0.74), max(glint * 0.55, node * 0.28));
  out.alpha = render.opacity * mask * lifeFade(particle) * (marker * (0.14 + energy * 0.18 + aurora * 0.22) + node * 0.1 + glint * 0.32 + pointerWake * 0.24);
  return out;
}

@fragment
fn spriteFragment(input: VertexOut) -> @location(0) vec4f {
  let distance = length(input.local);
  let disc = smoothstep(1.0, 0.16, distance);
  let core = smoothstep(0.48, 0.0, distance);
  let alpha = input.alpha * (disc * 0.72 + core * 0.5);
  return vec4f(input.color * (0.9 + core * 0.95), alpha);
}

