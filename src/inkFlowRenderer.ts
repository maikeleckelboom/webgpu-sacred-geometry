import { defaultVisualControls } from "./visualControls";
import inkComputeShaderSource from "./shaders/ink-compute.wgsl?raw";
import inkParticlesShaderSource from "./shaders/ink-particles.wgsl?raw";
import inkAccumulationShaderSource from "./shaders/ink-accumulation.wgsl?raw";
import inkPostShaderSource from "./shaders/ink-post.wgsl?raw";

const FLOW_POINTER_CONTROLS = defaultVisualControls.pointer.flow;
const PARTICLE_COUNT = 30000;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 12;
const UNIFORM_FLOATS = 24;
const TRAIL_DECAY = 0.93;
const INK_STRENGTH = 0.78;
const REDUCED_MOTION_SCALE = defaultVisualControls.flow.reducedMotionScale;

const PRESSURE_CHARGE_RATE = FLOW_POINTER_CONTROLS.pressureChargeRate;
const PRESSURE_RELEASE_RATE = FLOW_POINTER_CONTROLS.pressureReleaseRate;

interface PointerState {
  x: number;
  y: number;
  strength: number;
  active: boolean;
  pressed: boolean;
  pressure: number;
}

export interface InkFlowRenderer {
  destroy: () => void;
}

export async function startInkFlowRenderer(canvas: HTMLCanvasElement): Promise<InkFlowRenderer> {
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
  const offscreenFormat: GPUTextureFormat = "rgba16float";
  device.addEventListener("uncapturederror", (event) => {
    console.error(`Ink WebGPU error: ${event.error.message}`);
  });
  device.pushErrorScope("validation");

  const particleData = createInitialParticles(PARTICLE_COUNT);
  const particleBuffers = [
    createStorageBuffer(device, "ink particles A", particleData.byteLength),
    createStorageBuffer(device, "ink particles B", particleData.byteLength),
  ];
  device.queue.writeBuffer(particleBuffers[0], 0, particleData);
  device.queue.writeBuffer(particleBuffers[1], 0, particleData);

  const simBuffer = device.createBuffer({
    label: "ink simulation uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderBuffer = device.createBuffer({
    label: "ink render uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const accumBuffer = device.createBuffer({
    label: "ink accumulation uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const computeModule = device.createShaderModule({
    label: "ink compute shader",
    code: inkComputeShaderSource,
  });
  const renderModule = device.createShaderModule({
    label: "ink particle render shader",
    code: inkParticlesShaderSource,
  });
  const accumModule = device.createShaderModule({
    label: "ink accumulation shader",
    code: inkAccumulationShaderSource,
  });
  const postModule = device.createShaderModule({
    label: "ink post shader",
    code: inkPostShaderSource,
  });

  const computePipeline = device.createComputePipeline({
    label: "ink compute pipeline",
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
    "ink line pipeline",
  );
  const accumPipeline = device.createRenderPipeline({
    label: "ink accumulation pipeline",
    layout: "auto",
    vertex: {
      module: accumModule,
      entryPoint: "vertexMain",
    },
    fragment: {
      module: accumModule,
      entryPoint: "fragmentMain",
      targets: [{ format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const postPipeline = device.createRenderPipeline({
    label: "ink post pipeline",
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
    createComputeBindGroup(device, computePipeline, particleBuffers[0], particleBuffers[1], simBuffer),
    createComputeBindGroup(device, computePipeline, particleBuffers[1], particleBuffers[0], simBuffer),
  ];
  const lineBindGroups = [
    createRenderBindGroup(device, linePipeline, particleBuffers[0], renderBuffer),
    createRenderBindGroup(device, linePipeline, particleBuffers[1], renderBuffer),
  ];
  const setupError = await device.popErrorScope();

  if (setupError) {
    throw new Error(`Ink WebGPU setup failed: ${setupError.message}`);
  }

  const linearSampler = device.createSampler({
    label: "ink post sampler",
    magFilter: "linear",
    minFilter: "linear",
  });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pointer: PointerState = {
    x: 0,
    y: 0,
    strength: 0,
    active: false,
    pressed: false,
    pressure: 0,
  };
  const simUniforms = new Float32Array(UNIFORM_FLOATS);
  const renderUniforms = new Float32Array(UNIFORM_FLOATS);
  const accumUniforms = new Float32Array(UNIFORM_FLOATS);
  const abortController = new AbortController();
  let sceneTexture: GPUTexture | null = null;
  let historyA: GPUTexture | null = null;
  let historyB: GPUTexture | null = null;
  let historyViewA: GPUTextureView | null = null;
  let historyViewB: GPUTextureView | null = null;
  let sourceIndex = 0;
  let historyIndex = 0;
  let lastTime = 0;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  function updatePointerFromClient(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect();

    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      pointer.active = false;
      return false;
    }

    pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = (1 - (clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
    pointer.active = true;
    return true;
  }

  canvas.addEventListener(
    "pointermove",
    (event) => {
      updatePointerFromClient(event.clientX, event.clientY);
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerenter",
    (event) => {
      updatePointerFromClient(event.clientX, event.clientY);
    },
    { signal: abortController.signal },
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      updatePointerFromClient(event.clientX, event.clientY);
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) {
        return;
      }
      updatePointerFromClient(event.clientX, event.clientY);
      pointer.pressed = true;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is optional; the press still ramps via local listeners.
      }
    },
    { signal: abortController.signal },
  );
  const releasePointer = (): void => {
    pointer.pressed = false;
  };
  canvas.addEventListener("pointerup", releasePointer, { signal: abortController.signal });
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.active = false;
      pointer.pressed = false;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointercancel",
    () => {
      pointer.active = false;
      pointer.pressed = false;
    },
    { signal: abortController.signal },
  );
  window.addEventListener(
    "blur",
    () => {
      pointer.active = false;
      pointer.pressed = false;
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
    if (!resizeCanvas(canvas) && sceneTexture && historyA && historyB) {
      return;
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    sceneTexture?.destroy();
    historyA?.destroy();
    historyB?.destroy();

    const size = { width: canvas.width, height: canvas.height };

    sceneTexture = device.createTexture({
      label: "ink scene texture",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    historyA = device.createTexture({
      label: "ink history A",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    historyB = device.createTexture({
      label: "ink history B",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    historyViewA = historyA.createView();
    historyViewB = historyB.createView();

    const clearEncoder = device.createCommandEncoder({ label: "ink initial history clear" });
    const clearPass = clearEncoder.beginRenderPass({
      label: "ink initial history clear",
      colorAttachments: [
        {
          view: historyViewA,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
        {
          view: historyViewB,
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    clearPass.end();
    device.queue.submit([clearEncoder.finish()]);
  }

  function frame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    refreshTargets();

    if (!sceneTexture || !historyA || !historyB || !historyViewA || !historyViewB) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const deltaTime = lastTime > 0 ? Math.min(seconds - lastTime, 0.066) : 1 / 60;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? REDUCED_MOTION_SCALE : 1;
    if (pointer.active) {
      pointer.strength = Math.min(
        1,
        pointer.strength +
          (pointer.pressed
            ? FLOW_POINTER_CONTROLS.pressedStrengthGain
            : FLOW_POINTER_CONTROLS.activeStrengthGain),
      );
    } else {
      pointer.strength *= reducedMotion
        ? FLOW_POINTER_CONTROLS.reducedMotionIdleDecay
        : FLOW_POINTER_CONTROLS.idleDecay;
    }
    const chargeRate = reducedMotion
      ? PRESSURE_CHARGE_RATE * FLOW_POINTER_CONTROLS.pressureChargeReducedMotionScale
      : PRESSURE_CHARGE_RATE;
    const releaseRate = reducedMotion
      ? PRESSURE_RELEASE_RATE * FLOW_POINTER_CONTROLS.pressureReleaseReducedMotionScale
      : PRESSURE_RELEASE_RATE;
    if (pointer.pressed && pointer.active) {
      pointer.pressure = Math.min(1, pointer.pressure + deltaTime * chargeRate);
    } else {
      pointer.pressure = Math.max(0, pointer.pressure - deltaTime * releaseRate);
    }
    lastTime = seconds;

    simUniforms.set([
      deltaTime,
      seconds,
      aspect,
      motion,
      pointer.x,
      pointer.y,
      pointer.strength,
      pointer.pressure,
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
      pointer.pressure,
      INK_STRENGTH,
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
    ]);
    device.queue.writeBuffer(simBuffer, 0, simUniforms);
    device.queue.writeBuffer(renderBuffer, 0, renderUniforms);
    device.queue.writeBuffer(accumBuffer, 0, accumUniforms);

    const targetIndex = 1 - sourceIndex;
    const historyRead = historyIndex;
    const historyWrite = 1 - historyIndex;
    const encoder = device.createCommandEncoder({
      label: "ink frame encoder",
    });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const computePass = encoder.beginComputePass({
      label: "ink compute pass",
    });
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroups[sourceIndex]);
    computePass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
    computePass.end();

    const scenePass = encoder.beginRenderPass({
      label: "ink scene pass",
      colorAttachments: [
        {
          view: sceneTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    scenePass.setPipeline(linePipeline);
    scenePass.setBindGroup(0, lineBindGroups[targetIndex]);
    scenePass.draw(6, PARTICLE_COUNT);
    scenePass.end();

    const accumReadView = historyRead === 0 ? historyViewA : historyViewB;
    const accumWriteTexture = historyWrite === 0 ? historyA : historyB;
    const accumWriteView = historyWrite === 0 ? historyViewA : historyViewB;

    if (accumReadView && accumWriteTexture && accumWriteView) {
      const accumBindGroup = device.createBindGroup({
        label: "ink accum pass bind group",
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: accumReadView },
          { binding: 2, resource: sceneTexture.createView() },
          { binding: 3, resource: { buffer: accumBuffer } },
        ],
      });
      const accumPass = encoder.beginRenderPass({
        label: "ink accumulation pass",
        colorAttachments: [
          {
            view: accumWriteTexture.createView(),
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

      const postBindGroup = device.createBindGroup({
        label: "ink post bind group",
        layout: postPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: accumWriteView },
          { binding: 2, resource: { buffer: renderBuffer } },
        ],
      });
      const postPass = encoder.beginRenderPass({
        label: "ink post pass",
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
    }

    device.queue.submit([encoder.finish()]);

    if (!checkedFirstFrame) {
      checkedFirstFrame = true;
      void device.popErrorScope().then((frameError) => {
        if (frameError) {
          console.error(`Ink WebGPU frame failed: ${frameError.message}`);
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

  const renderer: InkFlowRenderer = {
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
      historyA?.destroy();
      historyB?.destroy();
      particleBuffers[0].destroy();
      particleBuffers[1].destroy();
      simBuffer.destroy();
      renderBuffer.destroy();
      accumBuffer.destroy();
      device.destroy();
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
    label: "ink compute bind group",
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
    label: "ink render bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: particles } },
      { binding: 1, resource: { buffer: uniforms } },
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

    particles[offset] = lerp(-1.08, 1.55, hash(seed));
    particles[offset + 1] = lerp(-1.15, 1.15, hash(seed * 2.31));
    particles[offset + 2] = lerp(0.02, 0.14, hash(seed * 3.73));
    particles[offset + 3] = lerp(-0.08, 0.08, hash(seed * 5.19));
    particles[offset + 4] = seed;
    particles[offset + 5] = depth;
    particles[offset + 6] = hash(seed * 11.7) * lerp(7, 14, depth);
    particles[offset + 7] = lerp(-1, 1, hash(seed * 13.3));
    particles[offset + 8] = 0;
    particles[offset + 9] = 0;
    particles[offset + 10] = 0;
    particles[offset + 11] = 0;
  }

  return particles;
}

function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    defaultVisualControls.performance.maxPixelRatio.flow,
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
