
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

// === Flow-field helpers (mirrored from the compute shader) ===
// The aurora compute shader and post shader are separate WGSL modules,
// so the field math is duplicated here with render.* uniforms replacing
// sim.* uniforms. This lets the star field sample through the SAME flow
// field that drives the aurora particles instead of being a static
// screen-space overlay.

fn flowNoise(point: vec2f, lane: f32, time: f32) -> vec2f {
  let waveA = sin((point.y + lane * 0.12) * 8.4 + point.x * 1.9 + time * 0.31);
  let waveB = cos((point.x - lane * 0.08) * 6.7 - point.y * 1.6 - time * 0.24);
  let waveC = sin((point.x * 3.4 - point.y * 4.1) + lane * 2.2 + time * 0.17);
  let waveD = cos((point.x * 2.1 + point.y * 3.6) - time * 0.19);
  return normalize(vec2f(waveA + waveC * 0.72, waveB - waveD * 0.58) + vec2f(0.001, -0.002));
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

// The single reusable flow helper: combines the wave-based river drift,
// the six vortex basins, and the pointer deflection — the same velocity
// field the aurora particles follow — into one vector in field/NDC space.
// Stars are sampled through a coordinate system warped by this vector so
// they feel like dust caught in the same aurora flow.
fn flowVector(point: vec2f, time: f32) -> vec2f {
  let centerA = vec2f(0.34 + sin(time * 0.09) * 0.045, -0.04 + cos(time * 0.11) * 0.035);
  let centerB = vec2f(0.72 + cos(time * 0.13) * 0.052, 0.32 + sin(time * 0.10) * 0.045);
  let centerC = vec2f(0.78 + sin(time * 0.10) * 0.048, -0.42 + cos(time * 0.12) * 0.055);
  let centerD = vec2f(1.13 + cos(time * 0.08) * 0.045, 0.03 + sin(time * 0.16) * 0.05);
  let centerE = vec2f(0.05 + cos(time * 0.07) * 0.045, 0.55 + sin(time * 0.09) * 0.04);
  let centerF = vec2f(0.08 + sin(time * 0.06) * 0.05, -0.73 + cos(time * 0.10) * 0.05);

  let curl = flowNoise(point, 0.0, time);
  let river = vec2f(0.12, 0.0) + curl * 0.09;
  let vortexField =
    vortex(point, centerA, 1.0, 1.08, 0.18, 0.032) +
    vortex(point, centerB, -1.0, 0.8, 0.13, 0.018) +
    vortex(point, centerC, -1.0, 0.82, 0.12, 0.02) +
    vortex(point, centerD, 1.0, 0.74, 0.11, 0.016) +
    vortex(point, centerE, -1.0, 0.78, 0.08, 0.012) +
    vortex(point, centerF, 1.0, 0.78, 0.08, 0.012);

  let toPointer = render.pointer - point;
  let pointerDistance = max(length(toPointer), 0.001);
  let pointerToward = toPointer / pointerDistance;
  let pointerTangent = vec2f(-pointerToward.y, pointerToward.x);
  let pointerFalloff = (1.0 - smoothstep(0.02, 0.78, pointerDistance)) * render.pointerStrength;
  let pointerDeflection = pointerTangent * pointerFalloff * 0.42 + pointerToward * pointerFalloff * 0.18;

  return river + vortexField + pointerDeflection;
}

// Star field sampled through a flow-warped coordinate system.
// Stars are no longer placed from raw screen UV; the UV is displaced by
// the same flow vector that drives the aurora particles plus a pointer
// lensing term. Local flow energy and pointer proximity modulate
// brightness, twinkle energy and directional streaking. This makes the
// field feel physically embedded in the aurora flow rather than being a
// static screen-space overlay.
fn skyColor(uv: vec2f, time: f32) -> vec3f {
  let vertical = smoothstep(0.0, 1.0, uv.y);
  var color = mix(vec3f(0.006, 0.007, 0.011), vec3f(0.018, 0.054, 0.04), vertical);
  color += vec3f(0.032, 0.008, 0.04) * smoothstep(0.24, 0.92, uv.x) * smoothstep(0.06, 0.8, uv.y);

  // --- Flow-coupled star field ---
  // Map screen UV to the same field/NDC space the particles and pointer
  // live in, then sample the shared flow vector there.
  let fieldCoord = uv * 2.0 - 1.0;
  let flow = flowVector(fieldCoord, time);
  let energy = length(flow);
  let energyN = clamp(energy * 2.5, 0.0, 1.0);

  // Pointer lensing: a gentle gravitational bend that pulls star positions
  // toward the pointer, separate from the flow warp.
  let toPointer = render.pointer - fieldCoord;
  let pointerDist = length(toPointer) + 0.001;
  let pointerDir = toPointer / pointerDist;
  let lensRadius = 0.45;
  let pointerProx = 1.0 - smoothstep(0.02, lensRadius, pointerDist);
  let pointerWarp = pointerDir * pointerProx * render.pointerStrength * 0.006;

  // Flow warp: displace the star sampling domain by the local flow vector
  // (converted from field space to UV space). Subtle enough that stars
  // keep their stable identity but drift and breathe with the field.
  let flowWarp = flow * 0.5 * 0.015;
  let warpedUv = uv + flowWarp + pointerWarp;

  // Two density layers (preserved density, now flow-warped). Normal stars
  // stay point-like; a rarer bright layer gets flow-aligned streaks.
  let starDomain = warpedUv * vec2f(260.0, 150.0);
  let starGrid = floor(starDomain);
  let starLocal = fract(starDomain) - vec2f(0.5);
  let cellRand = hash21(starGrid);
  let star = step(0.9955, cellRand);
  let brightStar = step(0.9988, cellRand);

  // Twinkle (preserved single-octave formula), energized by pointer.
  let phase = hash21(starGrid + vec2f(11.0, 11.0)) * 6.2831;
  let twinkle = 0.62 + 0.38 * sin(time * 1.9 + phase);
  let brightTwinkle = 0.55 + 0.45 * sin(time * 2.6 + phase * 1.7);
  let pointerTwinkle = 1.0 + pointerProx * render.pointerStrength * 0.6;

  // Normal stars stay mostly point-like.
  let starShape = exp(-dot(starLocal, starLocal) * 92.0);

  // Bright stars become flow-aligned glints: the Gaussian is stretched
  // along the local flow direction (expressed in cell space so the
  // orientation matches the screen). Stretch grows with flow energy and
  // pointer proximity so bright stars streak visibly near activity.
  let flowCellDir = normalize(vec2f(flow.x * 260.0, flow.y * 150.0) + vec2f(0.001, 0.001));
  let perpCellDir = vec2f(-flowCellDir.y, flowCellDir.x);
  let along = dot(starLocal, flowCellDir);
  let across = dot(starLocal, perpCellDir);
  let streakLen = 1.0 + energyN * 1.8 + pointerProx * render.pointerStrength * 1.2;
  let streakSq = streakLen * streakLen;
  let brightStarShape = exp(-(along * along * (48.0 / streakSq) + across * across * 48.0));

  // Energy + pointer brightness modulation. Stars near stronger flow or
  // pointer activity become brighter. Avoids global pulsing because the
  // energy varies spatially with the flow.
  let energyBright = 1.0 + energyN * 0.45;
  let pointerBright = 1.0 + pointerProx * render.pointerStrength * 0.7;
  let vertFade = smoothstep(0.2, 0.96, uv.y);

  // Star colors: teal-green (preserved) for normal, warm-gold for bright.
  let starColor = vec3f(0.5, 0.86, 0.74);
  let brightStarColor = mix(vec3f(0.7, 0.95, 1.0), vec3f(1.0, 0.92, 0.7), hash21(starGrid + vec2f(9.9, 0.3)));

  color += starColor * star * starShape * twinkle * pointerTwinkle * 0.26 * energyBright * pointerBright * vertFade;
  color += brightStarColor * brightStar * brightStarShape * brightTwinkle * pointerTwinkle * 0.5 * energyBright * pointerBright * vertFade;

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
  let low = curtain(input.uv, render.time, 7.9, 0.27, 0.068);
  let aurora =
    vec3f(0.12, 0.9, 0.45) * high +
    vec3f(0.06, 0.64, 0.96) * middle +
    vec3f(0.56, 0.16, 0.72) * low * 0.34;
  let pointerGlow = 1.0 - smoothstep(0.0, 0.55, distance(input.uv * 2.0 - vec2f(1.0, 1.0), render.pointer));
  let sceneLight = center.rgb * 0.76 + bloom * vec3f(0.72, 1.02, 0.86);
  let color = skyColor(input.uv, render.time) + aurora * 1.72 + sceneLight + vec3f(0.12, 0.82, 0.54) * pointerGlow * render.pointerStrength * 0.2;
  let toneMapped = vec3f(1.0) - exp(-color * vec3f(1.02, 0.9, 0.98));
  return vec4f(toneMapped, 1.0);
}
