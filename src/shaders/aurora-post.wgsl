struct Render {
  time: f32,
  aspect: f32,
  opacity: f32,
  pixelRatio: f32,
  viewport: vec2f,
  pointer: vec2f,
  pointerStrength: f32,
  pointerRadiusCss: f32,
  compactness: f32,
  exposure: f32,
  trailPixels: f32,
  maxDisplacementCss: f32,
  clearing: f32,
  edgeGain: f32,
  primaryWidth: f32,
  secondaryWidth: f32,
  revealStart: f32,
  compactVisibleShare: f32,
  sceneGain: f32,
  glowGain: f32,
  spriteOpacity: f32,
  primaryShare: f32,
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
  out.uv = position * 0.5 + vec2f(0.5);
  return out;
}

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
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

fn horizontalMask(x: f32) -> f32 {
  let reveal = smoothstep(render.revealStart - 0.3, render.revealStart + 0.34, x);
  let edge = 1.0 - smoothstep(1.16, 1.4, x);
  return reveal * edge;
}

fn authoredAurora(point: vec2f) -> vec3f {
  let mask = horizontalMask(point.x);
  let primaryY = primaryCenter(point.x, render.compactness);
  let secondaryY = secondaryCenter(point.x, render.compactness);
  let primaryDistance = abs(point.y - primaryY);
  let secondaryDistance = abs(point.y - secondaryY);
  let primaryBody =
    (1.0 - smoothstep(render.primaryWidth * 0.28, render.primaryWidth * 1.28, primaryDistance)) *
    mask;
  let primaryCore =
    (1.0 - smoothstep(0.008, 0.036, primaryDistance)) *
    mask *
    (0.72 + sin(point.x * 5.2 + render.time * 0.045) * 0.12);
  let secondaryBody =
    (1.0 - smoothstep(render.secondaryWidth * 0.16, render.secondaryWidth * 1.44, secondaryDistance)) *
    mask;
  let filamentY =
    primaryY +
    sin(point.x * 4.6 + 1.4) * 0.045 +
    sin(point.x * 8.2 - render.time * 0.035) * 0.009;
  let faintFilament =
    (1.0 - smoothstep(0.004, 0.018, abs(point.y - filamentY))) *
    mask *
    0.055;
  let focusX = mix(0.236, 0.12, render.compactness);
  let focusY = primaryCenter(focusX, render.compactness);
  let focusRadius = mix(vec2f(0.66, 0.32), vec2f(0.82, 0.26), render.compactness);
  let focusDistance = length((point - vec2f(focusX, focusY)) / focusRadius);
  let greenBacklight = (1.0 - smoothstep(0.08, 1.0, focusDistance)) * mask;

  let primaryColor = mix(vec3f(0.018, 0.15, 0.16), vec3f(0.028, 0.3, 0.25), primaryBody);
  let secondaryColor = mix(vec3f(0.018, 0.08, 0.16), vec3f(0.13, 0.055, 0.2), 0.2);
  return vec3f(0.014, 0.12, 0.063) * greenBacklight * 0.92 +
    primaryColor * primaryBody * 0.82 +
    vec3f(0.06, 0.48, 0.39) * primaryCore * 0.24 +
    secondaryColor * secondaryBody * 0.3 +
    vec3f(0.055, 0.28, 0.36) * faintFilament;
}

fn starField(uv: vec2f) -> vec3f {
  let domain = uv * vec2f(190.0, 112.0);
  let cell = floor(domain);
  let local = fract(domain) - vec2f(0.5);
  let random = hash21(cell);
  let star = step(0.9981, random);
  let rare = step(0.99955, random);
  let radius = dot(local, local);
  let pointShape = exp(-radius * 128.0);
  let phase = hash21(cell + vec2f(9.2, 4.7)) * 6.2831;
  let twinkle = 0.82 + sin(render.time * 0.42 + phase) * 0.18;
  let quietBias = 1.0 - smoothstep(0.38, 0.9, uv.x) * 0.28;
  let normalColor = vec3f(0.17, 0.38, 0.43);
  let rareColor = vec3f(0.36, 0.48, 0.62);
  return (normalColor * star * 0.42 + rareColor * rare * 0.36) * pointShape * twinkle * quietBias;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let textureSize = vec2f(textureDimensions(sceneTexture, 0));
  let texel = 1.0 / max(textureSize, vec2f(1.0));
  let center = textureSample(sceneTexture, postSampler, input.uv).rgb;
  let neighbors =
    textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(1.5, 0.0)).rgb +
    textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(-1.5, 0.0)).rgb +
    textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(0.0, 1.5)).rgb +
    textureSample(sceneTexture, postSampler, input.uv + texel * vec2f(0.0, -1.5)).rgb;
  let localGlow = max(neighbors * 0.25 - center * 0.58, vec3f(0.0));
  // WebGPU clip-space particles use positive Y toward the lower framebuffer,
  // while the fullscreen UV interpolation is sampled top-down. Flip once so
  // the authored post bands and simulated particle lanes share one field.
  let point = vec2f(input.uv.x * 2.0 - 1.0, 1.0 - input.uv.y * 2.0);
  let vertical = smoothstep(0.0, 1.0, input.uv.y);
  let background = mix(vec3f(0.0035, 0.005, 0.009), vec3f(0.006, 0.012, 0.018), vertical);
  let color =
    background +
    authoredAurora(point) +
    starField(input.uv) +
    center * render.sceneGain +
    localGlow * render.glowGain;
  let toneMapped = vec3f(1.0) - exp(-color * render.exposure);
  return vec4f(toneMapped, 1.0);
}
