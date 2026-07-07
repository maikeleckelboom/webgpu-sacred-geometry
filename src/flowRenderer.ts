const PARTICLE_COUNT = 72000;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 12;
const UNIFORM_FLOATS = 14;
const BLOOM_UNIFORM_FLOATS = 8;
const BLOOM_LEVEL_COUNT = 5;
const BLOOM_PASS_COUNT = 1 + (BLOOM_LEVEL_COUNT - 1) + BLOOM_LEVEL_COUNT;
const TRAIL_DECAY = 0.946;

const FLOW_HDR_TUNING = {
  exposure: 1.33,
  bloomThreshold: 0.82,
  bloomKnee: 0.68,
  bloomStrength: 1.72,
  bloomSmallWeight: 1.16,
  bloomMediumWeight: 0.74,
  bloomLargeWeight: 0.1,
  bloomUpsampleWeight: 0.82,
  backgroundFloor: 0.012,
  subtleFieldLine: 0.135,
  normalThreadGain: 0.8,
  brightGlowGain: 3.7,
  particleEmissiveGain: 17.5,
  hotspotGain: 32.0,
} as const;

export type FieldMode = "flow" | "mandala" | "topo" | "arch" | "waves";

const MODE_INDEX: Record<FieldMode, number> = {
  flow: 0,
  mandala: 1,
  topo: 2,
  arch: 3,
  waves: 4,
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
  padding: f32,
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
  let falloff = (1.0 - smoothstep(0.02, 0.45, r)) * sim.pointerStrength;
  let core = 1.0 - smoothstep(0.0, 0.08, r);
  return tangent * falloff * 0.18 + toward * falloff * 0.04 - toward * core * sim.pointerStrength * 0.1;
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
  let fieldVelocity = fieldAt(position, sim.time) + mouseField(position);
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
const NORMAL_THREAD_GAIN = ${FLOW_HDR_TUNING.normalThreadGain};
const BRIGHT_GLOW_GAIN = ${FLOW_HDR_TUNING.brightGlowGain};
const PARTICLE_EMISSIVE_GAIN = ${FLOW_HDR_TUNING.particleEmissiveGain};
const HOTSPOT_GAIN = ${FLOW_HDR_TUNING.hotspotGain};

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
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) bodyColor: vec3f,
  @location(2) emissiveColor: vec3f,
  @location(3) bodyAlpha: f32,
  @location(4) emissiveAlpha: f32,
}

struct FragmentOut {
  @location(0) visible: vec4f,
  @location(1) emissive: vec4f,
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

fn readabilityBasin(position: vec2f) -> f32 {
  let left = 1.0 - smoothstep(-0.68, 0.14, position.x);
  let vertical = smoothstep(-1.08, -0.74, position.y) * (1.0 - smoothstep(0.72, 1.1, position.y));
  return mix(1.0, 0.74, left * vertical);
}

fn gravityWellEdge(position: vec2f, time: f32) -> f32 {
  let c1 = vec2f(0.24 + sin(time * 0.08) * 0.08, -0.04 + cos(time * 0.10) * 0.06);
  let c2 = vec2f(0.78 + cos(time * 0.12) * 0.06, 0.34 + sin(time * 0.09) * 0.05);
  let d1 = length(position - c1);
  let d2 = length(position - c2);
  let ring1 = 1.0 - smoothstep(0.0, 0.07, abs(d1 - 0.24));
  let ring2 = 1.0 - smoothstep(0.0, 0.06, abs(d2 - 0.2));
  let rightBias = smoothstep(-0.18, 0.58, position.x);
  return max(ring1 * 0.66, ring2 * 1.18) * rightBias;
}

fn heroEnergyBody(position: vec2f, time: f32) -> f32 {
  let c1 = vec2f(0.24 + sin(time * 0.08) * 0.08, -0.04 + cos(time * 0.10) * 0.06);
  let c2 = vec2f(0.78 + cos(time * 0.12) * 0.06, 0.34 + sin(time * 0.09) * 0.05);
  let d1 = position - c1;
  let d2 = position - c2;
  let shoulder1 = exp(-dot(d1, d1) * 7.2) * 0.24;
  let shoulder2 = exp(-dot(d2, d2) * 8.2) * 0.92;
  let ring2 = 1.0 - smoothstep(0.0, 0.12, abs(length(d2) - 0.24));
  let striation = 0.62 + 0.38 * smoothstep(0.0, 1.0, sin(position.y * 18.0 - time * 0.34) * 0.5 + 0.5);
  return (shoulder1 + shoulder2 + ring2 * 0.32) * smoothstep(-0.02, 0.68, position.x) * striation;
}

fn fieldColor(particle: Particle) -> vec3f {
  let curlT = clamp(particle.mCurl * 6.0, -1.0, 1.0);
  let hue = curlT * 0.5 + 0.5;
  let p3 = clamp(render.fieldGain, 0.0, 1.0);
  let cyan = mix(vec3f(0.12, 0.74, 1.0), vec3f(0.06, 0.86, 1.0), p3);
  let aqua = mix(vec3f(0.5, 0.94, 0.86), vec3f(0.48, 1.0, 0.82), p3);
  let green = mix(vec3f(0.24, 0.82, 0.54), vec3f(0.24, 1.0, 0.5), p3);
  let violet = mix(vec3f(0.34, 0.28, 0.82), vec3f(0.34, 0.2, 1.0), p3);
  let frost = mix(vec3f(0.82, 0.98, 0.95), vec3f(0.82, 1.0, 0.98), p3);
  var color = mix(cyan, violet, hue);
  color = mix(color, aqua, smoothstep(0.012, 0.12, particle.mSpeed) * 0.38);
  color = mix(color, green, smoothstep(0.012, 0.04, abs(particle.mDiv)) * 0.18);
  color = mix(color, frost, smoothstep(0.018, 0.04, abs(particle.mCurl)) * 0.18);
  let speedLift = smoothstep(0.006, 0.13, particle.mSpeed);
  color = color * (0.58 + speedLift * 0.42);
  return color;
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
  let pointerWake = (1.0 - smoothstep(0.035, 0.5, pointerDistance)) * render.pointerStrength;
  let trail = 0.018 + speed * 0.18 + particle.depth * 0.018 + pointerWake * 0.055;
  let head = particle.position;
  let tail = head - direction * trail;
  let center = mix(tail, head, corner.x);
  let curlHot = smoothstep(0.004, 0.028, abs(particle.mCurl));
  let energyHot = smoothstep(0.04, 0.26, particle.mEnergy);
  let speedHot = smoothstep(0.015, 0.13, speed);
  let widthPixels = 0.42 + speed * 4.2 + curlHot * 0.88 + pointerWake * 1.15;
  let position = center + normal * corner.y * widthPixels;
  let mask = sceneMask(particle.position);
  let basin = readabilityBasin(particle.position);
  let filamentSeed = step(0.968, hash11(particle.seed * 23.71));
  let glintSeed = step(0.984, hash11(particle.seed * 41.83));
  let hotspotSeed = step(0.9978, hash11(particle.seed * 67.11));
  let glintSlow = 0.26 + 0.74 * smoothstep(0.0, 1.0, sin(render.time * 0.55 + particle.seed * 0.14) * 0.5 + 0.5);
  let glintShimmer = glintSeed * smoothstep(0.0, 1.0, sin(render.time * 4.2 + particle.seed * 2.7 + particle.position.x * 4.1) * 0.5 + 0.5) * glintSlow;
  let edgeBand = gravityWellEdge(particle.position, render.time);
  let heroBody = heroEnergyBody(particle.position, render.time);
  let edgeFilamentSeed = step(0.46, hash11(particle.seed * 31.17));
  let edgeFilament = edgeBand * edgeFilamentSeed * max(curlHot, speedHot * 0.85);
  let edgeHotspot = hotspotSeed * edgeBand * max(curlHot, speedHot * 0.85);
  let brightFilament = max(filamentSeed * energyHot * max(curlHot, speedHot * 0.7), edgeFilament * 1.05);
  let headShimmer = 0.82 + 0.18 * smoothstep(0.0, 1.0, sin(render.time * 0.7 + particle.seed * 0.21) * 0.5 + 0.5);
  let baseColor = fieldColor(particle);
  let emissiveTint = mix(baseColor * 1.12, vec3f(0.86, 1.0, 0.96), edgeHotspot * 0.62 + brightFilament * 0.18);
  let bodyGain = NORMAL_THREAD_GAIN + speedHot * 0.26 + heroBody * 0.34 + brightFilament * BRIGHT_GLOW_GAIN * 0.24;
  let emissiveGain = brightFilament * PARTICLE_EMISSIVE_GAIN + glintShimmer * 5.4 + edgeHotspot * HOTSPOT_GAIN;

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.bodyColor = baseColor * bodyGain;
  out.emissiveColor = emissiveTint * emissiveGain;
  let bodyAlpha = 0.05 + speed * 0.44 + curlHot * 0.13 + energyHot * 0.1 + heroBody * 0.065 + brightFilament * 0.064 + pointerWake * 0.11;
  let emissiveAlpha = brightFilament * 0.125 + glintShimmer * 0.17 + edgeHotspot * 0.34 + pointerWake * 0.026;
  out.bodyAlpha = render.opacity * mask * basin * lifeFade(particle) * headShimmer * bodyAlpha;
  out.emissiveAlpha = render.opacity * mask * basin * lifeFade(particle) * emissiveAlpha;
  return out;
}

@fragment
fn lineFragment(input: VertexOut) -> FragmentOut {
  let side = pow(clamp(1.0 - abs(input.local.y), 0.0, 1.0), 1.08);
  let headFade = smoothstep(0.0, 0.16, input.local.x);
  let tailFade = 1.0 - smoothstep(0.82, 1.0, input.local.x) * 0.24;
  let bodyAlpha = input.bodyAlpha * side * headFade * tailFade;
  let emissiveShape = pow(side, 2.4) * smoothstep(0.12, 0.88, input.local.x);

  var out: FragmentOut;
  out.visible = vec4f(input.bodyColor, bodyAlpha);
  out.emissive = vec4f(input.emissiveColor, input.emissiveAlpha * emissiveShape);
  return out;
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
  let marker = smoothstep(0.95, 0.999, hash11(particle.seed * 17.17));
  let node = step(0.99945, hash11(particle.seed * 29.17));
  let glint = step(0.982, hash11(particle.seed * 41.83));
  let hotspotSeed = step(0.9972, hash11(particle.seed * 83.19));
  let toPointer = particle.position - render.pointer;
  let pointerDistance = length(vec2f(toPointer.x * render.aspect, toPointer.y));
  let pointerWake = (1.0 - smoothstep(0.02, 0.43, pointerDistance)) * render.pointerStrength;
  let glintSlow = 0.25 + 0.75 * smoothstep(0.0, 1.0, sin(render.time * 0.5 + particle.seed * 0.16) * 0.5 + 0.5);
  let glintShimmer = glint * smoothstep(0.0, 1.0, sin(render.time * 4.6 + particle.seed * 3.1 + particle.position.x * 2.4) * 0.5 + 0.5) * glintSlow;
  let nodeSlow = 0.3 + 0.7 * smoothstep(0.0, 1.0, sin(render.time * 0.42 + particle.seed * 0.19) * 0.5 + 0.5);
  let nodeTwinkle = node * (0.55 + 0.45 * sin(render.time * 2.8 + particle.seed * 5.7)) * nodeSlow;
  let pulse = 0.9 + sin(render.time * 1.8 + particle.seed * 0.031) * 0.1;
  let shimmerPulse = pulse * (0.85 + 0.15 * smoothstep(0.0, 1.0, sin(render.time * 0.65 + particle.seed * 0.11) * 0.5 + 0.5));
  let curlHot = smoothstep(0.006, 0.032, abs(particle.mCurl));
  let speedHot = smoothstep(0.016, 0.13, particle.mSpeed);
  let edgeBand = gravityWellEdge(particle.position, render.time);
  let heroBody = heroEnergyBody(particle.position, render.time);
  let edgeSpark = edgeBand * step(0.978, hash11(particle.seed * 53.97)) * max(curlHot, speedHot * 0.85);
  let edgeHotspot = hotspotSeed * edgeBand * max(curlHot, speedHot * 0.85);
  let radiusPixels = (0.52 + marker * (1.3 + particle.mSpeed * 1.7 + curlHot * 1.24) + node * 0.85 + glint * 2.7 + edgeSpark * 2.3 + edgeHotspot * 3.15 + heroBody * 0.48 + pointerWake * 2.6) * shimmerPulse;
  let position = particle.position + corner * ndcPixel * radiusPixels;
  let mask = sceneMask(particle.position);
  let basin = readabilityBasin(particle.position);
  let baseColor = fieldColor(particle);
  let directSpark = max(max(glintShimmer, nodeTwinkle * 0.7), edgeSpark * 0.82);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.bodyColor = baseColor * (NORMAL_THREAD_GAIN * 0.9 + marker * 0.3 + directSpark * 0.38 + heroBody * 0.16);
  out.emissiveColor = mix(baseColor * 1.18, vec3f(0.9, 1.0, 0.98), edgeHotspot * 0.78 + directSpark * 0.24)
    * (directSpark * PARTICLE_EMISSIVE_GAIN + edgeHotspot * HOTSPOT_GAIN);
  out.bodyAlpha = render.opacity * mask * basin * lifeFade(particle) * (marker * (0.09 + particle.mSpeed * 0.25 + curlHot * 0.072) + heroBody * 0.024 + nodeTwinkle * 0.068 + pointerWake * 0.11);
  out.emissiveAlpha = render.opacity * mask * basin * lifeFade(particle) * (glintShimmer * 0.34 + nodeTwinkle * 0.14 + edgeHotspot * 0.58 + pointerWake * 0.035);
  return out;
}

@fragment
fn spriteFragment(input: VertexOut) -> FragmentOut {
  let distance = length(input.local);
  let disc = smoothstep(1.0, 0.16, distance);
  let core = smoothstep(0.48, 0.0, distance);
  let bodyAlpha = input.bodyAlpha * (disc * 0.68 + core * 0.42);
  let emissiveAlpha = input.emissiveAlpha * (pow(disc, 1.7) * 0.52 + core * 0.86);

  var out: FragmentOut;
  out.visible = vec4f(input.bodyColor * (0.9 + core * 0.42), bodyAlpha);
  out.emissive = vec4f(input.emissiveColor * (0.85 + core * 0.55), emissiveAlpha);
  return out;
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
@group(0) @binding(3) var emissiveHistoryTexture: texture_2d<f32>;
@group(0) @binding(4) var emissiveSceneTexture: texture_2d<f32>;
@group(0) @binding(5) var<uniform> accum: Accum;

struct FragmentOut {
  @location(0) visible: vec4f,
  @location(1) emissive: vec4f,
}

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

fn softCap(color: vec3f) -> vec3f {
  return color / (vec3f(1.0) + color * 0.2);
}

@fragment
fn fragmentMain(input: VertexOut) -> FragmentOut {
  let prev = textureSample(historyTexture, accumSampler, input.uv).rgb;
  let scene = textureSample(sceneTexture, accumSampler, input.uv).rgb;
  let prevEmissive = textureSample(emissiveHistoryTexture, accumSampler, input.uv).rgb;
  let sceneEmissive = textureSample(emissiveSceneTexture, accumSampler, input.uv).rgb;
  let decayed = prev * accum.decay;
  let emissiveDecay = min(accum.decay, 0.948);

  var out: FragmentOut;
  out.visible = vec4f(softCap(decayed + scene), 1.0);
  out.emissive = vec4f(softCap(prevEmissive * emissiveDecay + sceneEmissive), 1.0);
  return out;
}
`;

const bloomShader = /* wgsl */ `
struct Bloom {
  sourceSize: vec2f,
  threshold: f32,
  knee: f32,
  levelWeight: f32,
  upsampleWeight: f32,
  padding: vec2f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var bloomSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var widerTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> bloom: Bloom;

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

fn sourceTent(uv: vec2f, texel: vec2f) -> vec3f {
  var color = textureSample(sourceTexture, bloomSampler, uv).rgb * 0.28;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(1.0, 0.0)).rgb * 0.12;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(-1.0, 0.0)).rgb * 0.12;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(0.0, 1.0)).rgb * 0.12;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(0.0, -1.0)).rgb * 0.12;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(1.0, 1.0)).rgb * 0.06;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(-1.0, 1.0)).rgb * 0.06;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(1.0, -1.0)).rgb * 0.06;
  color += textureSample(sourceTexture, bloomSampler, uv + texel * vec2f(-1.0, -1.0)).rgb * 0.06;
  return color;
}

fn widerTent(uv: vec2f, texel: vec2f) -> vec3f {
  var color = textureSample(widerTexture, bloomSampler, uv).rgb * 0.34;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(1.0, 0.0)).rgb * 0.12;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(-1.0, 0.0)).rgb * 0.12;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(0.0, 1.0)).rgb * 0.12;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(0.0, -1.0)).rgb * 0.12;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(1.0, 1.0)).rgb * 0.045;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(-1.0, 1.0)).rgb * 0.045;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(1.0, -1.0)).rgb * 0.045;
  color += textureSample(widerTexture, bloomSampler, uv + texel * vec2f(-1.0, -1.0)).rgb * 0.045;
  return color;
}

fn softThreshold(color: vec3f) -> vec3f {
  let brightness = max(max(color.r, color.g), color.b);
  let knee = max(bloom.knee, 0.0001);
  var soft = brightness - bloom.threshold + knee;
  soft = clamp(soft, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.0001);
  let contribution = max(soft, brightness - bloom.threshold);
  return color * (contribution / max(brightness, 0.0001));
}

@fragment
fn extractFragment(input: VertexOut) -> @location(0) vec4f {
  let texel = 1.0 / max(bloom.sourceSize, vec2f(1.0));
  let color = sourceTent(input.uv, texel);
  return vec4f(softThreshold(color), 1.0);
}

@fragment
fn downsampleFragment(input: VertexOut) -> @location(0) vec4f {
  let texel = 1.0 / max(bloom.sourceSize, vec2f(1.0));
  return vec4f(sourceTent(input.uv, texel), 1.0);
}

@fragment
fn copyFragment(input: VertexOut) -> @location(0) vec4f {
  let texel = 1.0 / max(bloom.sourceSize, vec2f(1.0));
  return vec4f(sourceTent(input.uv, texel) * bloom.levelWeight, 1.0);
}

@fragment
fn upsampleFragment(input: VertexOut) -> @location(0) vec4f {
  let texel = 1.0 / max(bloom.sourceSize, vec2f(1.0));
  let base = sourceTent(input.uv, texel) * bloom.levelWeight;
  let wider = widerTent(input.uv, texel * 2.0) * bloom.upsampleWeight;
  return vec4f(base + wider, 1.0);
}
`;

const postShader = /* wgsl */ `
const EXPOSURE = ${FLOW_HDR_TUNING.exposure};
const BLOOM_STRENGTH = ${FLOW_HDR_TUNING.bloomStrength};
const BACKGROUND_FLOOR = ${FLOW_HDR_TUNING.backgroundFloor};
const SUBTLE_FIELD_LINE = ${FLOW_HDR_TUNING.subtleFieldLine};

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
@group(0) @binding(1) var visibleTexture: texture_2d<f32>;
@group(0) @binding(2) var emissiveTexture: texture_2d<f32>;
@group(0) @binding(3) var bloomTexture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> render: Render;

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
  let p3 = clamp(render.fieldGain, 0.0, 1.0);
  var color = mix(
    vec3f(BACKGROUND_FLOOR * 0.55, BACKGROUND_FLOOR * 0.72, BACKGROUND_FLOOR),
    vec3f(0.006, 0.016, 0.022),
    vertical,
  );
  let outerHaze = mix(vec3f(0.012, 0.004, 0.022), vec3f(0.018, 0.006, 0.04), p3);
  color += outerHaze * smoothstep(0.5, 0.98, uv.x) * smoothstep(0.08, 0.76, uv.y);

  let starGrid = floor(uv * vec2f(180.0, 96.0));
  let star = step(0.9982, hash21(starGrid));
  let twinkle = 0.5 + 0.5 * smoothstep(0.0, 1.0, sin(time * 0.8 + hash21(starGrid + vec2f(11.0, 11.0)) * 6.2831) * 0.5 + 0.5);
  let microTwinkle = 0.7 + 0.3 * sin(time * 2.4 + hash21(starGrid + vec2f(3.0, 7.0)) * 12.0);
  let starColor = mix(vec3f(0.42, 0.8, 1.0), vec3f(0.38, 0.92, 1.0), p3);
  color += starColor * star * twinkle * microTwinkle * SUBTLE_FIELD_LINE * smoothstep(0.28, 0.98, uv.y);

  return color;
}

fn readabilityBasin(uv: vec2f) -> f32 {
  let left = 1.0 - smoothstep(0.14, 0.5, uv.x);
  let middle = smoothstep(0.06, 0.18, uv.y) * (1.0 - smoothstep(0.86, 1.0, uv.y));
  return left * middle;
}

fn heroEventBody(uv: vec2f, time: f32, aspect: f32) -> f32 {
  let position = uv * 2.0 - vec2f(1.0);
  let c2 = vec2f(0.78 + cos(time * 0.12) * 0.06, 0.34 + sin(time * 0.09) * 0.05);
  let d = vec2f((position.x - c2.x) * aspect, position.y - c2.y);
  let radius = length(d);
  let shoulder = exp(-dot(d, d) * 3.8);
  let core = exp(-dot(d, d) * 17.0);
  let edge = 1.0 - smoothstep(0.0, 0.09, abs(radius - 0.24));
  let striation = 0.58 + 0.42 * smoothstep(0.0, 1.0, sin(position.y * 22.0 - time * 0.38) * 0.5 + 0.5);
  return (shoulder * 0.52 + core * 0.22 + edge * 0.38) * smoothstep(0.54, 0.92, uv.x) * striation;
}

fn toneMapFilmic(color: vec3f) -> vec3f {
  let exposed = max(color * EXPOSURE, vec3f(0.0));
  let exponential = vec3f(1.0) - exp(-exposed);
  let shoulder = exposed / (exposed + vec3f(1.0));
  let sdrMapped = mix(exponential, shoulder, 0.24);
  let hdrMapped = exposed / (vec3f(1.0) + exposed * 0.42);
  let mapped = mix(sdrMapped, hdrMapped, clamp(render.padding.x, 0.0, 1.0));
  let luma = dot(mapped, vec3f(0.2126, 0.7152, 0.0722));
  let highlight = smoothstep(0.72, 1.08 + render.padding.x * 0.42, luma);
  return mix(mapped, vec3f(luma), highlight * 0.08);
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let scene = textureSample(visibleTexture, postSampler, input.uv).rgb;
  let emissive = textureSample(emissiveTexture, postSampler, input.uv).rgb;
  let bloom = textureSample(bloomTexture, postSampler, input.uv).rgb * BLOOM_STRENGTH;

  let r1 = ridge(input.uv, render.time);
  let r2 = ridge2(input.uv * vec2f(1.0, 1.1) + vec2f(13.7, 7.1), render.time);
  let sceneMag = length(scene + emissive * 0.35);
  let heroBody = heroEventBody(input.uv, render.time, render.aspect);
  let causticMask = max(smoothstep(0.055, 0.48, sceneMag), heroBody * 0.58);
  let causticColor = vec3f(0.18, 0.72, 0.88) * r1 * 0.074 + vec3f(0.18, 0.34, 0.78) * r2 * 0.048;
  let caustic = causticColor * causticMask;

  let pointerNdc = input.uv * 2.0 - vec2f(1.0, 1.0);
  let pointerOffset = pointerNdc - render.pointer;
  let pointerDistance = length(vec2f(pointerOffset.x * render.aspect, pointerOffset.y));
  let pointerHalo = exp(-pointerDistance * pointerDistance * 7.5);
  let pointerCore = exp(-pointerDistance * pointerDistance * 55.0);
  let pointerLight = (pointerHalo * 0.78 + pointerCore * 0.22) * render.pointerStrength;
  let bloomLit = bloom * (1.0 + pointerLight * 0.38);

  let bloomPulse = 0.86 + 0.14 * smoothstep(0.0, 1.0, sin(render.time * 0.6) * 0.5 + 0.5);
  let p3 = clamp(render.fieldGain, 0.0, 1.0);
  let bloomTint = mix(vec3f(0.82, 1.0, 0.98), vec3f(0.74, 1.0, 0.92), p3);
  let sceneLight = scene * 1.18 + emissive * 0.98 + bloomLit * bloomTint * bloomPulse;
  let pointerColor = (vec3f(0.24, 0.72, 0.88) * pointerHalo + vec3f(0.7, 0.98, 0.92) * pointerCore) * render.pointerStrength * 0.12;
  let fieldVeilWeight = (0.26 + 0.74 * smoothstep(0.16, 0.94, input.uv.x)) * smoothstep(0.04, 0.82, input.uv.y);
  let fieldVeil = (vec3f(0.08, 0.44, 0.56) * r1 * 0.046 + vec3f(0.1, 0.22, 0.62) * r2 * 0.032) * SUBTLE_FIELD_LINE * fieldVeilWeight;
  let heroHalo = vec3f(0.08, 0.42, 0.52) * heroBody * (0.06 + r1 * 0.07);
  var color = skyColor(input.uv, render.time) + sceneLight + caustic + fieldVeil + heroHalo + pointerColor;

  let basin = readabilityBasin(input.uv);
  color = mix(color, color * 0.74 + vec3f(0.005, 0.008, 0.012), basin * 0.3);

  let toneMapped = toneMapFilmic(color);
  return vec4f(toneMapped, 1.0);
}
`;

interface PointerState {
  x: number;
  y: number;
  strength: number;
  active: boolean;
}

interface BloomLevel {
  texture: GPUTexture;
  view: GPUTextureView;
  width: number;
  height: number;
}

interface BloomTargetSet {
  down: BloomLevel[];
  up: BloomLevel[];
}

interface CanvasOutputConfig {
  colorSpace: PredefinedColorSpace;
  extended: boolean;
  format: GPUTextureFormat;
  label: "srgb" | "display-p3" | "display-p3-extended";
  toneMapping?: { mode: "extended" };
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
  const offscreenFormat: GPUTextureFormat = "rgba16float";
  device.addEventListener("uncapturederror", (event) => {
    console.error(`Flow WebGPU error: ${event.error.message}`);
  });
  const supportsDisplayP3 = window.matchMedia("(color-gamut: p3)").matches;
  const supportsHighDynamicRange = window.matchMedia("(dynamic-range: high)").matches;
  const canvasOutput = await chooseCanvasOutput(
    device,
    gpuContext,
    navigator.gpu.getPreferredCanvasFormat(),
    supportsDisplayP3,
    supportsHighDynamicRange,
  );
  const format = canvasOutput.format;
  const displayP3Flag = canvasOutput.colorSpace === "display-p3" ? 1 : 0;
  const extendedOutputFlag = canvasOutput.extended ? 1 : 0;
  canvas.dataset.colorSpace = canvasOutput.label;
  canvas.dataset.canvasFormat = canvasOutput.format;
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
  const bloomBuffers = Array.from({ length: BLOOM_PASS_COUNT }, (_, index) =>
    device.createBuffer({
      label: `flow bloom uniforms ${index}`,
      size: BLOOM_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  );
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
  const bloomModule = device.createShaderModule({
    label: "flow bloom shader",
    code: bloomShader,
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
      targets: [{ format: offscreenFormat }, { format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const bloomExtractPipeline = createFullscreenPipeline(
    device,
    bloomModule,
    offscreenFormat,
    "extractFragment",
    "flow bloom extract pipeline",
  );
  const bloomDownsamplePipeline = createFullscreenPipeline(
    device,
    bloomModule,
    offscreenFormat,
    "downsampleFragment",
    "flow bloom downsample pipeline",
  );
  const bloomCopyPipeline = createFullscreenPipeline(
    device,
    bloomModule,
    offscreenFormat,
    "copyFragment",
    "flow bloom copy pipeline",
  );
  const bloomUpsamplePipeline = createFullscreenPipeline(
    device,
    bloomModule,
    offscreenFormat,
    "upsampleFragment",
    "flow bloom upsample pipeline",
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
  };
  const simUniforms = new Float32Array(UNIFORM_FLOATS);
  const renderUniforms = new Float32Array(UNIFORM_FLOATS);
  const accumUniforms = new Float32Array(UNIFORM_FLOATS);
  const bloomUniforms = new Float32Array(BLOOM_UNIFORM_FLOATS);
  const targetWeights = [1, 0, 0, 0, 0];
  const currentWeights = [1, 0, 0, 0, 0];
  const abortController = new AbortController();
  let sceneTexture: GPUTexture | null = null;
  let emissiveTexture: GPUTexture | null = null;
  let historyA: GPUTexture | null = null;
  let historyB: GPUTexture | null = null;
  let emissiveHistoryA: GPUTexture | null = null;
  let emissiveHistoryB: GPUTexture | null = null;
  let historyViewA: GPUTextureView | null = null;
  let historyViewB: GPUTextureView | null = null;
  let emissiveHistoryViewA: GPUTextureView | null = null;
  let emissiveHistoryViewB: GPUTextureView | null = null;
  let bloomTargets: BloomTargetSet | null = null;
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
    "pointerleave",
    () => {
      pointer.active = false;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      pointer.active = false;
    },
    { signal: abortController.signal },
  );
  window.addEventListener(
    "blur",
    () => {
      pointer.active = false;
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
    if (
      !resizeCanvas(canvas) &&
      sceneTexture &&
      emissiveTexture &&
      historyA &&
      historyB &&
      emissiveHistoryA &&
      emissiveHistoryB &&
      bloomTargets
    ) {
      return;
    }

    gpuContext.configure(createCanvasConfiguration(device, canvasOutput));

    sceneTexture?.destroy();
    emissiveTexture?.destroy();
    historyA?.destroy();
    historyB?.destroy();
    emissiveHistoryA?.destroy();
    emissiveHistoryB?.destroy();
    destroyBloomTargets(bloomTargets);
    bloomTargets = null;

    const size = { width: canvas.width, height: canvas.height };

    sceneTexture = device.createTexture({
      label: "flow scene texture",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    emissiveTexture = device.createTexture({
      label: "flow emissive scene texture",
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
    emissiveHistoryA = device.createTexture({
      label: "flow emissive history A",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    emissiveHistoryB = device.createTexture({
      label: "flow emissive history B",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const visibleViewA = historyA.createView();
    const visibleViewB = historyB.createView();
    const emissiveViewA = emissiveHistoryA.createView();
    const emissiveViewB = emissiveHistoryB.createView();
    historyViewA = visibleViewA;
    historyViewB = visibleViewB;
    emissiveHistoryViewA = emissiveViewA;
    emissiveHistoryViewB = emissiveViewB;
    bloomTargets = createBloomTargets(device, offscreenFormat, size);

    const clearEncoder = device.createCommandEncoder({ label: "flow initial history clear" });
    const clearPass = clearEncoder.beginRenderPass({
      label: "flow initial history clear",
      colorAttachments: [
        {
          view: visibleViewA,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
        {
          view: visibleViewB,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
        {
          view: emissiveViewA,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
        {
          view: emissiveViewB,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    clearPass.end();
    device.queue.submit([clearEncoder.finish()]);
  }

  function writeBloomUniform(
    passIndex: number,
    source: { width: number; height: number },
    levelWeight: number,
    upsampleWeight: number,
  ): GPUBuffer {
    bloomUniforms.set([
      source.width,
      source.height,
      FLOW_HDR_TUNING.bloomThreshold,
      FLOW_HDR_TUNING.bloomKnee,
      levelWeight,
      upsampleWeight,
      0,
      0,
    ]);
    device.queue.writeBuffer(bloomBuffers[passIndex], 0, bloomUniforms);
    return bloomBuffers[passIndex];
  }

  function encodeBloomPasses(
    encoder: GPUCommandEncoder,
    emissiveSourceView: GPUTextureView,
    targets: BloomTargetSet,
  ): GPUTextureView {
    let passIndex = 0;
    const extractUniform = writeBloomUniform(
      passIndex,
      { width: canvas.width, height: canvas.height },
      1,
      0,
    );
    const extractBindGroup = device.createBindGroup({
      label: "flow bloom extract bind group",
      layout: bloomExtractPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: linearSampler },
        { binding: 1, resource: emissiveSourceView },
        { binding: 3, resource: { buffer: extractUniform } },
      ],
    });
    const extractPass = encoder.beginRenderPass({
      label: "flow bloom extract pass",
      colorAttachments: [
        {
          view: targets.down[0].view,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    extractPass.setPipeline(bloomExtractPipeline);
    extractPass.setBindGroup(0, extractBindGroup);
    extractPass.draw(3);
    extractPass.end();
    passIndex += 1;

    for (let level = 1; level < BLOOM_LEVEL_COUNT; level += 1) {
      const source = targets.down[level - 1];
      const uniform = writeBloomUniform(passIndex, source, 1, 0);
      const downsampleBindGroup = device.createBindGroup({
        label: `flow bloom downsample bind group ${level}`,
        layout: bloomDownsamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: source.view },
          { binding: 3, resource: { buffer: uniform } },
        ],
      });
      const downsamplePass = encoder.beginRenderPass({
        label: `flow bloom downsample pass ${level}`,
        colorAttachments: [
          {
            view: targets.down[level].view,
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store",
          },
        ],
      });
      downsamplePass.setPipeline(bloomDownsamplePipeline);
      downsamplePass.setBindGroup(0, downsampleBindGroup);
      downsamplePass.draw(3);
      downsamplePass.end();
      passIndex += 1;
    }

    const lastLevel = BLOOM_LEVEL_COUNT - 1;
    const largestUniform = writeBloomUniform(
      passIndex,
      targets.down[lastLevel],
      bloomLevelWeight(lastLevel),
      0,
    );
    const largestBindGroup = device.createBindGroup({
      label: "flow bloom largest copy bind group",
      layout: bloomCopyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: linearSampler },
        { binding: 1, resource: targets.down[lastLevel].view },
        { binding: 3, resource: { buffer: largestUniform } },
      ],
    });
    const largestPass = encoder.beginRenderPass({
      label: "flow bloom largest copy pass",
      colorAttachments: [
        {
          view: targets.up[lastLevel].view,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    largestPass.setPipeline(bloomCopyPipeline);
    largestPass.setBindGroup(0, largestBindGroup);
    largestPass.draw(3);
    largestPass.end();
    passIndex += 1;

    for (let level = lastLevel - 1; level >= 0; level -= 1) {
      const source = targets.down[level];
      const uniform = writeBloomUniform(
        passIndex,
        source,
        bloomLevelWeight(level),
        FLOW_HDR_TUNING.bloomUpsampleWeight,
      );
      const upsampleBindGroup = device.createBindGroup({
        label: `flow bloom upsample bind group ${level}`,
        layout: bloomUpsamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: source.view },
          { binding: 2, resource: targets.up[level + 1].view },
          { binding: 3, resource: { buffer: uniform } },
        ],
      });
      const upsamplePass = encoder.beginRenderPass({
        label: `flow bloom upsample pass ${level}`,
        colorAttachments: [
          {
            view: targets.up[level].view,
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store",
          },
        ],
      });
      upsamplePass.setPipeline(bloomUpsamplePipeline);
      upsamplePass.setBindGroup(0, upsampleBindGroup);
      upsamplePass.draw(3);
      upsamplePass.end();
      passIndex += 1;
    }

    return targets.up[0].view;
  }

  function frame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    refreshTargets();

    const activeBloomTargets = bloomTargets;

    if (
      !sceneTexture ||
      !emissiveTexture ||
      !historyA ||
      !historyB ||
      !emissiveHistoryA ||
      !emissiveHistoryB ||
      !historyViewA ||
      !historyViewB ||
      !emissiveHistoryViewA ||
      !emissiveHistoryViewB ||
      !activeBloomTargets
    ) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const deltaTime = lastTime > 0 ? Math.min(seconds - lastTime, 0.066) : 1 / 60;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? 0.28 : 1;
    if (pointer.active) {
      pointer.strength = Math.min(1, pointer.strength + 0.4);
    } else {
      pointer.strength *= reducedMotion ? 0.86 : 0.94;
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
      displayP3Flag,
      extendedOutputFlag,
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
        {
          view: emissiveTexture.createView(),
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
    const emissiveAccumReadView = historyRead === 0 ? emissiveHistoryViewA : emissiveHistoryViewB;
    const emissiveAccumWriteTexture = historyWrite === 0 ? emissiveHistoryA : emissiveHistoryB;
    const emissiveAccumWriteView =
      historyWrite === 0 ? emissiveHistoryViewA : emissiveHistoryViewB;

    const accumBindGroup = device.createBindGroup({
      label: "flow accum pass bind group",
      layout: accumPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: linearSampler },
        { binding: 1, resource: accumReadView },
        { binding: 2, resource: sceneTexture.createView() },
        { binding: 3, resource: emissiveAccumReadView },
        { binding: 4, resource: emissiveTexture.createView() },
        { binding: 5, resource: { buffer: accumBuffer } },
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
        {
          view: emissiveAccumWriteTexture.createView(),
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

    const bloomView = encodeBloomPasses(
      encoder,
      emissiveAccumWriteView,
      activeBloomTargets,
    );
    const postBindGroup = device.createBindGroup({
      label: "flow post bind group",
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: linearSampler },
        { binding: 1, resource: accumWriteView },
        { binding: 2, resource: emissiveAccumWriteView },
        { binding: 3, resource: bloomView },
        { binding: 4, resource: { buffer: renderBuffer } },
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
      emissiveTexture?.destroy();
      historyA?.destroy();
      historyB?.destroy();
      emissiveHistoryA?.destroy();
      emissiveHistoryB?.destroy();
      destroyBloomTargets(bloomTargets);
      particleBuffers[0].destroy();
      particleBuffers[1].destroy();
      simBuffer.destroy();
      renderBuffer.destroy();
      accumBuffer.destroy();
      bloomBuffers.forEach((buffer) => {
        buffer.destroy();
      });
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

async function chooseCanvasOutput(
  device: GPUDevice,
  context: GPUCanvasContext,
  preferredFormat: GPUTextureFormat,
  supportsDisplayP3: boolean,
  supportsHighDynamicRange: boolean,
): Promise<CanvasOutputConfig> {
  if (supportsDisplayP3 && supportsHighDynamicRange) {
    const extendedOutput: CanvasOutputConfig = {
      colorSpace: "display-p3",
      extended: true,
      format: "rgba16float",
      label: "display-p3-extended",
      toneMapping: { mode: "extended" },
    };

    if (await tryConfigureCanvas(device, context, extendedOutput)) {
      return extendedOutput;
    }
  }

  const standardOutput: CanvasOutputConfig = {
    colorSpace: supportsDisplayP3 ? "display-p3" : "srgb",
    extended: false,
    format: preferredFormat,
    label: supportsDisplayP3 ? "display-p3" : "srgb",
  };

  if (await tryConfigureCanvas(device, context, standardOutput)) {
    return standardOutput;
  }

  const srgbOutput: CanvasOutputConfig = {
    colorSpace: "srgb",
    extended: false,
    format: preferredFormat,
    label: "srgb",
  };
  await tryConfigureCanvas(device, context, srgbOutput);
  return srgbOutput;
}

async function tryConfigureCanvas(
  device: GPUDevice,
  context: GPUCanvasContext,
  output: CanvasOutputConfig,
): Promise<boolean> {
  device.pushErrorScope("validation");

  try {
    context.configure(createCanvasConfiguration(device, output));
  } catch {
    await device.popErrorScope();
    return false;
  }

  const error = await device.popErrorScope();
  return !error;
}

function createCanvasConfiguration(
  device: GPUDevice,
  output: CanvasOutputConfig,
): GPUCanvasConfiguration {
  const configuration: GPUCanvasConfiguration & {
    colorSpace?: PredefinedColorSpace;
    toneMapping?: { mode: "extended" };
  } = {
    alphaMode: "opaque",
    colorSpace: output.colorSpace,
    device,
    format: output.format,
  };

  if (output.toneMapping) {
    configuration.toneMapping = output.toneMapping;
  }

  return configuration;
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

function createFullscreenPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  format: GPUTextureFormat,
  fragmentEntryPoint: string,
  label: string,
): GPURenderPipeline {
  return device.createRenderPipeline({
    label,
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vertexMain",
    },
    fragment: {
      module,
      entryPoint: fragmentEntryPoint,
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
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

function createBloomTargets(
  device: GPUDevice,
  format: GPUTextureFormat,
  size: { width: number; height: number },
): BloomTargetSet {
  const createLevel = (label: string, level: number): BloomLevel => {
    const divisor = 2 ** (level + 1);
    const width = Math.max(1, Math.floor(size.width / divisor));
    const height = Math.max(1, Math.floor(size.height / divisor));
    const texture = device.createTexture({
      label,
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    return {
      texture,
      view: texture.createView(),
      width,
      height,
    };
  };

  return {
    down: Array.from({ length: BLOOM_LEVEL_COUNT }, (_, level) =>
      createLevel(`flow bloom down ${level}`, level),
    ),
    up: Array.from({ length: BLOOM_LEVEL_COUNT }, (_, level) =>
      createLevel(`flow bloom up ${level}`, level),
    ),
  };
}

function destroyBloomTargets(targets: BloomTargetSet | null): void {
  if (!targets) {
    return;
  }

  for (const level of [...targets.down, ...targets.up]) {
    level.texture.destroy();
  }
}

function bloomLevelWeight(level: number): number {
  if (level === 0) {
    return FLOW_HDR_TUNING.bloomSmallWeight;
  }

  if (level <= 2) {
    return FLOW_HDR_TUNING.bloomMediumWeight * (level === 1 ? 1 : 0.72);
  }

  return FLOW_HDR_TUNING.bloomLargeWeight * (level === 3 ? 1 : 0.62);
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
