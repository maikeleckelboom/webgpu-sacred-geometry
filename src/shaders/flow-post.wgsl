
const PRESSURE_SWIRL_BOOST = 0.65;
const BLOOM_GAMMA = 0.4167;
const PRESSURE_BLOOM_BOOST = 0.35;
const PRESSURE_LIGHT_BOOST = 0.6;
const PRESSURE_EXPOSURE_BOOST = 0.0;

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
  modeFlow: f32,
  modeReserved: f32,
  modeTopo: f32,
  modeArch: f32,
  modeWaves: f32,
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

// === Flow-field helpers (mirrored from the compute shader) ===
// The compute shader and post shader are separate WGSL modules, so the
// field math is duplicated here. snoise2 is identical to the compute
// shader's snoise, and render.* uniforms replace sim.* uniforms. This
// lets the star field sample through the SAME flow field that drives the
// particle system instead of being a static screen-space overlay.

const GOLDEN_ANGLE = 2.39996322972865332;

fn curlNoise2D(point: vec2f, time: f32) -> vec2f {
  let pT = point + vec2f(time * 0.08, -time * 0.06);
  let eps = 0.08;
  let n1 = snoise2(pT + vec2f(0.0, eps));
  let n2 = snoise2(pT - vec2f(0.0, eps));
  let n3 = snoise2(pT + vec2f(eps, 0.0));
  let n4 = snoise2(pT - vec2f(eps, 0.0));
  return vec2f((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}

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

// Combined field at a point, weighted by the active mode blend. Only the
// active mode(s) are evaluated for fragment-shader performance.
fn flowFieldAt(point: vec2f, time: f32) -> vec2f {
  var f = vec2f(0.0);
  if (render.modeFlow > 0.01) {
    f += render.modeFlow * fieldModeFlow(point, time);
  }
  if (render.modeTopo > 0.01) {
    f += render.modeTopo * fieldModeTopography(point, time);
  }
  if (render.modeArch > 0.01) {
    f += render.modeArch * fieldModeArchitecture(point, time);
  }
  if (render.modeWaves > 0.01) {
    f += render.modeWaves * fieldModeWaves(point, time);
  }
  return f;
}

// Pointer influence — same math as the compute shader's mouseField,
// reading from the post-shader render uniform struct.
fn flowMouseField(point: vec2f) -> vec2f {
  if (render.pointerStrength < 0.001) {
    return vec2f(0.0);
  }
  let d = render.pointer - point;
  let r = length(d) + 0.001;
  let toward = d / r;
  let tangent = vec2f(-toward.y, toward.x);
  let radius = 0.42 + render.pressure * 0.14;
  let falloff = (1.0 - smoothstep(0.02, radius, r)) * render.pointerStrength;
  let core = 1.0 - smoothstep(0.0, 0.08, r);
  let charge = 1.0 + render.pressure * PRESSURE_SWIRL_BOOST;
  return (tangent * falloff * 0.16 + toward * falloff * 0.038 - toward * core * render.pointerStrength * 0.06) * charge;
}

// The single reusable flow helper: combines the active field mode(s) and
// the pointer influence into one velocity-like vector in field/NDC space.
// Stars are sampled through a coordinate system warped by this vector so
// they feel like dust/embers caught in the same cosmic flow as the main
// particle effect.
fn flowVector(point: vec2f, time: f32) -> vec2f {
  return flowFieldAt(point, time) + flowMouseField(point);
}

fn starInteractionMask(fieldCoord: vec2f, flow: vec2f, energyN: f32, starGrid: vec2f, starMask: f32) -> vec2f {
  if (render.pointerStrength < 0.001 || starMask < 0.5) {
    return vec2f(0.0);
  }

  let fromPointer = fieldCoord - render.pointer;
  let distanceFromPointer = length(fromPointer) + 0.001;
  let outward = fromPointer / distanceFromPointer;
  let localFlowDir = normalize(flow + vec2f(0.001, -0.001));

  let flowAlign = smoothstep(0.14, 0.9, abs(dot(outward, localFlowDir)));
  let fieldReach = 1.0 - smoothstep(0.52, 1.85, distanceFromPointer);
  let cursorGap = smoothstep(0.08, 0.28, distanceFromPointer);
  let starVariance = 0.72 + 0.28 * hash21(starGrid + floor(render.pointer * 5.0) + vec2f(17.3, 5.9));
  let activity = render.pointerStrength * (0.36 + render.pressure * 0.64);
  let fieldResponse = activity * fieldReach * (0.18 + energyN * 0.3) * (0.45 + flowAlign * 0.55) * starVariance;
  let wakeResponse = activity * cursorGap * fieldReach * flowAlign * (0.4 + energyN * 0.6) * starVariance;

  return vec2f(clamp(fieldResponse, 0.0, 0.52), clamp(wakeResponse, 0.0, 0.92));
}

// Star field sampled through a flow-warped coordinate system.
// Stars are no longer placed from raw screen UV; the UV is displaced by
// the same flow vector that drives the particle system plus a pointer
// lensing term. Local flow energy and pointer proximity modulate
// brightness, twinkle energy and directional streaking. This makes the
// field feel physically embedded in the flow scene rather than being a
// static screen-space overlay.
fn skyColor(uv: vec2f, time: f32) -> vec3f {
  let vertical = smoothstep(0.0, 1.0, uv.y);
  var color = mix(vec3f(0.0006, 0.0009, 0.002), vec3f(0.0025, 0.008, 0.0065), vertical);

  // Subtle nebula color wash: low-frequency, incommensurate drift, varies by region.
  let n1 = snoise2(uv * vec2f(2.1, 1.4) + vec2f(time * 0.013, -time * 0.009));
  let n2 = snoise2(uv * vec2f(3.4, 2.3) + vec2f(-time * 0.017, time * 0.011 + 4.7));
  let nebula = n1 * 0.6 + n2 * 0.4;
  color += vec3f(0.022, 0.008, 0.04) * max(nebula, 0.0) * smoothstep(0.15, 0.92, uv.y);
  color += vec3f(0.005, 0.028, 0.022) * max(-nebula, 0.0) * smoothstep(0.1, 0.95, uv.y);

  // --- Flow-coupled star field ---
  // Map screen UV to the same field/NDC space the particles and pointer
  // live in, then sample the shared flow vector there.
  let fieldCoord = uv * 2.0 - 1.0;
  let flow = flowVector(fieldCoord, time);
  let energy = length(flow);
  let energyN = clamp(energy * 3.0, 0.0, 1.0);

  // Pointer lensing: a gentle gravitational bend that pulls star positions
  // toward the pointer, separate from the flow warp. Widens with pressure.
  let toPointer = render.pointer - fieldCoord;
  let pointerDist = length(toPointer) + 0.001;
  let pointerDir = toPointer / pointerDist;
  let lensRadius = 0.24 + render.pressure * 0.1;
  let pointerProx = 1.0 - smoothstep(0.02, lensRadius, pointerDist);
  let pointerTangent = vec2f(-pointerDir.y, pointerDir.x);
  let pointerWarp =
    pointerDir * pointerProx * render.pointerStrength * (0.014 + render.pressure * 0.006) +
    pointerTangent * pointerProx * render.pointerStrength * (0.012 + render.pressure * 0.007);

  // Flow warp: displace the star sampling domain by the local flow vector
  // (converted from field space to UV space). Subtle enough that stars
  // keep their stable identity but drift and breathe with the field.
  let starParallax = -render.pointer * render.pointerStrength;
  let farWarp = flow * 0.5 * 0.009 + starParallax * 0.0025 + vec2f(time * 0.00045, -time * 0.00032);
  let farDomain = (uv + farWarp) * vec2f(160.0, 94.0);
  let farGrid = floor(farDomain);
  let farLocal = fract(farDomain) - vec2f(0.5);
  let farRand = hash21(farGrid + vec2f(19.2, 4.4));
  let farStar = step(0.99835, farRand);
  let farTwinkle = 0.62 + 0.18 * sin(time * (0.22 + hash21(farGrid) * 0.6) + farRand * 6.2831);
  let farShape = exp(-dot(farLocal, farLocal) * 138.0);
  let farFade = smoothstep(0.22, 0.98, uv.y);
  let vortexStarLift = 1.0 + pointerProx * render.pointerStrength * 0.18;
  color += mix(vec3f(0.32, 0.58, 0.68), vec3f(0.72, 0.86, 0.76), farRand) * farStar * farShape * farTwinkle * 0.064 * farFade * vortexStarLift;

  let flowWarp = flow * 0.5 * 0.018;
  let interactionWarp = flow * render.pointerStrength * (0.009 + render.pressure * 0.006);
  let warpedUv = uv + flowWarp + interactionWarp + pointerWarp + starParallax * 0.0065;

  // Near stars stay sparse and use stronger parallax/flow warp than the far layer.
  let starDomain = warpedUv * vec2f(172.0, 102.0);
  let starGrid = floor(starDomain);
  let starLocal = fract(starDomain) - vec2f(0.5);
  let cellRand = hash21(starGrid);
  let phase = hash21(starGrid + vec2f(7.3, 2.1)) * 6.2831;
  let freqSlow = 0.35 + hash21(starGrid + vec2f(3.7, 9.2)) * 1.45;
  let freqFast = 1.6 + hash21(starGrid + vec2f(5.1, 4.4)) * 3.4;
  let brightness = 0.45 + hash21(starGrid + vec2f(11.1, 13.3)) * 0.55;
  let star = step(0.9983, cellRand);
  let brightStar = step(0.99958, cellRand);
  let starMask = max(star, brightStar);
  let starInteraction = starInteractionMask(fieldCoord, flow, energyN, starGrid, starMask);
  let fieldResponse = starInteraction.x;
  let flowWake = starInteraction.y;

  // Twinkle: per-cell random phase and two octaves (preserved), energized
  // by each star's flow response so the star layer participates in the field.
  let slow = sin(time * freqSlow + phase);
  let fast = sin(time * freqFast + phase * 1.7 + 2.1);
  var twinkle = 0.42 + 0.4 * slow + 0.16 * fast;
  let flarePhase = sin(time * (freqSlow * 0.43) + phase * 0.27);
  twinkle = twinkle + pow(max(0.0, flarePhase), 26.0) * 0.55;
  let pointerTwinkle = 1.0 + fieldResponse * 1.2 + flowWake * 1.8;

  // Per-star color variation (teal-to-warm and blue-to-gold, preserved).
  let hueShift = hash21(starGrid + vec2f(1.2, 8.8));
  let starColor = mix(vec3f(0.58, 0.88, 0.78), vec3f(1.0, 0.95, 0.82), hueShift);
  let brightStarColor = mix(vec3f(0.7, 0.95, 1.0), vec3f(1.0, 0.92, 0.7), hash21(starGrid + vec2f(9.9, 0.3)));

  // Stars become flow-aligned glints: the Gaussian is stretched along the
  // local flow direction (expressed in cell space so the orientation
  // matches the screen). Normal stars get a softer version of the same
  // response instead of staying decorative point sprites.
  let flowCellDir = normalize(vec2f(flow.x * 172.0, flow.y * 102.0) + vec2f(0.001, 0.001));
  let perpCellDir = vec2f(-flowCellDir.y, flowCellDir.x);
  let along = dot(starLocal, flowCellDir);
  let across = dot(starLocal, perpCellDir);
  let pointStarShape = exp(-dot(starLocal, starLocal) * 92.0);
  let normalStretchLen = 1.0 + energyN * 0.9 + fieldResponse * 2.1 + flowWake * 1.2;
  let normalStretchSq = normalStretchLen * normalStretchLen;
  let flowStarShape = exp(-(along * along * (92.0 / normalStretchSq) + across * across * 92.0));
  let starShape = mix(pointStarShape, flowStarShape, clamp(0.18 + energyN * 0.28 + fieldResponse * 1.55, 0.0, 0.88));
  let streakLen = 1.0 + energyN * 1.8 + fieldResponse * 1.2 + flowWake * 2.1;
  let streakSq = streakLen * streakLen;
  let brightStarShape = exp(-(along * along * (72.0 / streakSq) + across * across * 72.0));

  // Energy + pointer brightness modulation. Stars brighten only when they
  // land in sparse flow-connected wake ribbons, not in a radial cursor blob.
  let energyBright = 0.85 + energyN * 0.28 + fieldResponse * 0.45;
  let pointerBright = 1.0 + fieldResponse * 0.9 + flowWake * 1.3;
  let vertFade = smoothstep(0.25, 0.98, uv.y);
  let vertFadeBright = smoothstep(0.2, 0.98, uv.y);

  let starHalo = exp(-dot(starLocal, starLocal) * 28.0);
  let brightStarHalo = exp(-dot(starLocal, starLocal) * 16.0);
  color += starColor * star * starHalo * brightness * 0.04 * vertFade * vortexStarLift;
  color += brightStarColor * brightStar * brightStarHalo * 0.075 * vertFadeBright * vortexStarLift;
  color += starColor * star * starShape * clamp(twinkle * pointerTwinkle, 0.0, 1.5) * brightness * 0.13 * energyBright * pointerBright * vertFade * vortexStarLift;
  color += brightStarColor * brightStar * brightStarShape * clamp(twinkle * 1.2 * pointerTwinkle, 0.0, 1.65) * 0.22 * energyBright * pointerBright * vertFadeBright * vortexStarLift;
  color += starColor * star * flowStarShape * fieldResponse * 0.075 * vertFade;
  color += brightStarColor * starMask * exp(-dot(starLocal, starLocal) * 20.0) * flowWake * 0.16 * vertFadeBright;

  return color;
}

fn linearToGamma(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return max(1.055 * pow(x, vec3f(BLOOM_GAMMA)) - vec3f(0.055), vec3f(0.0));
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
  let bloomBoost = 1.0 + pressure * PRESSURE_BLOOM_BOOST;
  var bloom = textureSample(bloomTexture, postSampler, input.uv).rgb * render.bloomIntensity * bloomBoost;
  bloom = linearToGamma(bloom);

  let r1 = ridge(input.uv, render.time);
  let r2 = ridge2(input.uv * vec2f(1.0, 1.1) + vec2f(13.7, 7.1), render.time);
  let dyeMag = length(dye);
  let particleHalo = localAccumulationHalo(input.uv);
  let causticMask = smoothstep(0.05, 0.42, dyeMag);
  let causticCore = smoothstep(0.08, 0.5, dyeMag);
  let causticColor = vec3f(0.45, 0.95, 0.78) * r1 * 0.68 + vec3f(0.32, 0.78, 1.0) * r2 * 0.48;
  let artifactVeil = smoothstep(0.08, 0.62, particleHalo + dyeMag * 0.2);
  let caustic = causticColor * (causticMask * causticCore + artifactVeil * 0.22);

  let particleCore = smoothstep(0.12, 0.72, dyeMag);
  let particleLight = (particleHalo * 0.88 + particleCore * 0.28) * render.pointerStrength * (1.0 + pressure * PRESSURE_LIGHT_BOOST);
  let causticLit = caustic * (1.0 + particleLight * 1.4);
  let bloomLit = bloom * (1.0 + particleLight * 1.1);

  let ringShimmer = 0.7 + 0.3 * sin(render.time * 6.0 + pressure * 12.0);
  let ringColor = mix(vec3f(0.55, 0.95, 1.0), vec3f(1.0, 0.86, 0.62), pressure);
  let chargeGlow = particleHalo * ringShimmer * pressure * render.pointerStrength * ringColor * 0.25;

  let pressureHalo = particleHalo * pressure * 0.18;
  let pressureGlow = pressureHalo * vec3f(0.42, 0.78, 1.0) * render.pointerStrength;

  let bloomPulse = 0.86 + 0.14 * smoothstep(0.0, 1.0, sin(render.time * 0.6) * 0.5 + 0.5);
  var color = skyColor(input.uv, render.time) + base * 1.28 + bloomLit * vec3f(0.72, 1.0, 0.88) * bloomPulse + causticLit * 1.32 + chargeGlow + pressureGlow;

  let noise = (hash21(input.uv * render.viewport + vec2f(render.time * 17.0, 0.0)) - 0.5) / 255.0;
  color += noise;

  let contrasted = pow(max(color, vec3f(0.0)), vec3f(1.14 - pressure * 0.06));
  let exposed = contrasted * (render.exposure + pressure * PRESSURE_EXPOSURE_BOOST);
  let toned = acesFilmic(exposed);
  return vec4f(linearToGamma(toned), 1.0);
}
