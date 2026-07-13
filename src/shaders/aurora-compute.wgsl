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
  compactness: f32,
  primarySpeed: f32,
  secondarySpeed: f32,
  laneRestoration: f32,
  localVariation: f32,
  primaryWidth: f32,
  secondaryWidth: f32,
  primaryShare: f32,
}

@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> targetParticles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn primaryCenter(x: f32, compactness: f32) -> f32 {
  let desktop =
    0.42 - smoothstep(-0.52, 0.92, x) * 0.36 + sin((x + 0.35) * 2.1) * 0.1;
  let compact =
    0.48 - smoothstep(-0.85, 0.9, x) * 0.2 + sin((x + 0.2) * 2.1) * 0.06;
  return mix(desktop, compact, compactness);
}

fn secondaryCenter(x: f32, compactness: f32) -> f32 {
  return primaryCenter(x, compactness) +
    mix(-0.32, -0.28, compactness) +
    sin(x * 1.6 + 1.2) * 0.025;
}

fn layerValue(seed: f32) -> f32 {
  return hash11(seed * 5.19);
}

fn isSecondary(seed: f32) -> bool {
  return layerValue(seed) >= sim.primaryShare;
}

fn centerForParticle(x: f32, seed: f32, compactness: f32) -> f32 {
  if (isSecondary(seed)) {
    return secondaryCenter(x, compactness);
  }

  return primaryCenter(x, compactness);
}

fn widthForParticle(seed: f32) -> f32 {
  if (isSecondary(seed)) {
    return sim.secondaryWidth;
  }

  return sim.primaryWidth;
}

fn speedForParticle(seed: f32) -> f32 {
  if (isSecondary(seed)) {
    return sim.secondarySpeed;
  }

  return sim.primarySpeed;
}

fn flowTangent(x: f32, seed: f32, compactness: f32) -> vec2f {
  let epsilon = 0.018;
  let before = centerForParticle(x - epsilon, seed, compactness);
  let after = centerForParticle(x + epsilon, seed, compactness);
  return normalize(vec2f(epsilon * 2.0, after - before));
}

fn spawn(seed: f32, epoch: f32) -> Particle {
  let h0 = hash11(seed + epoch * 1.37);
  let h1 = hash11(seed * 2.31 + epoch * 1.91);
  let h2 = hash11(seed * 3.73 + epoch * 2.17);
  let h3 = hash11(seed * 11.7 + epoch * 3.97);
  let lane = mix(-1.0, 1.0, h1);
  let x = mix(-1.36, -1.28, h0);
  let width = widthForParticle(seed);
  let y = centerForParticle(x, seed, sim.compactness) + lane * width * (0.28 + h2 * 0.72);
  let tangent = flowTangent(x, seed, sim.compactness);

  var particle: Particle;
  particle.position = vec2f(x, y);
  particle.velocity = tangent * speedForParticle(seed);
  particle.seed = seed;
  particle.depth = h2;
  particle.age = h3 * 0.08;
  particle.lane = lane;
  return particle;
}

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) globalId: vec3u) {
  if (globalId.x >= arrayLength(&sourceParticles)) {
    return;
  }

  let index = globalId.x;
  var particle = sourceParticles[index];
  let lifetime = mix(24.0, 44.0, hash11(particle.seed * 3.91));
  let epoch = floor(sim.time / lifetime + particle.seed * 0.017);

  if (
    particle.age > lifetime ||
    particle.position.x < -1.48 ||
    particle.position.x > 1.36 ||
    abs(particle.position.y) > 1.24
  ) {
    particle = spawn(particle.seed, epoch);
  }

  let deltaTime = min(sim.deltaTime, 0.033);
  let tangent = flowTangent(particle.position.x, particle.seed, sim.compactness);
  let normal = vec2f(-tangent.y, tangent.x);
  let width = widthForParticle(particle.seed);
  let targetY =
    centerForParticle(particle.position.x, particle.seed, sim.compactness) +
    particle.lane * width * (0.28 + particle.depth * 0.72);
  let laneError = clamp(targetY - particle.position.y, -0.18, 0.18);
  let slowVariation =
    sin(particle.position.x * 2.4 + particle.lane * 1.7 + sim.time * 0.08) +
    sin(particle.position.x * 1.15 - particle.lane * 2.1 - sim.time * 0.055) * 0.42;
  let targetVelocity =
    tangent * speedForParticle(particle.seed) +
    vec2f(0.0, laneError * sim.laneRestoration) +
    normal * slowVariation * sim.localVariation;
  let response = 1.0 - exp(-deltaTime * mix(1.35, 2.1, particle.depth));

  particle.velocity = mix(particle.velocity, targetVelocity, response);
  let velocityLength = length(particle.velocity);

  if (velocityLength > 0.18) {
    particle.velocity = particle.velocity / velocityLength * 0.18;
  }

  particle.position = particle.position + particle.velocity * deltaTime * sim.motion;
  // Scale lifetime progression with advection so reduced motion preserves the
  // full distributed composition instead of expiring particles before they
  // can traverse their authored lanes.
  particle.age = particle.age + deltaTime * mix(0.82, 1.0, particle.depth) * sim.motion;
  targetParticles[index] = particle;
}
