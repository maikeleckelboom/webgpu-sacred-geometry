
const RING_RADIUS = 0.46;
const RING_CENTER_X = 0.60;
const RING_CENTER_Y = 0.05;
const VELOCITY_GAIN = 1.12;
const FIELD_EPS = 0.05;
const PRESSURE_SWIRL_BOOST = 0.65;

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
  per: vec2f,
  perStrength: f32,
  pressure: f32,
}

@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> targetParticles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(q) * 43758.5453);
}

fn snoise(p: vec2f) -> f32 {
  let K1 = 0.366025404;
  let K2 = 0.211324865;
  let i = floor(p + (p.x + p.y) * K1);
  let a = p - i + (i.x + i.y) * K2;
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

fn curlNoise2D(p: vec2f, time: f32) -> vec2f {
  let pT = p + vec2f(time * 0.08, -time * 0.06);
  let eps = 0.08;
  let n1 = snoise(pT + vec2f(0.0, eps));
  let n2 = snoise(pT - vec2f(0.0, eps));
  let n3 = snoise(pT + vec2f(eps, 0.0));
  let n4 = snoise(pT - vec2f(eps, 0.0));
  return vec2f((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}

// The ring wanders on a slow Lissajous path (incommensurate frequencies,
// so it never visibly repeats). The post shader mirrors this exactly.
fn ringCenter(time: f32) -> vec2f {
  let drift = vec2f(sin(time * 0.047) * 0.07, cos(time * 0.036) * 0.055);
  return vec2f(sim.aspect * RING_CENTER_X, RING_CENTER_Y) + drift;
}

fn vortex(p: vec2f, center: vec2f, strength: f32) -> vec2f {
  let d = p - center;
  let r2 = dot(d, d) + 0.02;
  return strength * vec2f(-d.y, d.x) / r2;
}

// The ink field lives in aspect-corrected space so the ring stays circular.
// A circular attractor makes particles hug the ring instead of the center,
// which keeps the interior of the ring as clean paper.
fn inkField(position: vec2f, time: f32) -> vec2f {
  let a = sim.aspect;
  let q = vec2f(position.x * a, position.y);
  let c = ringCenter(time);
  let d = q - c;
  let r = length(d) + 0.0001;
  let er = d / r;
  let et = vec2f(-er.y, er.x);

  let bandT = (r - RING_RADIUS) / 0.24;
  let band = exp(-bandT * bandT);
  let wide = 1.0 - smoothstep(0.15, 1.9, r);
  var f = et * (0.42 * band + 0.12 * wide);
  f += -er * (r - RING_RADIUS) * 0.12 * (1.0 - smoothstep(0.0, 1.35, abs(r - RING_RADIUS)));

  // Two wandering vortices orbit the ring on incommensurate paths and
  // keep shedding new structure into the feathers.
  let v1 = c + vec2f(cos(time * 0.11), sin(time * 0.083)) * RING_RADIUS * 1.7;
  let v2 = c + vec2f(cos(-time * 0.067 + 2.1), sin(-time * 0.091 + 1.3)) * RING_RADIUS * 2.4;
  f += vortex(q, v1, 0.55) * 0.05;
  f += vortex(q, v2, -0.45) * 0.05;

  // Horizontal curtains drifting in from the left, converging on the ring.
  let inflow = 1.0 - smoothstep(c.x - RING_RADIUS * 1.5, c.x - RING_RADIUS * 0.3, q.x);
  let sway = snoise(vec2f(q.y * 1.7 + time * 0.1, q.x * 0.42 - time * 0.055));
  f += vec2f(0.26 + sway * 0.05, (c.y - q.y) * 0.16 + sway * 0.09) * inflow;

  // Fine feathery turbulence, strongest around the ring band. The sampling
  // domain is itself warped by a slower curl field (domain warping), so the
  // structures fold and breathe instead of scrolling in place.
  let warp = curlNoise2D(q * 0.7 + vec2f(3.1, 5.2), time * 0.25) * 0.35;
  let qw = q + warp;
  let feather = 0.11 + band * 0.04;
  f += curlNoise2D(qw * 1.45, time * 0.85) * feather;
  f += curlNoise2D(qw * 3.4 + vec2f(7.3, -2.1), time * 0.6) * 0.045 * (1.0 - band * 0.6);

  // Calm the ring interior so the paper stays clean.
  let interior = 1.0 - smoothstep(RING_RADIUS * 0.35, RING_RADIUS * 0.9, r);
  f *= 1.0 - interior * 0.75;

  return vec2f(f.x / a, f.y);
}

fn fieldMetricsAt(p: vec2f, time: f32) -> vec4f {
  let eps = FIELD_EPS;
  let fxp = inkField(p + vec2f(eps, 0.0), time);
  let fxn = inkField(p - vec2f(eps, 0.0), time);
  let fyp = inkField(p + vec2f(0.0, eps), time);
  let fyn = inkField(p - vec2f(0.0, eps), time);
  let f = inkField(p, time);
  let speed = length(f);
  let curl = (fyp.x - fyn.x - fxp.y + fxn.y) / (2.0 * eps);
  let div = (fxp.x - fxn.x + fyp.y - fyn.y) / (2.0 * eps);
  let energy = length(fxp - fxn) + length(fyp - fyn);
  return vec4f(speed, curl, div, energy);
}

fn mouseField(p: vec2f) -> vec2f {
  if (sim.perStrength < 0.001) {
    return vec2f(0.0);
  }
  let d = sim.per - p;
  let r = length(d) + 0.001;
  let toward = d / r;
  let tangent = vec2f(-toward.y, toward.x);
  let radius = 0.38 + sim.pressure * 0.14;
  let falloff = (1.0 - smoothstep(0.02, radius, r)) * sim.perStrength;
  let core = 1.0 - smoothstep(0.0, 0.08, r);
  let charge = 1.0 + sim.pressure * PRESSURE_SWIRL_BOOST;
  return (tangent * falloff * 0.14 + toward * falloff * 0.03 - toward * core * sim.perStrength * 0.05) * charge;
}

fn spawn(seed: f32, epoch: f32) -> Particle {
  let h0 = hash11(seed + epoch * 1.37);
  let h1 = hash11(seed * 2.31 + epoch * 1.91);
  let h2 = hash11(seed * 3.73 + epoch * 2.17);
  let h3 = hash11(seed * 5.19 + epoch * 2.73);
  let h4 = hash11(seed * 7.41 + epoch * 3.11);
  let h5 = hash11(seed * 11.7 + epoch * 3.97);
  let h6 = hash11(seed * 13.3 + epoch * 5.23);

  var position = vec2f(mix(-1.08, 1.55, h0), mix(-1.15, 1.15, h1));

  // Keep spawns out of the ring interior.
  let a = sim.aspect;
  var q = vec2f(position.x * a, position.y);
  let c = ringCenter(sim.time);
  let d = q - c;
  let r = length(d);
  if (r < RING_RADIUS * 1.05) {
    let outward = normalize(d + vec2f(0.001, 0.002));
    q = c + outward * RING_RADIUS * (1.08 + h2 * 0.55);
    position = vec2f(q.x / a, q.y);
  }

  var particle: Particle;
  particle.position = position;
  particle.velocity = vec2f(mix(0.02, 0.14, h2), mix(-0.08, 0.08, h3));
  particle.seed = seed;
  particle.depth = h4;
  particle.age = h5 * mix(7.0, 14.0, h4);
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
  let lifetime = mix(7.0, 14.0, hash11(particle.seed * 3.91));
  let epoch = floor(sim.time * 0.052 + particle.seed * 0.013);

  if (
    particle.age > lifetime ||
    particle.position.x < -1.2 ||
    particle.position.x > 1.7 ||
    abs(particle.position.y) > 1.35
  ) {
    particle = spawn(particle.seed, epoch);
  }

  let deltaTime = min(sim.deltaTime, 0.033);
  let position = particle.position;
  let fieldVelocity = (inkField(position, sim.time) + mouseField(position)) * VELOCITY_GAIN;
  let response = 0.06 + particle.depth * 0.06;
  particle.velocity = mix(particle.velocity, fieldVelocity, response);
  particle.position = particle.position + particle.velocity * deltaTime * sim.motion * (0.55 + particle.depth * 0.45);
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
