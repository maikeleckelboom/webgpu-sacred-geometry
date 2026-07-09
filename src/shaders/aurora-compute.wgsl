

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

