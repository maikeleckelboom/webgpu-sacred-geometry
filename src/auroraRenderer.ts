const PARTICLE_COUNT = 72000;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 8;
const UNIFORM_FLOATS = 12;

const computeShader = /* wgsl */ `
const particleCount = ${PARTICLE_COUNT}u;

struct Particle {
  position: vec2f,
  velocity: vec2f,
  seed: f32,
  depth: f32,
  age: f32,
  lane: f32,
}

struct Sim {
  deltaTime: f32,
  time: f32,
  aspect: f32,
  motion: f32,
  pointer: vec2f,
  pointerStrength: f32,
  padding: f32,
}

@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> targetParticles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn spawn(seed: f32, epoch: f32) -> Particle {
  let h0 = hash11(seed + epoch * 1.37);
  let h1 = hash11(seed * 2.31 + epoch * 1.91);
  let h2 = hash11(seed * 3.73 + epoch * 2.17);
  let h3 = hash11(seed * 5.19 + epoch * 2.73);
  let h4 = hash11(seed * 7.41 + epoch * 3.11);
  let h5 = hash11(seed * 11.7 + epoch * 3.97);
  let h6 = hash11(seed * 13.3 + epoch * 5.23);

  var particle: Particle;
  particle.position = vec2f(mix(-0.92, 1.46, h0), mix(-1.12, 1.1, h1));
  particle.velocity = vec2f(mix(0.04, 0.18, h2), mix(-0.11, 0.12, h3));
  particle.seed = seed;
  particle.depth = h4;
  particle.age = h5 * mix(10.0, 20.0, h4);
  particle.lane = mix(-1.0, 1.0, h6);
  return particle;
}

fn flowNoise(point: vec2f, lane: f32, time: f32) -> vec2f {
  let waveA = sin((point.y + lane * 0.12) * 8.4 + point.x * 1.9 + time * 0.31);
  let waveB = cos((point.x - lane * 0.08) * 6.7 - point.y * 1.6 - time * 0.24);
  let waveC = sin((point.x * 3.4 - point.y * 4.1) + lane * 2.2 + time * 0.17);
  let waveD = cos((point.x * 2.1 + point.y * 3.6) - time * 0.19);
  return normalize(vec2f(waveA + waveC * 0.72, waveB - waveD * 0.58) + vec2f(0.001, -0.002));
}

fn basin(point: vec2f, center: vec2f, radius: f32) -> f32 {
  return 1.0 - smoothstep(radius * 0.14, radius, length(point - center));
}

fn vortex(point: vec2f, center: vec2f, spin: f32, radius: f32, orbitStrength: f32, pullStrength: f32) -> vec2f {
  let toCenter = center - point;
  let distance = max(length(toCenter), 0.001);
  let toward = toCenter / distance;
  let tangent = vec2f(-toward.y, toward.x) * spin;
  let outer = 1.0 - smoothstep(radius * 0.28, radius * 1.42, distance);
  let inner = 1.0 - smoothstep(radius * 0.04, radius * 0.64, distance);
  let shell = outer * (0.34 + inner * 0.66);
  return tangent * orbitStrength * shell + toward * pullStrength * inner;
}

fn lensPosition(slot: u32, time: f32, pointer: vec2f, pointerStrength: f32) -> vec2f {
  var base = vec2f(0.58, -0.28);
  var drift = vec2f(sin(time * 0.18) * 0.035, cos(time * 0.14) * 0.026);

  if (slot == 1u) {
    base = vec2f(0.94, 0.23);
    drift = vec2f(cos(time * 0.13) * 0.03, sin(time * 0.17) * 0.025);
  } else if (slot == 2u) {
    base = vec2f(1.18, -0.5);
    drift = vec2f(sin(time * 0.1) * 0.045, cos(time * 0.12) * 0.03);
  } else if (slot == 3u) {
    base = vec2f(0.28, 0.49);
    drift = vec2f(cos(time * 0.11) * 0.034, sin(time * 0.13) * 0.03);
  } else if (slot == 4u) {
    base = vec2f(1.25, 0.45);
    drift = vec2f(cos(time * 0.09) * 0.025, sin(time * 0.18) * 0.024);
  }

  let moving = base + drift;
  let toPointer = pointer - moving;
  let pointerPull = (1.0 - smoothstep(0.04, 0.48, length(toPointer))) * pointerStrength;
  return moving + toPointer * pointerPull * 0.08;
}

fn lensGravity(point: vec2f, lens: vec2f, radius: f32, mass: f32, spin: f32) -> vec2f {
  let toLens = lens - point;
  let distance = max(length(toLens), 0.001);
  let toward = toLens / distance;
  let tangent = vec2f(-toward.y, toward.x) * spin;
  let shell = smoothstep(radius * 1.15, radius * 4.0, distance) * (1.0 - smoothstep(radius * 7.0, radius * 13.0, distance));
  let wide = 1.0 - smoothstep(radius * 4.0, radius * 16.0, distance);
  let core = 1.0 - smoothstep(radius * 0.65, radius * 2.0, distance);
  let softened = 1.0 / (1.0 + distance * distance * 10.0);
  return tangent * mass * 0.58 * shell * softened + toward * mass * 0.16 * wide * softened - toward * mass * 0.28 * core;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn computeMain(@builtin(global_invocation_id) globalId: vec3u) {
  if (globalId.x >= particleCount) {
    return;
  }

  let index = globalId.x;
  var particle = sourceParticles[index];
  let lifetime = mix(10.0, 20.0, hash11(particle.seed * 3.91));
  let epoch = floor(sim.time * 0.046 + particle.seed * 0.013);

  if (
    particle.age > lifetime ||
    particle.position.x < -1.08 ||
    particle.position.x > 1.62 ||
    abs(particle.position.y) > 1.3
  ) {
    particle = spawn(particle.seed, epoch);
  }

  let deltaTime = min(sim.deltaTime, 0.033);
  let position = particle.position;
  let centerA = vec2f(0.34 + sin(sim.time * 0.09) * 0.045, -0.04 + cos(sim.time * 0.11) * 0.035);
  let centerB = vec2f(0.72 + cos(sim.time * 0.13) * 0.052, 0.32 + sin(sim.time * 0.10) * 0.045);
  let centerC = vec2f(0.78 + sin(sim.time * 0.10) * 0.048, -0.42 + cos(sim.time * 0.12) * 0.055);
  let centerD = vec2f(1.13 + cos(sim.time * 0.08) * 0.045, 0.03 + sin(sim.time * 0.16) * 0.05);
  let centerE = vec2f(0.05 + cos(sim.time * 0.07) * 0.045, 0.55 + sin(sim.time * 0.09) * 0.04);
  let centerF = vec2f(0.08 + sin(sim.time * 0.06) * 0.05, -0.73 + cos(sim.time * 0.10) * 0.05);

  let weightA = basin(position, centerA, 1.08);
  let weightB = basin(position, centerB, 0.8);
  let weightC = basin(position, centerC, 0.82);
  let weightD = basin(position, centerD, 0.74);
  let weightE = basin(position, centerE, 0.78);
  let weightF = basin(position, centerF, 0.78);

  let curl = flowNoise(position, particle.lane, sim.time);
  let river = vec2f(0.12, 0.0) + curl * 0.09;
  let vortexField =
    vortex(position, centerA, 1.0, 1.08, 0.18, 0.032) +
    vortex(position, centerB, -1.0, 0.8, 0.13, 0.018) +
    vortex(position, centerC, -1.0, 0.82, 0.12, 0.02) +
    vortex(position, centerD, 1.0, 0.74, 0.11, 0.016) +
    vortex(position, centerE, -1.0, 0.78, 0.08, 0.012) +
    vortex(position, centerF, 1.0, 0.78, 0.08, 0.012);

  let bridgeAB = normalize(centerB - centerA + vec2f(0.001, 0.001)) * weightA * weightB * 0.07;
  let bridgeAC = normalize(centerC - centerA + vec2f(0.001, -0.001)) * weightA * weightC * 0.06;
  let bridgeBD = normalize(centerD - centerB + vec2f(0.001, 0.001)) * weightB * weightD * 0.05;
  let bridgeCF = normalize(centerC - centerF + vec2f(-0.001, 0.001)) * weightC * weightF * 0.045;
  let saddle = bridgeAB + bridgeAC + bridgeBD + bridgeCF;

  let lensA = lensPosition(0u, sim.time, sim.pointer, sim.pointerStrength);
  let lensB = lensPosition(1u, sim.time, sim.pointer, sim.pointerStrength);
  let lensC = lensPosition(2u, sim.time, sim.pointer, sim.pointerStrength);
  let lensD = lensPosition(3u, sim.time, sim.pointer, sim.pointerStrength);
  let lensE = lensPosition(4u, sim.time, sim.pointer, sim.pointerStrength);
  let lensField =
    lensGravity(position, lensA, 0.055, 0.076, 1.0) +
    lensGravity(position, lensB, 0.04, 0.052, -1.0) +
    lensGravity(position, lensC, 0.07, 0.068, 1.0) +
    lensGravity(position, lensD, 0.035, 0.046, -1.0) +
    lensGravity(position, lensE, 0.047, 0.044, 1.0);

  let toPointer = sim.pointer - position;
  let pointerDistance = max(length(toPointer), 0.001);
  let pointerToward = toPointer / pointerDistance;
  let pointerTangent = vec2f(-pointerToward.y, pointerToward.x);
  let pointerFalloff = (1.0 - smoothstep(0.02, 0.78, pointerDistance)) * sim.pointerStrength;
  let pointerDeflection = pointerTangent * pointerFalloff * 0.42 + pointerToward * pointerFalloff * 0.18;

  let targetVelocity = river + vortexField + saddle + lensField + pointerDeflection;
  let response = 0.03 + particle.depth * 0.048 + pointerFalloff * 0.05;
  particle.velocity = mix(particle.velocity, targetVelocity, response);
  particle.position = particle.position + particle.velocity * deltaTime * sim.motion * (0.5 + particle.depth * 0.5);
  particle.age = particle.age + deltaTime * (0.68 + particle.depth * 0.34);

  if (particle.age > lifetime) {
    particle = spawn(particle.seed, epoch + 1.0);
  }

  targetParticles[index] = particle;
}
`;

const particleRenderShader = /* wgsl */ `
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
`;

const postShader = /* wgsl */ `
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
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> render: Render;

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

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn curtain(uv: vec2f, time: f32, phase: f32, baseY: f32, thickness: f32) -> f32 {
  let wave = sin(uv.x * 5.4 + sin(uv.x * 2.2 + time * 0.05 + phase) * 1.3 + phase + time * 0.08);
  let ridge = baseY + wave * 0.055 + sin(uv.x * 16.0 + phase + time * 0.07) * 0.018;
  let distanceToRidge = abs(uv.y - ridge);
  let band = 1.0 - smoothstep(thickness, thickness * 2.8, distanceToRidge);
  let lift = (1.0 - smoothstep(thickness * 2.4, thickness * 5.2, distanceToRidge)) * 0.34;
  let columnWave = 0.5 + 0.5 * sin(uv.x * 46.0 + uv.y * 8.0 + phase * 3.1 + time * 0.28);
  let columns = 0.34 + 0.66 * columnWave * columnWave;
  let verticalFade = smoothstep(0.02, 0.18, uv.y) * (1.0 - smoothstep(0.94, 1.08, uv.y));
  let sideFade = smoothstep(-0.02, 0.16, uv.x) * (1.0 - smoothstep(0.98, 1.12, uv.x));
  return (band * columns + lift) * verticalFade * sideFade;
}

fn skyColor(uv: vec2f, time: f32) -> vec3f {
  let vertical = smoothstep(0.0, 1.0, uv.y);
  var color = mix(vec3f(0.006, 0.007, 0.011), vec3f(0.018, 0.054, 0.04), vertical);
  color += vec3f(0.032, 0.008, 0.04) * smoothstep(0.24, 0.92, uv.x) * smoothstep(0.06, 0.8, uv.y);

  let starGrid = floor(uv * vec2f(260.0, 150.0));
  let star = step(0.9955, hash21(starGrid));
  let twinkle = 0.62 + 0.38 * sin(time * 1.9 + hash21(starGrid + vec2f(11.0, 11.0)) * 6.2831);
  color += vec3f(0.5, 0.86, 0.74) * star * twinkle * 0.26 * smoothstep(0.2, 0.96, uv.y);

  return color;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let textureSize = vec2f(textureDimensions(sceneTexture, 0));
  let texel = 1.0 / max(textureSize, vec2f(1.0, 1.0));
  let center = textureSample(sceneTexture, postSampler, input.uv);
  var bloom = center.rgb * 0.56;
  bloom += textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(2.0, 0.0)).rgb * 0.16;
  bloom += textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(-2.0, 0.0)).rgb * 0.16;
  bloom += textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(0.0, 2.0)).rgb * 0.14;
  bloom += textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(0.0, -2.0)).rgb * 0.14;

  let high = curtain(input.uv, render.time, 1.7, 0.7, 0.15);
  let middle = curtain(input.uv, render.time, 4.6, 0.5, 0.12);
  let low = curtain(input.uv, render.time, 7.9, 0.33, 0.096);
  let aurora =
    vec3f(0.12, 0.9, 0.45) * high +
    vec3f(0.06, 0.64, 0.96) * middle +
    vec3f(0.76, 0.24, 0.92) * low;
  let pointerGlow = 1.0 - smoothstep(0.0, 0.55, distance(input.uv * 2.0 - vec2f(1.0, 1.0), render.pointer));
  let sceneLight = center.rgb * 0.76 + bloom * vec3f(0.72, 1.02, 0.86);
  let color = skyColor(input.uv, render.time) + aurora * 1.72 + sceneLight + vec3f(0.12, 0.82, 0.54) * pointerGlow * render.pointerStrength * 0.2;
  let toneMapped = vec3f(1.0) - exp(-color * vec3f(1.02, 0.9, 0.98));
  return vec4f(toneMapped, 1.0);
}
`;

interface PointerState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  strength: number;
}

export interface AuroraRenderer {
  destroy: () => void;
}

export async function startAuroraRenderer(canvas: HTMLCanvasElement): Promise<AuroraRenderer> {
  if (!navigator.gpu) {
    throw new Error(
      "This browser does not expose navigator.gpu. Use a WebGPU-capable Chromium, Edge, or Safari build.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter();

  if (!adapter) {
    throw new Error("WebGPU is available, but no compatible GPU adapter was returned.");
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");

  if (!context) {
    throw new Error("Could not create a WebGPU canvas context.");
  }

  const gpuContext = context;
  const format = navigator.gpu.getPreferredCanvasFormat();
  device.addEventListener("uncapturederror", (event) => {
    console.error(`Flow WebGPU error: ${event.error.message}`);
  });
  device.pushErrorScope("validation");
  const particleData = createInitialParticles(PARTICLE_COUNT);
  const particleBuffers = [
    createStorageBuffer(device, "flow particles A", particleData.byteLength),
    createStorageBuffer(device, "flow particles B", particleData.byteLength),
  ];

  device.queue.writeBuffer(particleBuffers[0], 0, particleData);
  device.queue.writeBuffer(particleBuffers[1], 0, particleData);

  const simBuffer = device.createBuffer({
    label: "flow simulation uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderBuffer = device.createBuffer({
    label: "flow render uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const computeModule = device.createShaderModule({
    label: "flow compute shader",
    code: computeShader,
  });
  const renderModule = device.createShaderModule({
    label: "flow particle render shader",
    code: particleRenderShader,
  });
  const postModule = device.createShaderModule({
    label: "flow post shader",
    code: postShader,
  });
  const computePipeline = device.createComputePipeline({
    label: "flow compute pipeline",
    layout: "auto",
    compute: {
      module: computeModule,
      entryPoint: "computeMain",
    },
  });
  const linePipeline = createParticlePipeline(
    device,
    renderModule,
    format,
    "lineVertex",
    "lineFragment",
    "flow line pipeline",
  );
  const spritePipeline = createParticlePipeline(
    device,
    renderModule,
    format,
    "spriteVertex",
    "spriteFragment",
    "flow sprite pipeline",
  );
  const postPipeline = device.createRenderPipeline({
    label: "flow post pipeline",
    layout: "auto",
    vertex: {
      module: postModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: postModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const computeBindGroups = [
    createComputeBindGroup(
      device,
      computePipeline,
      particleBuffers[0],
      particleBuffers[1],
      simBuffer,
    ),
    createComputeBindGroup(
      device,
      computePipeline,
      particleBuffers[1],
      particleBuffers[0],
      simBuffer,
    ),
  ];
  const lineBindGroups = [
    createRenderBindGroup(device, linePipeline, particleBuffers[0], renderBuffer),
    createRenderBindGroup(device, linePipeline, particleBuffers[1], renderBuffer),
  ];
  const spriteBindGroups = [
    createRenderBindGroup(device, spritePipeline, particleBuffers[0], renderBuffer),
    createRenderBindGroup(device, spritePipeline, particleBuffers[1], renderBuffer),
  ];
  const setupError = await device.popErrorScope();

  if (setupError) {
    throw new Error(`Flow WebGPU setup failed: ${setupError.message}`);
  }

  const sampler = device.createSampler({
    label: "flow post sampler",
    magFilter: "linear",
    minFilter: "linear",
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer: PointerState = {
    x: 0.42,
    y: 0,
    targetX: 0.42,
    targetY: 0,
    strength: 0,
  };
  const simUniforms = new Float32Array(UNIFORM_FLOATS);
  const renderUniforms = new Float32Array(UNIFORM_FLOATS);
  const abortController = new AbortController();
  let offscreenTexture: GPUTexture | null = null;
  let postBindGroup: GPUBindGroup | null = null;
  let sourceIndex = 0;
  let lastTime = 0;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.targetX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.targetY = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.strength = Math.min(1, pointer.strength + 0.18);
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.targetX = 0.42;
      pointer.targetY = 0;
      pointer.strength = Math.min(pointer.strength, 0.18);
    },
    { signal: abortController.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else {
        scheduleFrame();
      }
    },
    { signal: abortController.signal },
  );

  function refreshTargets(): void {
    if (!resizeCanvas(canvas) && offscreenTexture && postBindGroup) {
      return;
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    offscreenTexture?.destroy();
    offscreenTexture = device.createTexture({
      label: "flow offscreen texture",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    postBindGroup = device.createBindGroup({
      label: "flow post bind group",
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: sampler,
        },
        {
          binding: 1,
          resource: offscreenTexture.createView(),
        },
        {
          binding: 2,
          resource: {
            buffer: renderBuffer,
          },
        },
      ],
    });
  }

  function frame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    refreshTargets();

    if (!offscreenTexture || !postBindGroup) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const deltaTime = lastTime > 0 ? seconds - lastTime : 1 / 60;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? 0.28 : 1;
    pointer.x += (pointer.targetX - pointer.x) * 0.065;
    pointer.y += (pointer.targetY - pointer.y) * 0.065;
    pointer.strength *= reducedMotion ? 0.9 : 0.965;
    lastTime = seconds;

    simUniforms.set([
      deltaTime,
      seconds,
      aspect,
      motion,
      pointer.x,
      pointer.y,
      pointer.strength,
      0,
    ]);
    renderUniforms.set([
      seconds,
      aspect,
      1,
      window.devicePixelRatio || 1,
      canvas.width,
      canvas.height,
      pointer.x,
      pointer.y,
      pointer.strength,
      1,
      0,
      0,
    ]);
    device.queue.writeBuffer(simBuffer, 0, simUniforms);
    device.queue.writeBuffer(renderBuffer, 0, renderUniforms);

    const targetIndex = 1 - sourceIndex;
    const encoder = device.createCommandEncoder({
      label: "flow frame encoder",
    });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const computePass = encoder.beginComputePass({
      label: "flow compute pass",
    });
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroups[sourceIndex]);
    computePass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
    computePass.end();

    const scenePass = encoder.beginRenderPass({
      label: "flow scene pass",
      colorAttachments: [
        {
          view: offscreenTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    scenePass.setPipeline(linePipeline);
    scenePass.setBindGroup(0, lineBindGroups[targetIndex]);
    scenePass.draw(6, PARTICLE_COUNT);
    scenePass.setPipeline(spritePipeline);
    scenePass.setBindGroup(0, spriteBindGroups[targetIndex]);
    scenePass.draw(6, PARTICLE_COUNT);
    scenePass.end();

    const postPass = encoder.beginRenderPass({
      label: "flow post pass",
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    postPass.setPipeline(postPipeline);
    postPass.setBindGroup(0, postBindGroup);
    postPass.draw(3);
    postPass.end();

    device.queue.submit([encoder.finish()]);

    if (!checkedFirstFrame) {
      checkedFirstFrame = true;
      void device.popErrorScope().then((frameError) => {
        if (frameError) {
          console.error(`Flow WebGPU frame failed: ${frameError.message}`);
        }
      });
    }

    sourceIndex = targetIndex;
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  const renderer: AuroraRenderer = {
    destroy: () => {
      if (!active) {
        return;
      }

      active = false;
      abortController.abort();

      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }

      offscreenTexture?.destroy();
      particleBuffers[0].destroy();
      particleBuffers[1].destroy();
      simBuffer.destroy();
      renderBuffer.destroy();
    },
  };

  scheduleFrame();
  return renderer;
}

function createStorageBuffer(device: GPUDevice, label: string, size: number): GPUBuffer {
  return device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
}

function createComputeBindGroup(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  source: GPUBuffer,
  target: GPUBuffer,
  uniforms: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: "flow compute bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: source,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: target,
        },
      },
      {
        binding: 2,
        resource: {
          buffer: uniforms,
        },
      },
    ],
  });
}

function createRenderBindGroup(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  particles: GPUBuffer,
  uniforms: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: "flow render bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: particles,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: uniforms,
        },
      },
    ],
  });
}

function createParticlePipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  format: GPUTextureFormat,
  vertexEntryPoint: string,
  fragmentEntryPoint: string,
  label: string,
): GPURenderPipeline {
  return device.createRenderPipeline({
    label,
    layout: "auto",
    vertex: {
      module,
      entryPoint: vertexEntryPoint,
    },
    fragment: {
      module,
      entryPoint: fragmentEntryPoint,
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: "src-alpha",
              dstFactor: "one",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}

function createInitialParticles(count: number): Float32Array {
  const particles = new Float32Array(count * FLOATS_PER_PARTICLE);

  for (let index = 0; index < count; index += 1) {
    const seed = index * 0.61803398875 + 0.123;
    const offset = index * FLOATS_PER_PARTICLE;
    const depth = hash(seed * 7.41);
    const lifetime = lerp(10, 20, hash(seed * 3.91));

    particles[offset] = lerp(-0.92, 1.46, hash(seed));
    particles[offset + 1] = lerp(-1.12, 1.1, hash(seed * 2.31));
    particles[offset + 2] = lerp(0.04, 0.18, hash(seed * 3.73));
    particles[offset + 3] = lerp(-0.11, 0.12, hash(seed * 5.19));
    particles[offset + 4] = seed;
    particles[offset + 5] = depth;
    particles[offset + 6] = hash(seed * 11.7) * lifetime;
    particles[offset + 7] = lerp(-1, 1, hash(seed * 13.3));
  }

  return particles;
}

function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));

  if (canvas.width === width && canvas.height === height) {
    return false;
  }

  canvas.width = width;
  canvas.height = height;
  return true;
}

function hash(value: number): number {
  return fract(Math.sin(value * 127.1) * 43758.5453123);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
