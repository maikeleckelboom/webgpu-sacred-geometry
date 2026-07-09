
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
  let glintSeed = step(0.989, hash11(particle.seed * 23.71));
  let glintSlow = 0.3 + 0.7 * smoothstep(0.0, 1.0, sin(render.time * 0.55 + particle.seed * 0.14) * 0.5 + 0.5);
  let glintShimmer = glintSeed * (0.3 + 0.7 * sin(render.time * 3.4 + particle.seed * 2.7 + particle.position.x * 4.1)) * glintSlow;
  let headShimmer = 0.82 + 0.18 * smoothstep(0.0, 1.0, sin(render.time * 0.7 + particle.seed * 0.21) * 0.5 + 0.5);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = fieldColor(particle, render.time);
  out.color = out.color * (1.0 + pointerWake * 1.2 + vectorCharge * 2.35);
  out.color = out.color + vec3f(1.0, 0.94, 0.74) * glintShimmer * 1.15;
  let baseAlpha = 0.052 + abs(particle.mCurl) * 4.9 + speed * 0.76 + particle.mEnergy * 0.46;
  out.alpha = render.opacity * mask * lifeFade(particle) * headShimmer * (baseAlpha + glintShimmer * 0.11 + pointerWake * 0.12 + vectorCharge * 0.18);
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
  let marker = smoothstep(0.965, 0.999, hash11(particle.seed * 17.17));
  let node = step(0.9992, hash11(particle.seed * 29.17));
  let glint = step(0.982, hash11(particle.seed * 41.83));
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
  let radiusPixels = (0.56 + marker * (1.65 + particle.mSpeed * 2.0 + curlBright * 0.62) + node * 1.1 + glint * 2.35 + pointerWake * 1.85 + vectorCharge * 2.7) * shimmerPulse;
  let position = particle.position + corner * ndcPixel * radiusPixels;
  let mask = sceneMask(particle.position);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = fieldColor(particle, render.time);
  out.color = out.color * (1.0 + pointerWake * 1.2 + vectorCharge * 2.35);
  out.color = out.color + vec3f(1.0, 0.94, 0.74) * max(glintShimmer * 0.42, nodeTwinkle * 0.24) * 1.35;
  out.alpha = render.opacity * mask * lifeFade(particle) * (marker * (0.055 + particle.mSpeed * 0.24 + curlBright * 0.2) + nodeTwinkle * 0.075 + glintShimmer * 0.18 + pointerWake * 0.12 + vectorCharge * 0.18);
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
