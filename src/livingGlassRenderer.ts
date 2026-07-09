const livingGlassShader = /* wgsl */ `
override QUALITY: u32 = 1u; // 0=low, 1=medium, 2=high, 3=ultra

struct Globals {
  resolution : vec2<f32>,
  time       : f32,
  intensity  : f32,
  seed       : f32,
  parallax   : f32,
  padding    : vec2<f32>,
};

@group(0) @binding(0) var<uniform> G : Globals;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  var out : VSOut;
  out.pos = vec4<f32>(positions[vid], 0.0, 1.0);
  out.uv = (out.pos.xy * 0.5) + vec2<f32>(0.5, 0.5);
  return out;
}

fn hash12(p: vec2<f32>) -> f32 {
  let h = dot(p, vec2<f32>(127.1, 311.7)) + G.seed * 17.0;
  return fract(sin(h) * 43758.5453123);
}

fn hash13(p: vec3<f32>) -> f32 {
  let h = dot(p, vec3<f32>(127.1, 311.7, 74.7)) + G.seed * 19.0;
  return fract(sin(h) * 43758.5453123);
}

fn valueNoise2(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash12(i);
  let b = hash12(i + vec2<f32>(1.0, 0.0));
  let c = hash12(i + vec2<f32>(0.0, 1.0));
  let d = hash12(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn valueNoise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);

  let a = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
  let b = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
  let c = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
  let d = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
  let e = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
  let f1 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
  let g = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
  let h = hash13(i + vec3<f32>(1.0, 1.0, 1.0));

  let x00 = mix(a, b, u.x);
  let x10 = mix(c, d, u.x);
  let x01 = mix(e, f1, u.x);
  let x11 = mix(g, h, u.x);

  let y0 = mix(x00, x10, u.y);
  let y1 = mix(x01, x11, u.y);

  return mix(y0, y1, u.z);
}

fn fbm3(p0: vec3<f32>) -> f32 {
  var p = p0;
  var amp = 0.5;
  var sum = 0.0;

  let octaves = select(3u, select(4u, select(5u, 6u, QUALITY >= 3u), QUALITY >= 2u), QUALITY >= 1u);
  for (var i: u32 = 0u; i < 6u; i = i + 1u) {
    if (i >= octaves) { break; }
    sum = sum + amp * valueNoise3(p);
    p = p * 2.02 + vec3<f32>(17.0, 31.0, 11.0);
    amp = amp * 0.5;
  }
  return sum;
}

fn slog2(x: f32) -> f32 {
  return sign(x) * log2(1.0 + abs(x));
}

fn pitchSpace(x: f32) -> f32 {
  return slog2(x * 2.4);
}

fn starLayer(uv: vec2<f32>, scale: f32, brightness: f32, t: f32) -> f32 {
  let p = uv * scale;
  let id = floor(p);
  let local = fract(p) - 0.5;

  var col = 0.0;
  for (var y: i32 = -1; y <= 1; y = y + 1) {
    for (var x: i32 = -1; x <= 1; x = x + 1) {
      let neighbor = vec2<f32>(f32(x), f32(y));
      let cellId = id + neighbor;
      let n = hash12(cellId);

      if (n > 0.935) {
        let n2 = fract(n * 173.3);
        let offset = vec2<f32>(n, n2) - 0.5;
        let d = length(local - neighbor - offset * 0.75);
        let size = 0.02 + 0.08 * (n - 0.935) * 14.0;
        let core = max(0.0, 1.0 - d / size);
        let star = pow(core, 6.0);
        let blink = 0.6 + 0.4 * sin(t * (1.3 + n * 2.1) + n * 50.0);
        col = col + star * blink * brightness;
      }
    }
  }
  return col;
}

fn ramp(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.01, 0.02, 0.04);
  let b = vec3<f32>(0.06, 0.22, 0.30);
  let c = vec3<f32>(0.30, 0.12, 0.36);
  let d = vec3<f32>(0.92, 0.50, 0.18);

  let t1 = smoothstep(0.0, 0.55, t);
  let t2 = smoothstep(0.25, 0.95, t);
  return mix(mix(a, b, t1), mix(c, d, t2), t2 * 0.8);
}

fn acesTonemap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3<f32>(b))) / (x * (c * x + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

struct VolResult {
  col: vec3<f32>,
  trans: f32,
  dens: f32,
};

fn hgPhase(cosTheta: f32, g: f32) -> f32 {
  let gg = g * g;
  return (1.0 - gg) / pow(1.0 + gg - 2.0 * g * cosTheta, 1.5);
}

fn nebulaDensity(pos: vec3<f32>, t: f32) -> f32 {
  let drift = vec3<f32>(0.07 * t, -0.05 * t, 0.03 * t) * G.parallax;
  let p = pos + drift;

  let w = fbm3(p * 0.9 + vec3<f32>(3.1, -2.7, 1.9));
  let w2 = fbm3(p * 0.9 + vec3<f32>(6.2, 1.3, 4.7));
  let w3 = valueNoise3(p * 0.9 + vec3<f32>(-1.2, 7.1, -3.4));
  let q = p + 0.45 * vec3<f32>(w - 0.5, w2 - 0.5, w3 - 0.5);

  var d = fbm3(q * 1.35);
  d = smoothstep(0.22, 0.92, d);

  let holes = valueNoise3(q * 2.4 + vec3<f32>(9.0, 2.0, 5.0));
  d = d * smoothstep(0.15, 0.65, holes);

  return d;
}

fn renderNebula(rayOrigin: vec3<f32>, rayDir: vec3<f32>, t: f32) -> VolResult {
  let steps = select(5u, select(7u, select(10u, 12u, QUALITY >= 3u), QUALITY >= 2u), QUALITY >= 1u);
  let tMin = 0.2;
  let tMax = 2.8;
  let dt = (tMax - tMin) / f32(steps);
  let L1 = normalize(vec3<f32>(0.6, 0.2, 0.75));
  let L2 = normalize(vec3<f32>(-0.4, 0.3, 0.85));

  var col = vec3<f32>(0.0);
  var trans = 1.0;
  var densAcc = 0.0;

  for (var i: u32 = 0u; i < 12u; i = i + 1u) {
    if (i >= steps) { break; }

    let tt = tMin + dt * (f32(i) + 0.5);
    let pos = rayOrigin + rayDir * tt;
    let d = nebulaDensity(pos * 1.15, t);
    let density = d * 1.25;
    let absorb = exp(-density * 1.35 * dt);
    let cos1 = dot(rayDir, L1);
    let cos2 = dot(rayDir, L2);
    let phase = 0.55 * hgPhase(cos1, 0.35) + 0.45 * hgPhase(cos2, 0.2);

    var emit = ramp(d);
    let glow = 0.35 + 1.25 * phase;
    emit = emit * glow;

    let a = 1.0 - absorb;
    col = col + trans * a * emit;
    trans = trans * absorb;
    densAcc = densAcc + density * dt;

    if (trans < 0.03) { break; }
  }

  return VolResult(col, trans, densAcc);
}

fn microHeight(uv: vec2<f32>, t: f32) -> f32 {
  let aspect = G.resolution.x / max(G.resolution.y, 1.0);
  let centred = uv - vec2<f32>(0.5, 0.5);
  let xLin = centred.x * aspect * 2.0;
  let xSpace = mix(xLin, pitchSpace(xLin), 0.16);
  let p = vec2<f32>(xSpace, centred.y * 2.0);
  let drift = vec2<f32>(0.015 * t, -0.01 * t) * G.parallax;
  let n = valueNoise2(p * 6.0 + drift + vec2<f32>(G.seed * 3.0, 1.7));
  let m = valueNoise2(p * 12.0 - drift * 1.4 + vec2<f32>(2.3, G.seed * 2.0));
  return 0.65 * n + 0.35 * m;
}

fn microNormal(uv: vec2<f32>, t: f32) -> vec3<f32> {
  let h = microHeight(uv, t);
  let dx = dpdx(h);
  let dy = dpdy(h);
  let s = select(0.55, select(0.75, select(0.95, 1.1, QUALITY >= 3u), QUALITY >= 2u), QUALITY >= 1u);
  return normalize(vec3<f32>(-dx * s, -dy * s, 1.0));
}

fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let aspect = G.resolution.x / max(G.resolution.y, 1.0);
  let t = G.time;

  let centred = uv - vec2<f32>(0.5, 0.5);
  let p = vec2<f32>(centred.x * aspect, centred.y);
  let ro = vec3<f32>(0.0, 0.0, -2.2);
  let rd = normalize(vec3<f32>(p.x * 1.15, p.y * 1.15, 1.0));
  let N = microNormal(uv, t);
  let refrStrength = select(0.01, select(0.015, select(0.02, 0.024, QUALITY >= 3u), QUALITY >= 2u), QUALITY >= 1u);
  let refrUv = uv + N.xy * refrStrength;
  let centredR = refrUv - vec2<f32>(0.5, 0.5);
  let pR = vec2<f32>(centredR.x * aspect, centredR.y);
  let rdR = normalize(vec3<f32>(pR.x * 1.15, pR.y * 1.15, 1.0));
  let vol = renderNebula(ro, rdR, t);
  let starUV = vec2<f32>(refrUv.x * aspect, refrUv.y);
  let starShift = vec2<f32>(t * 0.006, 0.0) * G.parallax;

  var stars = starLayer(starUV + starShift, 12.0, 1.1, t);
  if (QUALITY >= 2u) {
    stars = stars + starLayer(starUV + starShift * 0.5 + vec2<f32>(5.2, 1.3), 28.0, 0.55, t);
  }
  if (QUALITY >= 3u) {
    stars = stars + starLayer(starUV - starShift * 0.25 + vec2<f32>(9.1, 4.8), 42.0, 0.35, t);
  }

  let V = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let cosVN = clamp(dot(N, V), 0.0, 1.0);
  let F = fresnelSchlick(cosVN, 0.035);
  var col = vol.col + vec3<f32>(stars);

  if (QUALITY >= 1u) {
    let disp = 0.65 * refrStrength;
    let chromaStrength = disp * (0.35 + 0.65 * clamp(vol.dens, 0.0, 1.0));
    let shift = clamp((N.x + N.y) * 0.5, -1.0, 1.0);
    let chroma = vec3<f32>(
      1.0 + chromaStrength * shift * 2.2,
      1.0,
      1.0 - chromaStrength * shift * 2.2
    );
    col = col * chroma + vec3<f32>(stars);
  }

  let reflectTint = vec3<f32>(0.55, 0.75, 1.0);
  col = col + F * 0.45 * reflectTint;

  let r = length(centred);
  let vignette = smoothstep(0.88, 0.22, r);
  col = col * vignette;

  let th = 1.15;
  let hi = max(vec3<f32>(0.0), col - vec3<f32>(th));
  col = col + hi * hi * 0.85;

  let px = uv * G.resolution;
  let grain = (hash12(px * 0.5 + vec2<f32>(t * 10.0, -t * 7.0)) - 0.5) * 0.02;
  col = col + vec3<f32>(grain);
  col = acesTonemap(col);
  col = mix(vec3<f32>(0.0), col, clamp(G.intensity, 0.0, 2.0));

  return vec4<f32>(col, 1.0);
}
`;

const QUALITY_SETTINGS = {
  low: {
    label: "Low",
    shaderQuality: 0,
    resolutionScale: 0.5,
    rayMarchSteps: 5,
    noiseOctaves: 3,
    starLayers: 1,
  },
  medium: {
    label: "Medium",
    shaderQuality: 1,
    resolutionScale: 0.66,
    rayMarchSteps: 7,
    noiseOctaves: 4,
    starLayers: 1,
  },
  high: {
    label: "High",
    shaderQuality: 2,
    resolutionScale: 0.82,
    rayMarchSteps: 10,
    noiseOctaves: 5,
    starLayers: 2,
  },
  ultra: {
    label: "Ultra",
    shaderQuality: 3,
    resolutionScale: 1,
    rayMarchSteps: 12,
    noiseOctaves: 6,
    starLayers: 3,
  },
} as const;

export type LivingGlassQuality = keyof typeof QUALITY_SETTINGS;
type ShaderQuality = (typeof QUALITY_SETTINGS)[LivingGlassQuality]["shaderQuality"];

export const DEFAULT_LIVING_GLASS_QUALITY: LivingGlassQuality = "medium";

export const LIVING_GLASS_QUALITY_LEVELS = Object.entries(QUALITY_SETTINGS).map(
  ([id, settings]) => ({
    id: id as LivingGlassQuality,
    label: settings.label,
    resolutionScale: settings.resolutionScale,
    rayMarchSteps: settings.rayMarchSteps,
    noiseOctaves: settings.noiseOctaves,
    starLayers: settings.starLayers,
  }),
);

export interface LivingGlassRenderer {
  destroy: () => void;
  setQuality: (quality: LivingGlassQuality) => void;
}

interface LivingGlassOptions {
  quality: LivingGlassQuality;
  intensity: number;
  parallax: number;
  seed: number;
}

const DEFAULT_OPTIONS: LivingGlassOptions = {
  quality: DEFAULT_LIVING_GLASS_QUALITY,
  intensity: 1,
  parallax: 0.8,
  seed: 1,
};

export function normalizeLivingGlassQuality(value: string): LivingGlassQuality {
  return value in QUALITY_SETTINGS ? (value as LivingGlassQuality) : DEFAULT_LIVING_GLASS_QUALITY;
}

export async function startLivingGlassRenderer(
  canvas: HTMLCanvasElement,
  options: Partial<LivingGlassOptions> = {},
): Promise<LivingGlassRenderer> {
  if (!navigator.gpu) {
    throw new Error(
      "This browser does not expose navigator.gpu. The living glass study needs a WebGPU-capable browser.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });

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
  const opts: LivingGlassOptions = { ...DEFAULT_OPTIONS, ...options };
  const uniformBuffer = device.createBuffer({
    label: "living glass uniforms",
    size: 16 * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const shaderModule = device.createShaderModule({
    label: "living glass shader",
    code: livingGlassShader,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: "living glass bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform",
        },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "living glass pipeline layout",
    bindGroupLayouts: [bindGroupLayout],
  });
  const bindGroup = device.createBindGroup({
    label: "living glass bind group",
    layout: bindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });
  const pipelines = new Map<LivingGlassQuality, GPURenderPipeline>();

  device.pushErrorScope("validation");
  for (const { id } of LIVING_GLASS_QUALITY_LEVELS) {
    pipelines.set(
      id,
      createPipeline(
        device,
        shaderModule,
        pipelineLayout,
        format,
        QUALITY_SETTINGS[id].shaderQuality,
      ),
    );
  }
  const setupError = await device.popErrorScope();

  if (setupError) {
    uniformBuffer.destroy();
    throw new Error(`Living glass WebGPU setup failed: ${setupError.message}`);
  }

  const uniforms = new Float32Array(16);
  const abortController = new AbortController();
  let quality = opts.quality;
  let widthPx = 1;
  let heightPx = 1;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  window.addEventListener("resize", scheduleFrame, { signal: abortController.signal });
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        if (animationFrame !== 0) {
          cancelAnimationFrame(animationFrame);
          animationFrame = 0;
        }
        return;
      }

      scheduleFrame();
    },
    { signal: abortController.signal },
  );

  function configureContext(): void {
    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });
  }

  function resizeCanvas(): boolean {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = QUALITY_SETTINGS[quality].resolutionScale;
    const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio * scale));
    const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio * scale));

    if (canvas.width === width && canvas.height === height) {
      return false;
    }

    widthPx = width;
    heightPx = height;
    canvas.width = width;
    canvas.height = height;
    return true;
  }

  function frame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    if (resizeCanvas()) {
      configureContext();
    }

    uniforms[0] = widthPx;
    uniforms[1] = heightPx;
    uniforms[2] = time * 0.001;
    uniforms[3] = opts.intensity;
    uniforms[4] = opts.seed;
    uniforms[5] = opts.parallax;
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const pipeline = pipelines.get(quality);

    if (!pipeline) {
      throw new Error(`Missing living glass pipeline for quality "${quality}".`);
    }

    const encoder = device.createCommandEncoder({
      label: "living glass frame encoder",
    });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const pass = encoder.beginRenderPass({
      label: "living glass render pass",
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    device.queue.submit([encoder.finish()]);

    if (!checkedFirstFrame) {
      checkedFirstFrame = true;
      void device.popErrorScope().then((frameError) => {
        if (frameError) {
          console.error(`Living glass WebGPU frame failed: ${frameError.message}`);
        }
      });
    }

    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || document.hidden || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  resizeCanvas();
  configureContext();
  scheduleFrame();

  return {
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

      pipelines.clear();
      uniformBuffer.destroy();
    },
    setQuality: (nextQuality: LivingGlassQuality) => {
      if (!active || nextQuality === quality) {
        return;
      }

      quality = nextQuality;

      if (resizeCanvas()) {
        configureContext();
      }
    },
  };
}

function createPipeline(
  device: GPUDevice,
  module: GPUShaderModule,
  layout: GPUPipelineLayout,
  format: GPUTextureFormat,
  shaderQuality: ShaderQuality,
): GPURenderPipeline {
  return device.createRenderPipeline({
    label: `living glass pipeline q${shaderQuality}`,
    layout,
    vertex: {
      module,
      entryPoint: "vsMain",
    },
    fragment: {
      module,
      entryPoint: "fsMain",
      targets: [{ format }],
      constants: {
        QUALITY: shaderQuality,
      },
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}
