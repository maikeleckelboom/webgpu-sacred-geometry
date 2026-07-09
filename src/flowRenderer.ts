import { defaultVisualControls } from "./visualControls";
import flowComputeShaderSource from "./shaders/flow-compute.wgsl?raw";
import flowParticlesShaderSource from "./shaders/flow-particles.wgsl?raw";
import flowAccumulationShaderSource from "./shaders/flow-accumulation.wgsl?raw";
import flowBloomShaderSource from "./shaders/flow-bloom.wgsl?raw";
import flowPostShaderSource from "./shaders/flow-post.wgsl?raw";

const FLOW_CONTROLS = defaultVisualControls.flow;
const FLOW_POINTER_CONTROLS = defaultVisualControls.pointer.flow;
const FLOW_BLOOM_CONTROLS = defaultVisualControls.bloom.flow;
const PARTICLE_COUNT = defaultVisualControls.particles.flowCount;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 12;
const UNIFORM_FLOATS = 24;
const TRAIL_DECAY = defaultVisualControls.particles.flowTrailDecay;

const BLOOM_LEVELS = FLOW_BLOOM_CONTROLS.levels;
const BLOOM_BASE_MAX = FLOW_BLOOM_CONTROLS.baseMax;
const BLOOM_THRESHOLD = FLOW_BLOOM_CONTROLS.threshold;
const BLOOM_SOFT_KNEE = FLOW_BLOOM_CONTROLS.softKnee;
const BLOOM_INTENSITY = FLOW_BLOOM_CONTROLS.intensity;
const BLOOM_EXPOSURE = FLOW_BLOOM_CONTROLS.exposure;
const BLOOM_SHADING = FLOW_BLOOM_CONTROLS.shadingStrength;

const PRESSURE_CHARGE_RATE = FLOW_POINTER_CONTROLS.pressureChargeRate;
const PRESSURE_RELEASE_RATE = FLOW_POINTER_CONTROLS.pressureReleaseRate;

function bloomCurve(threshold: number, softKnee: number): {
  curve: [number, number, number, number];
} {
  const knee = threshold * softKnee + 0.0001;
  return { curve: [threshold - knee, knee * 2, 0.25 / knee, 0] };
}

export type FieldMode = "flow" | "topo" | "arch" | "waves";

const MODE_INDEX: Record<FieldMode, number> = {
  flow: 0,
  topo: 2,
  arch: 3,
  waves: 4,
};

interface PointerState {
  x: number;
  y: number;
  strength: number;
  active: boolean;
  pressed: boolean;
  pressure: number;
}

export interface FlowFieldRenderer {
  destroy: () => void;
  setMode: (mode: FieldMode) => void;
}

export async function startFlowFieldRenderer(
  canvas: HTMLCanvasElement,
): Promise<FlowFieldRenderer> {
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
  const accumBuffer = device.createBuffer({
    label: "flow accumulation uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const bloomPrefBuffer = device.createBuffer({
    label: "flow bloom prefilter uniforms",
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const prefCurve = bloomCurve(BLOOM_THRESHOLD, BLOOM_SOFT_KNEE).curve;
  const bloomPrefUniforms = new Float32Array([
    prefCurve[0],
    prefCurve[1],
    prefCurve[2],
    BLOOM_THRESHOLD,
  ]);
  device.queue.writeBuffer(bloomPrefBuffer, 0, bloomPrefUniforms);
  const computeModule = device.createShaderModule({
    label: "flow compute shader",
    code: flowComputeShaderSource,
  });
  const renderModule = device.createShaderModule({
    label: "flow particle render shader",
    code: flowParticlesShaderSource,
  });
  const accumModule = device.createShaderModule({
    label: "flow accumulation shader",
    code: flowAccumulationShaderSource,
  });
  const postModule = device.createShaderModule({
    label: "flow post shader",
    code: flowPostShaderSource,
  });
  const bloomModule = device.createShaderModule({
    label: "flow bloom shader",
    code: flowBloomShaderSource,
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
    offscreenFormat,
    "lineVertex",
    "lineFragment",
    "flow line pipeline",
  );
  const spritePipeline = createParticlePipeline(
    device,
    renderModule,
    offscreenFormat,
    "spriteVertex",
    "spriteFragment",
    "flow sprite pipeline",
  );
  const accumPipeline = device.createRenderPipeline({
    label: "flow accumulation pipeline",
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
  const bloomPrefilterPipeline = device.createRenderPipeline({
    label: "flow bloom prefilter pipeline",
    layout: "auto",
    vertex: {
      module: bloomModule,
      entryPoint: "bloomVertex",
    },
    fragment: {
      module: bloomModule,
      entryPoint: "bloomPrefilter",
      targets: [{ format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const bloomDownPipeline = device.createRenderPipeline({
    label: "flow bloom downsample pipeline",
    layout: "auto",
    vertex: {
      module: bloomModule,
      entryPoint: "bloomVertex",
    },
    fragment: {
      module: bloomModule,
      entryPoint: "bloomDownsample",
      targets: [{ format: offscreenFormat }],
    },
    primitive: {
      topology: "triangle-list",
    },
  });
  const bloomUpPipeline = device.createRenderPipeline({
    label: "flow bloom upsample pipeline",
    layout: "auto",
    vertex: {
      module: bloomModule,
      entryPoint: "bloomVertex",
    },
    fragment: {
      module: bloomModule,
      entryPoint: "bloomUpsample",
      targets: [{ format: offscreenFormat }],
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

  const linearSampler = device.createSampler({
    label: "flow post sampler",
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
  const targetWeights = [1, 0, 0, 0, 0];
  const currentWeights = [1, 0, 0, 0, 0];
  const abortController = new AbortController();
  let sceneTexture: GPUTexture | null = null;
  let historyA: GPUTexture | null = null;
  let historyB: GPUTexture | null = null;
  let historyViewA: GPUTextureView | null = null;
  let historyViewB: GPUTextureView | null = null;
  let bloomDownTextures: GPUTexture[] = [];
  let bloomDownViews: GPUTextureView[] = [];
  let bloomUpTextures: GPUTexture[] = [];
  let bloomUpViews: GPUTextureView[] = [];
  let bloomDownBindGroups: GPUBindGroup[] = [];
  let bloomUpBindGroups: GPUBindGroup[] = [];
  let bloomReady = false;
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
    for (const tex of bloomDownTextures) {
      tex.destroy();
    }
    for (const tex of bloomUpTextures) {
      tex.destroy();
    }
    bloomDownTextures = [];
    bloomDownViews = [];
    bloomUpTextures = [];
    bloomUpViews = [];
    bloomDownBindGroups = [];
    bloomUpBindGroups = [];
    bloomReady = false;

    const size = { width: canvas.width, height: canvas.height };

    sceneTexture = device.createTexture({
      label: "flow scene texture",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    historyA = device.createTexture({
      label: "flow history A",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    historyB = device.createTexture({
      label: "flow history B",
      size,
      format: offscreenFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    historyViewA = historyA.createView();
    historyViewB = historyB.createView();

    let bloomW = Math.max(1, Math.floor(canvas.width / 2));
    let bloomH = Math.max(1, Math.floor(canvas.height / 2));
    const bloomScale = Math.min(1, BLOOM_BASE_MAX / Math.max(bloomW, bloomH));
    bloomW = Math.max(1, Math.floor(bloomW * bloomScale));
    bloomH = Math.max(1, Math.floor(bloomH * bloomScale));

    for (let level = 0; level < BLOOM_LEVELS; level += 1) {
      const tex = device.createTexture({
        label: `flow bloom down ${level}`,
        size: { width: bloomW, height: bloomH },
        format: offscreenFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      bloomDownTextures.push(tex);
      bloomDownViews.push(tex.createView());
      if (level < BLOOM_LEVELS - 1) {
        const upTex = device.createTexture({
          label: `flow bloom up ${level}`,
          size: { width: bloomW, height: bloomH },
          format: offscreenFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        bloomUpTextures.push(upTex);
        bloomUpViews.push(upTex.createView());
      }
      bloomW = Math.max(1, Math.floor(bloomW / 2));
      bloomH = Math.max(1, Math.floor(bloomH / 2));
    }

    for (let level = 1; level < BLOOM_LEVELS; level += 1) {
      bloomDownBindGroups.push(
        device.createBindGroup({
          label: `flow bloom down bind ${level}`,
          layout: bloomDownPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: linearSampler },
            { binding: 1, resource: bloomDownViews[level - 1] },
          ],
        }),
      );
    }
    const lastDown = BLOOM_LEVELS - 1;
    for (let level = 0; level < BLOOM_LEVELS - 1; level += 1) {
      const hiView = level === lastDown - 1 ? bloomDownViews[lastDown] : bloomUpViews[level + 1];
      bloomUpBindGroups.push(
        device.createBindGroup({
          label: `flow bloom up bind ${level}`,
          layout: bloomUpPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: linearSampler },
            { binding: 1, resource: bloomDownViews[level] },
            { binding: 2, resource: hiView },
          ],
        }),
      );
    }
    bloomReady = true;

    const clearEncoder = device.createCommandEncoder({ label: "flow initial history clear" });
    const clearPass = clearEncoder.beginRenderPass({
      label: "flow initial history clear",
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
    const motion = reducedMotion ? FLOW_CONTROLS.reducedMotionScale : 1;
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

    const lerpAlpha = 1 - Math.exp(-FLOW_CONTROLS.modeTransitionRate * deltaTime);
    for (let i = 0; i < 5; i += 1) {
      currentWeights[i] += (targetWeights[i] - currentWeights[i]) * lerpAlpha;
    }

    simUniforms.set([
      deltaTime,
      seconds,
      aspect,
      motion,
      pointer.x,
      pointer.y,
      currentWeights[0],
      currentWeights[1],
      currentWeights[2],
      currentWeights[3],
      currentWeights[4],
      0,
      pointer.pressure,
      0,
      0,
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
      BLOOM_INTENSITY,
      BLOOM_EXPOSURE,
      BLOOM_SHADING,
      pointer.pressure,
      currentWeights[0],
      currentWeights[1],
      currentWeights[2],
      currentWeights[3],
      currentWeights[4],
      0,
      0,
      0,
      0,
      0,
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
      0,
      0,
      0,
      0,
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
    scenePass.setPipeline(spritePipeline);
    scenePass.setBindGroup(0, spriteBindGroups[targetIndex]);
    scenePass.draw(6, PARTICLE_COUNT);
    scenePass.end();

    const accumReadView = historyRead === 0 ? historyViewA : historyViewB;
    const accumWriteTexture = historyWrite === 0 ? historyA : historyB;
    const accumWriteView = historyWrite === 0 ? historyViewA : historyViewB;

    if (accumReadView && accumWriteTexture && accumWriteView) {
      const accumBindGroup = device.createBindGroup({
        label: "flow accum pass bind group",
        layout: accumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: accumReadView },
          { binding: 2, resource: sceneTexture.createView() },
          { binding: 3, resource: { buffer: accumBuffer } },
        ],
      });
      const accumPass = encoder.beginRenderPass({
        label: "flow accumulation pass",
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

      if (bloomReady && bloomDownViews.length === BLOOM_LEVELS && bloomUpViews.length === BLOOM_LEVELS - 1) {
        const prefilterBindGroup = device.createBindGroup({
          label: "flow bloom prefilter bind group",
          layout: bloomPrefilterPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: linearSampler },
            { binding: 1, resource: accumWriteView },
            { binding: 3, resource: { buffer: bloomPrefBuffer } },
          ],
        });
        const prefilterPass = encoder.beginRenderPass({
          label: "flow bloom prefilter pass",
          colorAttachments: [
            {
              view: bloomDownViews[0],
              loadOp: "clear",
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              storeOp: "store",
            },
          ],
        });
        prefilterPass.setPipeline(bloomPrefilterPipeline);
        prefilterPass.setBindGroup(0, prefilterBindGroup);
        prefilterPass.draw(3);
        prefilterPass.end();

        for (let level = 1; level < BLOOM_LEVELS; level += 1) {
          const downPass = encoder.beginRenderPass({
            label: `flow bloom down pass ${level}`,
            colorAttachments: [
              {
                view: bloomDownViews[level],
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: "store",
              },
            ],
          });
          downPass.setPipeline(bloomDownPipeline);
          downPass.setBindGroup(0, bloomDownBindGroups[level - 1]);
          downPass.draw(3);
          downPass.end();
        }

        for (let level = BLOOM_LEVELS - 2; level >= 0; level -= 1) {
          const upPass = encoder.beginRenderPass({
            label: `flow bloom up pass ${level}`,
            colorAttachments: [
              {
                view: bloomUpViews[level],
                loadOp: "clear",
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                storeOp: "store",
              },
            ],
          });
          upPass.setPipeline(bloomUpPipeline);
          upPass.setBindGroup(0, bloomUpBindGroups[level]);
          upPass.draw(3);
          upPass.end();
        }
      }

      const bloomView = bloomReady ? bloomUpViews[0] : accumWriteView;
      const postBindGroup = device.createBindGroup({
        label: "flow post bind group",
        layout: postPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: linearSampler },
          { binding: 1, resource: accumWriteView },
          { binding: 2, resource: bloomView },
          { binding: 3, resource: { buffer: renderBuffer } },
        ],
      });

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
    }

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
    historyIndex = historyWrite;
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  const renderer: FlowFieldRenderer = {
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
      for (const tex of bloomDownTextures) {
        tex.destroy();
      }
      for (const tex of bloomUpTextures) {
        tex.destroy();
      }
      particleBuffers[0].destroy();
      particleBuffers[1].destroy();
      simBuffer.destroy();
      renderBuffer.destroy();
      accumBuffer.destroy();
      bloomPrefBuffer.destroy();
    },
    setMode: (mode: FieldMode) => {
      const nextActive = MODE_INDEX[mode] ?? 0;
      for (let i = 0; i < 5; i += 1) {
        targetWeights[i] = i === nextActive ? 1 : 0;
      }
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
    label: "flow render bind group",
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

    particles[offset] = lerp(-0.92, 1.46, hash(seed));
    particles[offset + 1] = lerp(-1.12, 1.1, hash(seed * 2.31));
    particles[offset + 2] = lerp(0.04, 0.18, hash(seed * 3.73));
    particles[offset + 3] = lerp(-0.11, 0.12, hash(seed * 5.19));
    particles[offset + 4] = seed;
    particles[offset + 5] = depth;
    particles[offset + 6] = hash(seed * 11.7) * lerp(10, 20, depth);
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
