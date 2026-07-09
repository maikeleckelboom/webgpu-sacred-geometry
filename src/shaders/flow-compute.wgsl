
const GOLDEN_ANGLE = 2.39996322972865332;
const FIELD_EPS = 0.045;
const PRESSURE_SWIRL_BOOST = 1.60;
const VELOCITY_GAIN = 1.35;

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
  modeReserved: f32,
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
  let charge = 1.0 + sim.pressure * PRESSURE_SWIRL_BOOST;
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

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) globalId: vec3u) {
  if (globalId.x >= arrayLength(&sourceParticles)) {
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
  let fieldVelocity = (fieldAt(position, sim.time) + mouseField(position)) * VELOCITY_GAIN;
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

