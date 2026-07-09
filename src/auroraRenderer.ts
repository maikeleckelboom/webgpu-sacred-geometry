import { defaultVisualControls } from "./visualControls";
import auroraComputeShaderSource from "./shaders/aurora-compute.wgsl?raw";
import auroraParticlesShaderSource from "./shaders/aurora-particles.wgsl?raw";
import auroraPostShaderSource from "./shaders/aurora-post.wgsl?raw";

const AURORA_POINTER_CONTROLS = defaultVisualControls.pointer.aurora;
const PARTICLE_COUNT = defaultVisualControls.particles.auroraCount;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 8;
const UNIFORM_FLOATS = 12;

interface PointerState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  strength: number;
}

export interface AuroraRenderer {
  destroy: () => void;
}

export async function startAuroraRenderer(canvas: HTMLCanvasElement): Promise<AuroraRenderer> {
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
  const format = navigator.gpu.getPreferredCanvasFormat();
  device.addEventListener("uncapturederror", (event) => {
    console.error(`Flow WebGPU error: ${event.error.message}`);
  });
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
  const computeModule = device.createShaderModule({
    label: "flow compute shader",
    code: auroraComputeShaderSource,
  });
  const renderModule = device.createShaderModule({
    label: "flow particle render shader",
    code: auroraParticlesShaderSource,
  });
  const postModule = device.createShaderModule({
    label: "flow post shader",
    code: auroraPostShaderSource,
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
    format,
    "lineVertex",
    "lineFragment",
    "flow line pipeline",
  );
  const spritePipeline = createParticlePipeline(
    device,
    renderModule,
    format,
    "spriteVertex",
    "spriteFragment",
    "flow sprite pipeline",
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

  const sampler = device.createSampler({
    label: "flow post sampler",
    magFilter: "linear",
    minFilter: "linear",
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer: PointerState = {
    x: defaultVisualControls.sky.auroraPointerHome[0],
    y: defaultVisualControls.sky.auroraPointerHome[1],
    targetX: defaultVisualControls.sky.auroraPointerHome[0],
    targetY: defaultVisualControls.sky.auroraPointerHome[1],
    strength: 0,
  };
  const simUniforms = new Float32Array(UNIFORM_FLOATS);
  const renderUniforms = new Float32Array(UNIFORM_FLOATS);
  const abortController = new AbortController();
  let offscreenTexture: GPUTexture | null = null;
  let postBindGroup: GPUBindGroup | null = null;
  let sourceIndex = 0;
  let lastTime = 0;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.targetX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.targetY = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.strength = Math.min(1, pointer.strength + AURORA_POINTER_CONTROLS.moveStrengthGain);
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.targetX = defaultVisualControls.sky.auroraPointerHome[0];
      pointer.targetY = defaultVisualControls.sky.auroraPointerHome[1];
      pointer.strength = Math.min(pointer.strength, AURORA_POINTER_CONTROLS.leaveStrengthCap);
    },
    { signal: abortController.signal },
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden && animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else {
        scheduleFrame();
      }
    },
    { signal: abortController.signal },
  );

  function refreshTargets(): void {
    if (!resizeCanvas(canvas) && offscreenTexture && postBindGroup) {
      return;
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    offscreenTexture?.destroy();
    offscreenTexture = device.createTexture({
      label: "flow offscreen texture",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    postBindGroup = device.createBindGroup({
      label: "flow post bind group",
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: sampler,
        },
        {
          binding: 1,
          resource: offscreenTexture.createView(),
        },
        {
          binding: 2,
          resource: {
            buffer: renderBuffer,
          },
        },
      ],
    });
  }

  function frame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    refreshTargets();

    if (!offscreenTexture || !postBindGroup) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const deltaTime = lastTime > 0 ? seconds - lastTime : 1 / 60;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? AURORA_POINTER_CONTROLS.reducedMotionScale : 1;
    pointer.x += (pointer.targetX - pointer.x) * AURORA_POINTER_CONTROLS.lerpRate;
    pointer.y += (pointer.targetY - pointer.y) * AURORA_POINTER_CONTROLS.lerpRate;
    pointer.strength *= reducedMotion
      ? AURORA_POINTER_CONTROLS.reducedMotionIdleDecay
      : AURORA_POINTER_CONTROLS.idleDecay;
    lastTime = seconds;

    simUniforms.set([
      deltaTime,
      seconds,
      aspect,
      motion,
      pointer.x,
      pointer.y,
      pointer.strength,
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
      1,
      0,
      0,
    ]);
    device.queue.writeBuffer(simBuffer, 0, simUniforms);
    device.queue.writeBuffer(renderBuffer, 0, renderUniforms);

    const targetIndex = 1 - sourceIndex;
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
          view: offscreenTexture.createView(),
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
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  const renderer: AuroraRenderer = {
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

      offscreenTexture?.destroy();
      particleBuffers[0].destroy();
      particleBuffers[1].destroy();
      simBuffer.destroy();
      renderBuffer.destroy();
    },
  };

  scheduleFrame();
  return renderer;
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
      {
        binding: 0,
        resource: {
          buffer: source,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: target,
        },
      },
      {
        binding: 2,
        resource: {
          buffer: uniforms,
        },
      },
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
      {
        binding: 0,
        resource: {
          buffer: particles,
        },
      },
      {
        binding: 1,
        resource: {
          buffer: uniforms,
        },
      },
    ],
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
      ],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
}

function createInitialParticles(count: number): Float32Array {
  const particles = new Float32Array(count * FLOATS_PER_PARTICLE);

  for (let index = 0; index < count; index += 1) {
    const seed = index * 0.61803398875 + 0.123;
    const offset = index * FLOATS_PER_PARTICLE;
    const depth = hash(seed * 7.41);
    const lifetime = lerp(10, 20, hash(seed * 3.91));

    particles[offset] = lerp(-0.92, 1.46, hash(seed));
    particles[offset + 1] = lerp(-1.12, 1.1, hash(seed * 2.31));
    particles[offset + 2] = lerp(0.04, 0.18, hash(seed * 3.73));
    particles[offset + 3] = lerp(-0.11, 0.12, hash(seed * 5.19));
    particles[offset + 4] = seed;
    particles[offset + 5] = depth;
    particles[offset + 6] = hash(seed * 11.7) * lifetime;
    particles[offset + 7] = lerp(-1, 1, hash(seed * 13.3));
  }

  return particles;
}

function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    defaultVisualControls.performance.maxPixelRatio.aurora,
  );
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
