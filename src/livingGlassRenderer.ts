import { defaultVisualControls } from "./visualControls";
import livingGlassShaderSource from "./shaders/living-glass.wgsl?raw";

const LIVING_GLASS_CONTROLS = defaultVisualControls.sky.livingGlass;
const QUALITY_SETTINGS = LIVING_GLASS_CONTROLS.qualitySettings;

export type LivingGlassQuality = keyof typeof QUALITY_SETTINGS;
type ShaderQuality = (typeof QUALITY_SETTINGS)[LivingGlassQuality]["shaderQuality"];

export const DEFAULT_LIVING_GLASS_QUALITY: LivingGlassQuality =
  LIVING_GLASS_CONTROLS.defaultOptions.quality;

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

const DEFAULT_OPTIONS: LivingGlassOptions = LIVING_GLASS_CONTROLS.defaultOptions;

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
    code: livingGlassShaderSource,
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
    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      defaultVisualControls.performance.maxPixelRatio.livingGlass,
    );
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
