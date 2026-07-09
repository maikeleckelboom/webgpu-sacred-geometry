const PARTICLE_COUNT = 72000;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 12;
const UNIFORM_FLOATS = 16;
const TRAIL_DECAY = 0.965;

const BLOOM_LEVELS = 5;
const BLOOM_BASE_MAX = 640;
const BLOOM_THRESHOLD = 0.6;
const BLOOM_SOFT_KNEE = 0.7;
const BLOOM_INTENSITY = 1.0;
const BLOOM_UPSAMPLE_WEIGHT = 0.62;
const BLOOM_EXPOSURE = 0.9;
const BLOOM_SHADING = 0.5;
const BLOOM_GAMMA = 1.0 / 2.4;

const PRESSURE_CHARGE_RATE = 2.15;
const PRESSURE_RELEASE_RATE = 3.0;
const PRESSURE_SWIRL_BOOST = 1.6;
const PRESSURE_BLOOM_BOOST = 2.8;
const PRESSURE_LIGHT_BOOST = 2.4;
const PRESSURE_EXPOSURE_BOOST = 0.22;

const VELOCITY_GAIN = 1.35;

function bloomCurve(threshold: number, softKnee: number): {
  curve: [number, number, number, number];
} {
  const knee = threshold * softKnee + 0.0001;
  return { curve: [threshold - knee, knee * 2, 0.25 / knee, 0] };
}

export type FieldMode = "flow" | "topo" | "arch" | "waves";

const MODE_INDEX: Record<FieldMode, number> = {
  flow: 0,
  topo: 1,
  arch: 2,
  waves: 3,
};

const computeShader = /* wgsl */ `
const particleCount = ${PARTICLE_COUNT}u;
const GOLDEN_ANGLE = 2.39996322972865332;
const FIELD_EPS = 0.045;

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

struct Sim {
  deltaTime: f32,
  time: f32,
  aspect: f32,
  motion: f32,
  pointer: vec2f,
  pointerStrength: f32,
  modeFlow: f32,
  modeMandala: f32,
  modeTopo: f32,
  modeArch: f32,
  modeWaves: f32,
  pressure: f32,
}

@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> targetParticles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;

// === Noise primitives ===
fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn hash22(point: vec2f) -> vec2f {
  let q = vec2f(dot(point, vec2f(127.1, 311.7)), dot(point, vec2f(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(q) * 43758.5453);
}

fn snoise(point: vec2f) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(point + (point.x + point.y) * K1);
  let a = point - i + (i.x + i.y) * K2;
  let o = step(a.yx, a.xy);
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3f(dot(a, a), dot(b, b), dot(c, c)), vec3f(0.0));
  let n = h * h * h * h * vec3f(
    dot(a, hash22(i)),
    dot(b, hash22(i + o)),
    dot(c, hash22(i + vec2f(1.0))),
  );
  return dot(n, vec3f(70.0, 70.0, 70.0));
}

fn fbm(point: vec2f) -> f32 {
  var total = 0.0;
  var amp = 0.5;
  var p = point;
  for (var i = 0u; i < 4u; i = i + 1u) {
    total += snoise(p) * amp;
    p = p * 2.03 + vec2f(1.7, -3.1);
    amp *= 0.5;
  }
  return total;
}

fn curlNoise2D(point: vec2f, time: f32) -> vec2f {
  let pT = point + vec2f(time * 0.08, -time * 0.06);
  let eps = 0.08;
  let n1 = snoise(pT + vec2f(0.0, eps));
  let n2 = snoise(pT - vec2f(0.0, eps));
  let n3 = snoise(pT + vec2f(eps, 0.0));
  let n4 = snoise(pT - vec2f(eps, 0.0));
  return vec2f((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}

// === Atomic field components ===
fn vortex(point: vec2f, center: vec2f, strength: f32) -> vec2f {
  let d = point - center;
  let r2 = dot(d, d) + 0.0009;
  return strength * vec2f(-d.y, d.x) / r2;
}

fn goldenLattice(point: vec2f, time: f32) -> vec2f {
  var acc = vec2f(0.0);
  for (var i = 1u; i <= 11u; i = i + 1u) {
    let fi = f32(i);
    let angle = fi * GOLDEN_ANGLE + time * 0.05;
    let radius = sqrt(fi) * 0.135;
    let c = vec2f(cos(angle), sin(angle)) * radius;
    let d = point - c;
    let r2 = dot(d, d) + 0.045;
    let orbit = vec2f(-d.y, d.x) / r2 * 0.18;
    let breathe = 0.6 + 0.4 * sin(time * 0.3 + fi * 1.7);
    acc += orbit * breathe;
  }
  return acc;
}

fn auroraShear(point: vec2f, time: f32) -> vec2f {
  let p2 = point + curlNoise2D(point * 1.7, time) * 0.18;
  let shear = vec2f(
    sin(p2.y * 3.0 + time * 0.2),
    cos(p2.x * 1.5 + time * 0.1),
  );
  return shear * 0.12;
}

// === Field modes ===
fn fieldModeFlow(point: vec2f, time: f32) -> vec2f {
  let fieldShift = vec2f(0.24, 0.0);
  let p = point - fieldShift;
  let c1 = vec2f(0.24 + sin(time * 0.08) * 0.08, -0.04 + cos(time * 0.10) * 0.06);
  let c2 = vec2f(0.78 + cos(time * 0.12) * 0.06, 0.34 + sin(time * 0.09) * 0.05);
  let c3 = vec2f(0.04 + sin(time * 0.07) * 0.08, 0.55 + cos(time * 0.11) * 0.04);
  var f = curlNoise2D(p * 1.3, time) * 0.22;
  f += auroraShear(p, time);
  f += vortex(point, c1, 0.80) * 0.014;
  f += vortex(point, c2, -0.45) * 0.015;
  f += vortex(point, c3, 0.30) * 0.013;
  f += goldenLattice(p, time) * 0.55;
  return f;
}

fn fieldModeMandala(point: vec2f, time: f32) -> vec2f {
  let r = length(point) + 0.001;
  let theta = atan2(point.y, point.x);
  let pulse = 0.5 + 0.5 * sin(r * 7.5 - time * 0.45);
  let radial = -normalize(point) * (0.045 + 0.025 * sin(time * 0.3));
  let tangent = vec2f(-point.y, point.x) / r * 0.14 * pulse;
  let symmetry = vec2f(
    cos(theta * 6.0 + time * 0.2),
    sin(theta * 6.0 + time * 0.2),
  ) * 0.05;
  let rings = curlNoise2D(point * 2.4, time) * 0.04;
  return radial + tangent + symmetry + rings;
}

fn fieldModeTopography(point: vec2f, time: f32) -> vec2f {
  let r = length(point) + 0.001;
  let bands = sin(r * 6.0 - time * 0.3);
  let tangent = vec2f(-point.y, point.x) / r * 0.10 * bands;
  let drift = curlNoise2D(point * 2.0, time * 0.5) * 0.05;
  return tangent + drift;
}

fn fieldModeArchitecture(point: vec2f, time: f32) -> vec2f {
  let snapX = -point.x * smoothstep(0.0, 0.4, abs(point.x) - 0.05);
  let snapY = -point.y * smoothstep(0.0, 0.4, abs(point.y) - 0.05);
  let tangent = vec2f(-point.y, point.x) * 0.03;
  let breathe = 0.85 + 0.15 * sin(time * 0.4);
  return vec2f(snapX, snapY) * 0.55 * breathe + tangent;
}

fn fieldModeWaves(point: vec2f, time: f32) -> vec2f {
  let phase = point.x * 4.0 - time * 0.6;
  let phase2 = point.y * 3.0 + time * 0.4;
  let wave = vec2f(cos(phase) * 0.20, sin(phase2) * 0.10);
  let swell = curlNoise2D(point * 0.6, time) * 0.04;
  return wave + swell;
}

fn fieldAt(point: vec2f, time: f32) -> vec2f {
  return sim.modeFlow * fieldModeFlow(point, time)
       + sim.modeMandala * fieldModeMandala(point, time)
       + sim.modeTopo * fieldModeTopography(point, time)
       + sim.modeArch * fieldModeArchitecture(point, time)
       + sim.modeWaves * fieldModeWaves(point, time);
}

fn fieldMetricsAt(point: vec2f, time: f32) -> vec4f {
  let eps = FIELD_EPS;
  let fxp = fieldAt(point + vec2f(eps, 0.0), time);
  let fxn = fieldAt(point - vec2f(eps, 0.0), time);
  let fyp = fieldAt(point + vec2f(0.0, eps), time);
  let fyn = fieldAt(point - vec2f(0.0, eps), time);
  let f = fieldAt(point, time);
  let speed = length(f);
  let curl = (fyp.x - fyn.x - fxp.y + fxn.y) / (2.0 * eps);
  let div = (fxp.x - fxn.x + fyp.y - fyn.y) / (2.0 * eps);
  let energy = length(fxp - fxn) + length(fyp - fyn);
  return vec4f(speed, curl, div, energy);
}

fn mouseField(point: vec2f) -> vec2f {
  if (sim.pointerStrength < 0.001) {
    return vec2f(0.0);
  }
  let d = sim.pointer - point;
  let r = length(d) + 0.001;
  let toward = d / r;
  let tangent = vec2f(-toward.y, toward.x);
  let radius = 0.45 + sim.pressure * 0.35;
  let falloff = (1.0 - smoothstep(0.02, radius, r)) * sim.pointerStrength;
  let core = 1.0 - smoothstep(0.0, 0.08, r);
  let charge = 1.0 + sim.pressure * ${PRESSURE_SWIRL_BOOST.toFixed(2)};
  return (tangent * falloff * 0.18 + toward * falloff * 0.04 - toward * core * sim.pointerStrength * 0.1) * charge;
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
  particle.mSpeed = 0.0;
  particle.mCurl = 0.0;
  particle.mDiv = 0.0;
  particle.mEnergy = 0.0;
  return particle;
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
    particle.position.x < -1.1 ||
    particle.position.x > 1.65 ||
    abs(particle.position.y) > 1.32
  ) {
    particle = spawn(particle.seed, epoch);
  }

  let deltaTime = min(sim.deltaTime, 0.033);
  let position = particle.position;
  let fieldVelocity = (fieldAt(position, sim.time) + mouseField(position)) * ${VELOCITY_GAIN.toFixed(2)};
  let response = 0.05 + particle.depth * 0.055;
  particle.velocity = mix(particle.velocity, fieldVelocity, response);
  particle.position = particle.position + particle.velocity * deltaTime * sim.motion * (0.5 + particle.depth * 0.5);
  particle.age = particle.age + deltaTime * (0.68 + particle.depth * 0.34);

  let metrics = fieldMetricsAt(particle.position, sim.time);
  particle.mSpeed = metrics.x;
  particle.mCurl = metrics.y;
  particle.mDiv = metrics.z;
  particle.mEnergy = metrics.w;

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
  fieldGain: f32,
  padding: vec2f,
  pressure: f32,
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
  let lifetime = mix(10.0, 20.0, hash11(particle.seed * 3.91));
  let birth = smoothstep(0.0, 1.2, particle.age);
  let death = 1.0 - smoothstep(lifetime - 2.4, lifetime, particle.age);
  return clamp(birth * death, 0.0, 1.0);
}

fn sceneMask(position: vec2f) -> f32 {
  let horizontal = smoothstep(-1.04, -0.6, position.x) * (1.0 - smoothstep(1.48, 1.7, position.x));
  let vertical = 1.0 - smoothstep(1.04, 1.3, abs(position.y));
  return horizontal * vertical;
}

fn fieldColor(particle: Particle, time: f32) -> vec3f {
  let curlT = clamp(particle.mCurl * 6.0, -1.0, 1.0);
  let hue = curlT * 0.5 + 0.5;
  let cyan = vec3f(0.16, 0.86, 1.0);
  let violet = vec3f(0.78, 0.30, 1.0);
  let green = vec3f(0.32, 1.0, 0.62);
  let amber = vec3f(1.0, 0.76, 0.36);
  var color = mix(cyan, violet, hue);
  color = mix(color, green, smoothstep(0.6, 1.0, abs(particle.mDiv)) * 0.35);
  color = mix(color, amber, smoothstep(0.92, 1.0, hash11(particle.seed * 9.71)) * 0.45);

  let speedN = clamp(particle.mSpeed * 4.0, 0.0, 1.0);
  let curlN = clamp(abs(particle.mCurl) * 6.0, 0.0, 1.0);
  let energyN = clamp(particle.mEnergy * 1.5, 0.0, 1.0);
  let metric = max(max(speedN, curlN * 0.85), energyN * 0.6);

  let surge = 0.55 + 0.24 * sin(time * 0.12) + 0.13 * sin(time * 0.29 + 1.3) + 0.38 * pow(max(0.0, sin(time * 0.15)), 24.0);
  let intensity = (0.06 + pow(metric, 2.4) * 6.5) * clamp(surge, 0.32, 1.4);

  return color * intensity;
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
  let wakeRadius = 0.5 + render.pressure * 0.4;
  let pointerWake = (1.0 - smoothstep(0.035, wakeRadius, pointerDistance)) * render.pointerStrength * (1.0 + render.pressure * 0.65);
  let vectorEnergy = clamp(speed * 2.0 + abs(particle.mCurl) * 4.5 + particle.mEnergy * 0.55, 0.0, 1.0);
  let vectorCharge = smoothstep(0.18, 0.92, vectorEnergy) * render.pressure * render.pointerStrength;
  let trail = 0.022 + speed * 0.20 + particle.depth * 0.025 + pointerWake * 0.055 + vectorCharge * 0.105;
  let head = particle.position;
  let tail = head - direction * trail;
  let center = mix(tail, head, corner.x);
  let widthPixels = 0.5 + speed * 6.0 + abs(particle.mCurl) * 80.0 + pointerWake * 1.05 + vectorCharge * 2.05;
  let position = center + normal * corner.y * widthPixels;
  let mask = sceneMask(particle.position);
  let glintSeed = step(0.978, hash11(particle.seed * 23.71));
  let glintSlow = 0.3 + 0.7 * smoothstep(0.0, 1.0, sin(render.time * 0.55 + particle.seed * 0.14) * 0.5 + 0.5);
  let glintShimmer = glintSeed * (0.3 + 0.7 * sin(render.time * 3.4 + particle.seed * 2.7 + particle.position.x * 4.1)) * glintSlow;
  let headShimmer = 0.82 + 0.18 * smoothstep(0.0, 1.0, sin(render.time * 0.7 + particle.seed * 0.21) * 0.5 + 0.5);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = fieldColor(particle, render.time);
  out.color = out.color * (1.0 + pointerWake * 1.2 + vectorCharge * 2.35);
  out.color = out.color + vec3f(1.0, 0.94, 0.74) * glintShimmer * 2.3;
  let baseAlpha = 0.045 + abs(particle.mCurl) * 4.5 + speed * 0.7 + particle.mEnergy * 0.4;
  out.alpha = render.opacity * mask * lifeFade(particle) * headShimmer * (baseAlpha + glintShimmer * 0.25 + pointerWake * 0.12 + vectorCharge * 0.18);
  return out;
}

@fragment
fn lineFragment(input: VertexOut) -> @location(0) vec4f {
  let side = pow(clamp(1.0 - abs(input.local.y), 0.0, 1.0), 1.08);
  let headFade = smoothstep(0.0, 0.16, input.local.x);
  let tailFade = 1.0 - smoothstep(0.82, 1.0, input.local.x) * 0.24;
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
  let marker = smoothstep(0.92, 0.998, hash11(particle.seed * 17.17));
  let node = step(0.9992, hash11(particle.seed * 29.17));
  let glint = step(0.966, hash11(particle.seed * 41.83));
  let toPointer = particle.position - render.pointer;
  let pointerDistance = length(vec2f(toPointer.x * render.aspect, toPointer.y));
  let wakeRadius = 0.43 + render.pressure * 0.4;
  let pointerWake = (1.0 - smoothstep(0.02, wakeRadius, pointerDistance)) * render.pointerStrength * (1.0 + render.pressure * 0.65);
  let vectorEnergy = clamp(particle.mSpeed * 2.0 + abs(particle.mCurl) * 4.5 + particle.mEnergy * 0.55, 0.0, 1.0);
  let vectorCharge = smoothstep(0.18, 0.92, vectorEnergy) * render.pressure * render.pointerStrength;
  let glintSlow = 0.25 + 0.75 * smoothstep(0.0, 1.0, sin(render.time * 0.5 + particle.seed * 0.16) * 0.5 + 0.5);
  let glintShimmer = glint * (0.4 + 0.6 * sin(render.time * 4.6 + particle.seed * 3.1 + particle.position.x * 2.4)) * glintSlow;
  let nodeSlow = 0.3 + 0.7 * smoothstep(0.0, 1.0, sin(render.time * 0.42 + particle.seed * 0.19) * 0.5 + 0.5);
  let nodeTwinkle = node * (0.55 + 0.45 * sin(render.time * 2.8 + particle.seed * 5.7)) * nodeSlow;
  let pulse = 0.9 + sin(render.time * 1.8 + particle.seed * 0.031) * 0.1;
  let shimmerPulse = pulse * (0.85 + 0.15 * smoothstep(0.0, 1.0, sin(render.time * 0.65 + particle.seed * 0.11) * 0.5 + 0.5));
  let curlBright = abs(particle.mCurl) * 90.0;
  let radiusPixels = (0.65 + marker * (2.8 + particle.mSpeed * 3.0 + curlBright) + node * 1.4 + glint * 5.4 + pointerWake * 2.1 + vectorCharge * 3.2) * shimmerPulse;
  let position = particle.position + corner * ndcPixel * radiusPixels;
  let mask = sceneMask(particle.position);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = fieldColor(particle, render.time);
  out.color = out.color * (1.0 + pointerWake * 1.2 + vectorCharge * 2.35);
  out.color = out.color + vec3f(1.0, 0.94, 0.74) * max(glintShimmer * 0.6, nodeTwinkle * 0.34) * 2.3;
  out.alpha = render.opacity * mask * lifeFade(particle) * (marker * (0.12 + particle.mSpeed * 0.4 + curlBright * 0.4) + nodeTwinkle * 0.12 + glintShimmer * 0.42 + pointerWake * 0.14 + vectorCharge * 0.22);
  return out;
}

@fragment
fn spriteFragment(input: VertexOut) -> @location(0) vec4f {
  let distance = length(input.local);
  let disc = smoothstep(1.0, 0.16, distance);
  let core = smoothstep(0.48, 0.0, distance);
  let alpha = input.alpha * (disc * 0.72 + core * 0.5);
  return vec4f(input.color * (1.0 + core * 1.6), alpha);
}
`;

const accumulationShader = /* wgsl */ `
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
  let prev = textureSample(historyTexture, accumSampler, input.uv).rgb;
  let scene = textureSample(sceneTexture, accumSampler, input.uv).rgb;
  let decayed = prev * accum.decay;
  let combined = decayed + scene;
  let saturated = combined / (1.0 + combined * 0.045);
  return vec4f(saturated, 1.0);
}
`;

const bloomShader = /* wgsl */ `
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
  return lo + hi * ${BLOOM_UPSAMPLE_WEIGHT.toFixed(4)};
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
  bloomIntensity: f32,
  exposure: f32,
  shadingStrength: f32,
  pressure: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var historyTexture: texture_2d<f32>;
@group(0) @binding(2) var bloomTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> render: Render;

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

fn hash22(point: vec2f) -> vec2f {
  let q = vec2f(dot(point, vec2f(127.1, 311.7)), dot(point, vec2f(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(q) * 43758.5453);
}

fn snoise2(point: vec2f) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(point + (point.x + point.y) * K1);
  let a = point - i + (i.x + i.y) * K2;
  let o = step(a.yx, a.xy);
  let b = a - o + K2;
  let c = a - 1.0 + 2.0 * K2;
  let h = max(0.5 - vec3f(dot(a, a), dot(b, b), dot(c, c)), vec3f(0.0));
  let n = h * h * h * h * vec3f(
    dot(a, hash22(i)),
    dot(b, hash22(i + o)),
    dot(c, hash22(i + vec2f(1.0))),
  );
  return dot(n, vec3f(70.0, 70.0, 70.0));
}

fn ridge(uv: vec2f, time: f32) -> f32 {
  let domain = uv * vec2f(3.2, 2.4) + vec2f(time * 0.05, -time * 0.03);
  let n = snoise2(domain) * 0.5 + 0.5;
  let r = 1.0 - abs(n * 2.0 - 1.0);
  return pow(r, 5.5);
}

fn ridge2(uv: vec2f, time: f32) -> f32 {
  let domain = uv * vec2f(5.8, 3.6) + vec2f(-time * 0.04, time * 0.06);
  let n = snoise2(domain) * 0.5 + 0.5;
  let r = 1.0 - abs(n * 2.0 - 1.0);
  return pow(r, 7.0);
}

fn skyColor(uv: vec2f, time: f32) -> vec3f {
  let vertical = smoothstep(0.0, 1.0, uv.y);
  var color = mix(vec3f(0.0006, 0.0009, 0.002), vec3f(0.0025, 0.008, 0.0065), vertical);

  // Subtle nebula color wash: low-frequency, incommensurate drift, varies by region.
  let n1 = snoise2(uv * vec2f(2.1, 1.4) + vec2f(time * 0.013, -time * 0.009));
  let n2 = snoise2(uv * vec2f(3.4, 2.3) + vec2f(-time * 0.017, time * 0.011 + 4.7));
  let nebula = n1 * 0.6 + n2 * 0.4;
  color += vec3f(0.022, 0.008, 0.04) * max(nebula, 0.0) * smoothstep(0.15, 0.92, uv.y);
  color += vec3f(0.005, 0.028, 0.022) * max(-nebula, 0.0) * smoothstep(0.1, 0.95, uv.y);

  // Star layers: two densities for variety. Each star gets its own random
  // frequency, two twinkle octaves, a rare flare, a random hue, and its
  // own brightness so the sky never beats in a pattern.
  let starDomain = uv * vec2f(280.0, 160.0);
  let starGrid = floor(starDomain);
  let starLocal = fract(starDomain) - vec2f(0.5);
  let starShape = exp(-dot(starLocal, starLocal) * 92.0);
  let brightStarShape = exp(-dot(starLocal, starLocal) * 48.0);
  let cellRand = hash21(starGrid);
  let phase = hash21(starGrid + vec2f(7.3, 2.1)) * 6.2831;
  let freqSlow = 0.35 + hash21(starGrid + vec2f(3.7, 9.2)) * 1.45;
  let freqFast = 1.6 + hash21(starGrid + vec2f(5.1, 4.4)) * 3.4;
  let brightness = 0.45 + hash21(starGrid + vec2f(11.1, 13.3)) * 0.55;
  let star = step(0.99762, cellRand);
  let brightStar = step(0.99937, cellRand);

  let slow = sin(time * freqSlow + phase);
  let fast = sin(time * freqFast + phase * 1.7 + 2.1);
  var twinkle = 0.42 + 0.4 * slow + 0.16 * fast;
  let flarePhase = sin(time * (freqSlow * 0.43) + phase * 0.27);
  twinkle = twinkle + pow(max(0.0, flarePhase), 26.0) * 0.55;

  let hueShift = hash21(starGrid + vec2f(1.2, 8.8));
  let starColor = mix(vec3f(0.58, 0.88, 0.78), vec3f(1.0, 0.95, 0.82), hueShift);
  let brightStarColor = mix(vec3f(0.7, 0.95, 1.0), vec3f(1.0, 0.92, 0.7), hash21(starGrid + vec2f(9.9, 0.3)));

  color += starColor * star * starShape * clamp(twinkle, 0.0, 1.4) * brightness * 0.34 * smoothstep(0.25, 0.98, uv.y);
  color += brightStarColor * brightStar * brightStarShape * clamp(twinkle * 1.2, 0.0, 1.6) * 0.56 * smoothstep(0.2, 0.98, uv.y);

  return color;
}

fn linearToGamma(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return max(1.055 * pow(x, vec3f(${BLOOM_GAMMA.toFixed(4)})) - vec3f(0.055), vec3f(0.0));
}

fn acesFilmic(c: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c2 = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((c * (a * c + b)) / (c * (c2 * c + d) + e), vec3f(0.0), vec3f(1.0));
}

fn fakeShading(uv: vec2f, base: vec3f) -> vec3f {
  let tx = 1.0 / max(render.viewport, vec2f(1.0, 1.0));
  let lc = textureSample(historyTexture, postSampler, uv + vec2f(-tx.x, 0.0)).rgb;
  let rc = textureSample(historyTexture, postSampler, uv + vec2f(tx.x, 0.0)).rgb;
  let tc = textureSample(historyTexture, postSampler, uv + vec2f(0.0, tx.y)).rgb;
  let bc = textureSample(historyTexture, postSampler, uv + vec2f(0.0, -tx.y)).rgb;
  let dx = length(rc) - length(lc);
  let dy = length(tc) - length(bc);
  let n = normalize(vec3f(dx, dy, 0.35));
  let l = vec3f(0.0, 0.0, 1.0);
  let diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
  return mix(base, base * diffuse, render.shadingStrength);
}

fn accumulationEnergy(uv: vec2f) -> f32 {
  let inBounds = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
  let color = textureSample(historyTexture, postSampler, clamp(uv, vec2f(0.0), vec2f(1.0))).rgb;
  return length(color) * inBounds;
}

fn localAccumulationHalo(uv: vec2f) -> f32 {
  let px = 1.0 / max(render.viewport, vec2f(1.0, 1.0));
  let nearX = vec2f(px.x * 3.0, 0.0);
  let nearY = vec2f(0.0, px.y * 3.0);
  let nearD = vec2f(px.x * 2.2, px.y * 2.2);
  let farX = vec2f(px.x * 7.0, 0.0);
  let farY = vec2f(0.0, px.y * 7.0);
  let farD = vec2f(px.x * 5.0, px.y * 5.0);

  let center = accumulationEnergy(uv);
  let near = (
    accumulationEnergy(uv + nearX) +
    accumulationEnergy(uv - nearX) +
    accumulationEnergy(uv + nearY) +
    accumulationEnergy(uv - nearY) +
    accumulationEnergy(uv + nearD) +
    accumulationEnergy(uv - nearD) +
    accumulationEnergy(uv + vec2f(nearD.x, -nearD.y)) +
    accumulationEnergy(uv + vec2f(-nearD.x, nearD.y))
  ) * 0.125;
  let far = (
    accumulationEnergy(uv + farX) +
    accumulationEnergy(uv - farX) +
    accumulationEnergy(uv + farY) +
    accumulationEnergy(uv - farY) +
    accumulationEnergy(uv + farD) +
    accumulationEnergy(uv - farD) +
    accumulationEnergy(uv + vec2f(farD.x, -farD.y)) +
    accumulationEnergy(uv + vec2f(-farD.x, farD.y))
  ) * 0.125;
  let detail = abs(accumulationEnergy(uv + nearX) - accumulationEnergy(uv - nearX)) +
    abs(accumulationEnergy(uv + nearY) - accumulationEnergy(uv - nearY)) +
    abs(accumulationEnergy(uv + nearD) - accumulationEnergy(uv - nearD)) * 0.7;
  let denseCore = smoothstep(0.9, 1.8, center);
  let vectorMask = max(max(center * 0.52, near * 0.92 + far * 0.42), detail * 0.95);

  return smoothstep(0.045, 0.58, vectorMask) * (1.0 - denseCore * 0.28);
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let dye = textureSample(historyTexture, postSampler, input.uv).rgb;
  let base = fakeShading(input.uv, dye);

  let pressure = clamp(render.pressure, 0.0, 1.0);
  let bloomBoost = 1.0 + pressure * ${PRESSURE_BLOOM_BOOST.toFixed(2)};
  var bloom = textureSample(bloomTexture, postSampler, input.uv).rgb * render.bloomIntensity * bloomBoost;
  bloom = linearToGamma(bloom);

  let r1 = ridge(input.uv, render.time);
  let r2 = ridge2(input.uv * vec2f(1.0, 1.1) + vec2f(13.7, 7.1), render.time);
  let dyeMag = length(dye);
  let causticMask = smoothstep(0.18, 0.7, dyeMag);
  let causticCore = smoothstep(0.25, 0.7, dyeMag);
  let causticColor = vec3f(0.45, 0.95, 0.78) * r1 * 0.42 + vec3f(0.32, 0.78, 1.0) * r2 * 0.3;
  let caustic = causticColor * causticMask * causticCore;

  let particleHalo = localAccumulationHalo(input.uv);
  let particleCore = smoothstep(0.12, 0.72, dyeMag);
  let particleLight = (particleHalo * 0.78 + particleCore * 0.22) * render.pointerStrength * (1.0 + pressure * ${PRESSURE_LIGHT_BOOST.toFixed(2)});
  let causticLit = caustic * (1.0 + particleLight * 1.4);
  let bloomLit = bloom * (1.0 + particleLight * 1.1);

  let ringShimmer = 0.7 + 0.3 * sin(render.time * 6.0 + pressure * 12.0);
  let ringColor = mix(vec3f(0.55, 0.95, 1.0), vec3f(1.0, 0.86, 0.62), pressure);
  let chargeGlow = particleHalo * ringShimmer * pressure * render.pointerStrength * ringColor * 1.15;

  let pressureHalo = particleHalo * pressure * 0.65;
  let pressureGlow = pressureHalo * vec3f(0.42, 0.78, 1.0) * render.pointerStrength;

  let bloomPulse = 0.86 + 0.14 * smoothstep(0.0, 1.0, sin(render.time * 0.6) * 0.5 + 0.5);
  var color = skyColor(input.uv, render.time) + base + bloomLit * vec3f(0.72, 1.02, 0.86) * bloomPulse + causticLit + chargeGlow + pressureGlow;

  let noise = (hash21(input.uv * render.viewport + vec2f(render.time * 17.0, 0.0)) - 0.5) / 255.0;
  color += noise;

  let contrasted = pow(max(color, vec3f(0.0)), vec3f(1.14 - pressure * 0.06));
  let exposed = contrasted * (render.exposure + pressure * ${PRESSURE_EXPOSURE_BOOST.toFixed(2)});
  let toned = acesFilmic(exposed);
  return vec4f(linearToGamma(toned), 1.0);
}
`;

interface PointerState {
  x: number;
  y: number;
  strength: number;
  active: boolean;
  pressed: boolean;
  pressure: number;
}

export interface FlowFieldRenderer {
  destroy: () => void;
  setMode: (mode: FieldMode) => void;
}

export async function startFlowFieldRenderer(
  canvas: HTMLCanvasElement,
): Promise<FlowFieldRenderer> {
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
  const offscreenFormat: GPUTextureFormat = "rgba16float";
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
  const accumBuffer = device.createBuffer({
    label: "flow accumulation uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bloomPrefBuffer = device.createBuffer({
    label: "flow bloom prefilter uniforms",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const prefCurve = bloomCurve(BLOOM_THRESHOLD, BLOOM_SOFT_KNEE).curve;
  const bloomPrefUniforms = new Float32Array([
    prefCurve[0],
    prefCurve[1],
    prefCurve[2],
    BLOOM_THRESHOLD,
  ]);
  device.queue.writeBuffer(bloomPrefBuffer, 0, bloomPrefUniforms);
  const computeModule = device.createShaderModule({
    label: "flow compute shader",
    code: computeShader,
  });
  const renderModule = device.createShaderModule({
    label: "flow particle render shader",
    code: particleRenderShader,
  });
  const accumModule = device.createShaderModule({
    label: "flow accumulation shader",
    code: accumulationShader,
  });
  const postModule = device.createShaderModule({
    label: "flow post shader",
    code: postShader,
  });
  const bloomModule = device.createShaderModule({
    label: "flow bloom shader",
    code: bloomShader,
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
    offscreenFormat,
    "lineVertex",
    "lineFragment",
    "flow line pipeline",
  );
  const spritePipeline = createParticlePipeline(
    device,
    renderModule,
    offscreenFormat,
    "spriteVertex",
    "spriteFragment",
    "flow sprite pipeline",
  );
  const accumPipeline = device.createRenderPipeline({
    label: "flow accumulation pipeline",
    layout: "auto",
    vertex: {
      module: accumModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: accumModule,
      entryPoint: "fragmentMain",
      targets: [{ format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
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
  const bloomPrefilterPipeline = device.createRenderPipeline({
    label: "flow bloom prefilter pipeline",
    layout: "auto",
    vertex: {
      module: bloomModule,
      entryPoint: "bloomVertex",
    },
    fragment: {
      module: bloomModule,
      entryPoint: "bloomPrefilter",
      targets: [{ format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const bloomDownPipeline = device.createRenderPipeline({
    label: "flow bloom downsample pipeline",
    layout: "auto",
    vertex: {
      module: bloomModule,
      entryPoint: "bloomVertex",
    },
    fragment: {
      module: bloomModule,
      entryPoint: "bloomDownsample",
      targets: [{ format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const bloomUpPipeline = device.createRenderPipeline({
    label: "flow bloom upsample pipeline",
    layout: "auto",
    vertex: {
      module: bloomModule,
      entryPoint: "bloomVertex",
    },
    fragment: {
      module: bloomModule,
      entryPoint: "bloomUpsample",
      targets: [{ format: offscreenFormat }],
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

  const linearSampler = device.createSampler({
    label: "flow post sampler",
    magFilter: "linear",
    minFilter: "linear",
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer: PointerState = {
    x: 0,
    y: 0,
    strength: 0,
    active: false,
    pressed: false,
    pressure: 0,
  };
  const simUniforms = new Float32Array(UNIFORM_FLOATS);
  const renderUniforms = new Float32Array(UNIFORM_FLOATS);
  const accumUniforms = new Float32Array(UNIFORM_FLOATS);
  const targetWeights = [1, 0, 0, 0, 0];
  const currentWeights = [1, 0, 0, 0, 0];
  const abortController = new AbortController();
  let sceneTexture: GPUTexture | null = null;
  let historyA: GPUTexture | null = null;
  let historyB: GPUTexture | null = null;
  let historyViewA: GPUTextureView | null = null;
  let historyViewB: GPUTextureView | null = null;
  let bloomDownTextures: GPUTexture[] = [];
  let bloomDownViews: GPUTextureView[] = [];
  let bloomUpTextures: GPUTexture[] = [];
  let bloomUpViews: GPUTextureView[] = [];
  let bloomDownBindGroups: GPUBindGroup[] = [];
  let bloomUpBindGroups: GPUBindGroup[] = [];
  let bloomReady = false;
  let sourceIndex = 0;
  let historyIndex = 0;
  let lastTime = 0;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.active = true;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerenter",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.active = true;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.active = true;
      pointer.pressed = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; the press still ramps via local listeners.
      }
    },
    { signal: abortController.signal },
  );
  const releasePointer = (): void => {
    pointer.pressed = false;
  };
  canvas.addEventListener("pointerup", releasePointer, { signal: abortController.signal });
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.active = false;
      pointer.pressed = false;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      pointer.active = false;
      pointer.pressed = false;
    },
    { signal: abortController.signal },
  );
  window.addEventListener(
    "blur",
    () => {
      pointer.active = false;
      pointer.pressed = false;
    },
    { signal: abortController.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        if (animationFrame !== 0) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
        pointer.active = false;
      } else {
        lastTime = 0;
        scheduleFrame();
      }
    },
    { signal: abortController.signal },
  );

  function refreshTargets(): void {
    if (!resizeCanvas(canvas) && sceneTexture && historyA && historyB) {
      return;
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    sceneTexture?.destroy();
    historyA?.destroy();
    historyB?.destroy();
    for (const tex of bloomDownTextures) {
      tex.destroy();
    }
    for (const tex of bloomUpTextures) {
      tex.destroy();
    }
    bloomDownTextures = [];
    bloomDownViews = [];
    bloomUpTextures = [];
    bloomUpViews = [];
    bloomDownBindGroups = [];
    bloomUpBindGroups = [];
    bloomReady = false;

    const size = { width: canvas.width, height: canvas.height };

    sceneTexture = device.createTexture({
      label: "flow scene texture",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    historyA = device.createTexture({
      label: "flow history A",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    historyB = device.createTexture({
      label: "flow history B",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    historyViewA = historyA.createView();
    historyViewB = historyB.createView();

    let bloomW = Math.max(1, Math.floor(canvas.width / 2));
    let bloomH = Math.max(1, Math.floor(canvas.height / 2));
    const bloomScale = Math.min(1, BLOOM_BASE_MAX / Math.max(bloomW, bloomH));
    bloomW = Math.max(1, Math.floor(bloomW * bloomScale));
    bloomH = Math.max(1, Math.floor(bloomH * bloomScale));

    for (let level = 0; level < BLOOM_LEVELS; level += 1) {
      const tex = device.createTexture({
        label: `flow bloom down ${level}`,
        size: { width: bloomW, height: bloomH },
        format: offscreenFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      bloomDownTextures.push(tex);
      bloomDownViews.push(tex.createView());
      if (level < BLOOM_LEVELS - 1) {
        const upTex = device.createTexture({
          label: `flow bloom up ${level}`,
          size: { width: bloomW, height: bloomH },
          format: offscreenFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        bloomUpTextures.push(upTex);
        bloomUpViews.push(upTex.createView());
      }
      bloomW = Math.max(1, Math.floor(bloomW / 2));
      bloomH = Math.max(1, Math.floor(bloomH / 2));
    }

    for (let level = 1; level < BLOOM_LEVELS; level += 1) {
      bloomDownBindGroups.push(
        device.createBindGroup({
          label: `flow bloom down bind ${level}`,
          layout: bloomDownPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: linearSampler },
            { binding: 1, resource: bloomDownViews[level - 1] },
          ],
        }),
      );
    }
    const lastDown = BLOOM_LEVELS - 1;
    for (let level = 0; level < BLOOM_LEVELS - 1; level += 1) {
      const hiView = level === lastDown - 1 ? bloomDownViews[lastDown] : bloomUpViews[level + 1];
      bloomUpBindGroups.push(
        device.createBindGroup({
          label: `flow bloom up bind ${level}`,
          layout: bloomUpPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: linearSampler },
            { binding: 1, resource: bloomDownViews[level] },
            { binding: 2, resource: hiView },
          ],
        }),
      );
    }
    bloomReady = true;

    const clearEncoder = device.createCommandEncoder({ label: "flow initial history clear" });
    const clearPass = clearEncoder.beginRenderPass({
      label: "flow initial history clear",
      colorAttachments: [
        {
          view: historyViewA,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
        {
          view: historyViewB,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    clearPass.end();
    device.queue.submit([clearEncoder.finish()]);
  }

  function frame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    refreshTargets();

    if (!sceneTexture || !historyA || !historyB || !historyViewA || !historyViewB) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const deltaTime = lastTime > 0 ? Math.min(seconds - lastTime, 0.066) : 1 / 60;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? 0.28 : 1;
    if (pointer.active) {
      pointer.strength = Math.min(1, pointer.strength + (pointer.pressed ? 0.5 : 0.4));
    } else {
      pointer.strength *= reducedMotion ? 0.86 : 0.94;
    }
    const chargeRate = (reducedMotion ? PRESSURE_CHARGE_RATE * 0.5 : PRESSURE_CHARGE_RATE);
    const releaseRate = (reducedMotion ? PRESSURE_RELEASE_RATE * 0.6 : PRESSURE_RELEASE_RATE);
    if (pointer.pressed && pointer.active) {
      pointer.pressure = Math.min(1, pointer.pressure + deltaTime * chargeRate);
    } else {
      pointer.pressure = Math.max(0, pointer.pressure - deltaTime * releaseRate);
    }
    lastTime = seconds;

    const lerpAlpha = 1 - Math.exp(-7.0 * deltaTime);
    for (let i = 0; i < 5; i += 1) {
      currentWeights[i] += (targetWeights[i] - currentWeights[i]) * lerpAlpha;
    }

    simUniforms.set([
      deltaTime,
      seconds,
      aspect,
      motion,
      pointer.x,
      pointer.y,
      currentWeights[0],
      currentWeights[1],
      currentWeights[2],
      currentWeights[3],
      currentWeights[4],
      0,
      pointer.pressure,
      0,
      0,
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
      BLOOM_INTENSITY,
      BLOOM_EXPOSURE,
      BLOOM_SHADING,
      pointer.pressure,
      0,
      0,
      0,
    ]);
    accumUniforms.set([
      TRAIL_DECAY,
      seconds,
      aspect,
      motion,
      canvas.width,
      canvas.height,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    device.queue.writeBuffer(simBuffer, 0, simUniforms);
    device.queue.writeBuffer(renderBuffer, 0, renderUniforms);
    device.queue.writeBuffer(accumBuffer, 0, accumUniforms);

    const targetIndex = 1 - sourceIndex;
    const historyRead = historyIndex;
    const historyWrite = 1 - historyIndex;
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
          view: sceneTexture.createView(),
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

    const accumReadView = historyRead === 0 ? historyViewA : historyViewB;
    const accumWriteTexture = historyWrite === 0 ? historyA : historyB;
    const accumWriteView = historyWrite === 0 ? historyViewA : historyViewB;

    if (accumReadView && accumWriteTexture && accumWriteView) {
      const accumBindGroup = device.createBindGroup({
        label: "flow accum pass bind group",
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: accumReadView },
          { binding: 2, resource: sceneTexture.createView() },
          { binding: 3, resource: { buffer: accumBuffer } },
        ],
      });
      const accumPass = encoder.beginRenderPass({
        label: "flow accumulation pass",
        colorAttachments: [
          {
            view: accumWriteTexture.createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store",
          },
        ],
      });
      accumPass.setPipeline(accumPipeline);
      accumPass.setBindGroup(0, accumBindGroup);
      accumPass.draw(3);
      accumPass.end();

      if (bloomReady && bloomDownViews.length === BLOOM_LEVELS && bloomUpViews.length === BLOOM_LEVELS - 1) {
        const prefilterBindGroup = device.createBindGroup({
          label: "flow bloom prefilter bind group",
          layout: bloomPrefilterPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: linearSampler },
            { binding: 1, resource: accumWriteView },
            { binding: 3, resource: { buffer: bloomPrefBuffer } },
          ],
        });
        const prefilterPass = encoder.beginRenderPass({
          label: "flow bloom prefilter pass",
          colorAttachments: [
            {
              view: bloomDownViews[0],
              loadOp: "clear",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              storeOp: "store",
            },
          ],
        });
        prefilterPass.setPipeline(bloomPrefilterPipeline);
        prefilterPass.setBindGroup(0, prefilterBindGroup);
        prefilterPass.draw(3);
        prefilterPass.end();

        for (let level = 1; level < BLOOM_LEVELS; level += 1) {
          const downPass = encoder.beginRenderPass({
            label: `flow bloom down pass ${level}`,
            colorAttachments: [
              {
                view: bloomDownViews[level],
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: "store",
              },
            ],
          });
          downPass.setPipeline(bloomDownPipeline);
          downPass.setBindGroup(0, bloomDownBindGroups[level - 1]);
          downPass.draw(3);
          downPass.end();
        }

        for (let level = BLOOM_LEVELS - 2; level >= 0; level -= 1) {
          const upPass = encoder.beginRenderPass({
            label: `flow bloom up pass ${level}`,
            colorAttachments: [
              {
                view: bloomUpViews[level],
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: "store",
              },
            ],
          });
          upPass.setPipeline(bloomUpPipeline);
          upPass.setBindGroup(0, bloomUpBindGroups[level]);
          upPass.draw(3);
          upPass.end();
        }
      }

      const bloomView = bloomReady ? bloomUpViews[0] : accumWriteView;
      const postBindGroup = device.createBindGroup({
        label: "flow post bind group",
        layout: postPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: accumWriteView },
          { binding: 2, resource: bloomView },
          { binding: 3, resource: { buffer: renderBuffer } },
        ],
      });

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
    }

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
    historyIndex = historyWrite;
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  const renderer: FlowFieldRenderer = {
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

      sceneTexture?.destroy();
      historyA?.destroy();
      historyB?.destroy();
      for (const tex of bloomDownTextures) {
        tex.destroy();
      }
      for (const tex of bloomUpTextures) {
        tex.destroy();
      }
      particleBuffers[0].destroy();
      particleBuffers[1].destroy();
      simBuffer.destroy();
      renderBuffer.destroy();
      accumBuffer.destroy();
      bloomPrefBuffer.destroy();
    },
    setMode: (mode: FieldMode) => {
      const nextActive = MODE_INDEX[mode] ?? 0;
      for (let i = 0; i < 5; i += 1) {
        targetWeights[i] = i === nextActive ? 1 : 0;
      }
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
      { binding: 0, resource: { buffer: source } },
      { binding: 1, resource: { buffer: target } },
      { binding: 2, resource: { buffer: uniforms } },
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
      { binding: 0, resource: { buffer: particles } },
      { binding: 1, resource: { buffer: uniforms } },
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

    particles[offset] = lerp(-0.92, 1.46, hash(seed));
    particles[offset + 1] = lerp(-1.12, 1.1, hash(seed * 2.31));
    particles[offset + 2] = lerp(0.04, 0.18, hash(seed * 3.73));
    particles[offset + 3] = lerp(-0.11, 0.12, hash(seed * 5.19));
    particles[offset + 4] = seed;
    particles[offset + 5] = depth;
    particles[offset + 6] = hash(seed * 11.7) * lerp(10, 20, depth);
    particles[offset + 7] = lerp(-1, 1, hash(seed * 13.3));
    particles[offset + 8] = 0;
    particles[offset + 9] = 0;
    particles[offset + 10] = 0;
    particles[offset + 11] = 0;
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
