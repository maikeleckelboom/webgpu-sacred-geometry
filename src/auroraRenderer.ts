import auroraComputeShaderSource from "./shaders/aurora-compute.wgsl?raw";
import auroraParticlesShaderSource from "./shaders/aurora-particles.wgsl?raw";
import auroraPostShaderSource from "./shaders/aurora-post.wgsl?raw";
import { defaultVisualControls } from "./visualControls";

const AURORA_CONTROLS = defaultVisualControls.aurora;
const PARTICLE_COUNT = AURORA_CONTROLS.population.count;
const WORKGROUP_SIZE = 64;
const FLOATS_PER_PARTICLE = 8;
const SIM_UNIFORM_FLOATS = 12;
const RENDER_UNIFORM_FLOATS = 24;

interface PointerState {
  clientX: number;
  clientY: number;
  localCssX: number;
  localCssY: number;
  backingX: number;
  backingY: number;
  rendererX: number;
  rendererY: number;
  strength: number;
  hovering: boolean;
  hasPosition: boolean;
}

interface ResponsiveProfile {
  compactness: number;
  interactionRadiusCss: number;
  revealStart: number;
  trailPixels: number;
}

interface PointerDiagnostics {
  destroy: () => void;
  update: (
    pointer: PointerState,
    rect: DOMRect,
    profile: ResponsiveProfile,
    effectivePixelRatio: number,
  ) => void;
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
  const initialProfile = getResponsiveProfile(canvas);
  const particleData = createInitialParticles(PARTICLE_COUNT, initialProfile.compactness);
  const particleBuffers = [
    createStorageBuffer(device, "aurora particles A", particleData.byteLength),
    createStorageBuffer(device, "aurora particles B", particleData.byteLength),
  ];

  device.addEventListener("uncapturederror", (event) => {
    console.error(`Aurora WebGPU error: ${event.error.message}`);
  });
  device.pushErrorScope("validation");
  device.queue.writeBuffer(particleBuffers[0], 0, particleData);
  device.queue.writeBuffer(particleBuffers[1], 0, particleData);

  const simBuffer = device.createBuffer({
    label: "aurora simulation uniforms",
    size: SIM_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const renderBuffer = device.createBuffer({
    label: "aurora render uniforms",
    size: RENDER_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const computeModule = device.createShaderModule({
    label: "aurora compute shader",
    code: auroraComputeShaderSource,
  });
  const renderModule = device.createShaderModule({
    label: "aurora particle render shader",
    code: auroraParticlesShaderSource,
  });
  const postModule = device.createShaderModule({
    label: "aurora post shader",
    code: auroraPostShaderSource,
  });
  const computePipeline = device.createComputePipeline({
    label: "aurora compute pipeline",
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
    "aurora line pipeline",
  );
  const spritePipeline = createParticlePipeline(
    device,
    renderModule,
    format,
    "spriteVertex",
    "spriteFragment",
    "aurora atmosphere pipeline",
  );
  const postPipeline = device.createRenderPipeline({
    label: "aurora post pipeline",
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
    throw new Error(`Aurora WebGPU setup failed: ${setupError.message}`);
  }

  const sampler = device.createSampler({
    label: "aurora post sampler",
    magFilter: "linear",
    minFilter: "linear",
  });
  const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointerMedia = window.matchMedia("(hover: hover) and (pointer: fine)");
  const pointer: PointerState = {
    clientX: 0,
    clientY: 0,
    localCssX: 0,
    localCssY: 0,
    backingX: 0,
    backingY: 0,
    rendererX: 0,
    rendererY: 0,
    strength: 0,
    hovering: false,
    hasPosition: false,
  };
  const diagnostics = createPointerDiagnostics(canvas);
  const simUniforms = new Float32Array(SIM_UNIFORM_FLOATS);
  const renderUniforms = new Float32Array(RENDER_UNIFORM_FLOATS);
  const abortController = new AbortController();
  let reducedMotion = reducedMotionMedia.matches;
  let finePointer = finePointerMedia.matches;
  let offscreenTexture: GPUTexture | null = null;
  let postBindGroup: GPUBindGroup | null = null;
  let sourceIndex = 0;
  let simulatedCompactness = initialProfile.compactness;
  let lastTime = 0;
  let visualTime = 0;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  const updatePointerFromEvent = (event: PointerEvent): void => {
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
    pointer.hasPosition = true;
    mapPointerToRenderer(canvas, pointer);
  };

  canvas.addEventListener(
    "pointerenter",
    (event) => {
      if (!finePointer) {
        return;
      }

      updatePointerFromEvent(event);
      pointer.hovering = true;
    },
    { signal: abortController.signal },
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!finePointer) {
        return;
      }

      if (event.target !== canvas) {
        pointer.hovering = false;
        return;
      }

      updatePointerFromEvent(event);
      pointer.hovering = true;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.hovering = false;
    },
    { signal: abortController.signal },
  );
  reducedMotionMedia.addEventListener(
    "change",
    (event) => {
      reducedMotion = event.matches;
      pointer.hovering = pointer.hovering && !reducedMotion;
    },
    { signal: abortController.signal },
  );
  finePointerMedia.addEventListener(
    "change",
    (event) => {
      finePointer = event.matches;
      pointer.hovering = pointer.hovering && finePointer;
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
      label: "aurora offscreen texture",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    postBindGroup = device.createBindGroup({
      label: "aurora post bind group",
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: offscreenTexture.createView() },
        { binding: 2, resource: { buffer: renderBuffer } },
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
    const deltaTime = Math.min(lastTime > 0 ? seconds - lastTime : 1 / 60, 0.05);
    const rect = canvas.getBoundingClientRect();
    const profile = getResponsiveProfile(canvas);
    const aspect = rect.width / Math.max(1, rect.height);
    const effectivePixelRatio = canvas.width / Math.max(1, rect.width);

    if (Math.abs(profile.compactness - simulatedCompactness) > 0.08) {
      const responsiveParticles = createInitialParticles(PARTICLE_COUNT, profile.compactness);
      device.queue.writeBuffer(particleBuffers[0], 0, responsiveParticles);
      device.queue.writeBuffer(particleBuffers[1], 0, responsiveParticles);
      sourceIndex = 0;
      simulatedCompactness = profile.compactness;
    }

    const targetStrength =
      pointer.hovering && pointer.hasPosition && finePointer && !reducedMotion
        ? 1
        : AURORA_CONTROLS.reducedMotion.pointerStrength;
    const responseTimeMs =
      targetStrength > pointer.strength
        ? AURORA_CONTROLS.pointer.enterTimeMs
        : AURORA_CONTROLS.pointer.leaveTimeMs;
    const strengthResponse = 1 - Math.exp(-deltaTime / Math.max(0.001, responseTimeMs * 0.001));

    pointer.strength = reducedMotion
      ? AURORA_CONTROLS.reducedMotion.pointerStrength
      : pointer.strength + (targetStrength - pointer.strength) * strengthResponse;
    visualTime +=
      deltaTime * (reducedMotion ? AURORA_CONTROLS.reducedMotion.advectionScale : 1);

    if (pointer.hasPosition) {
      mapPointerToRenderer(canvas, pointer);
    }

    lastTime = seconds;
    simUniforms.set([
      deltaTime,
      seconds,
      aspect,
      reducedMotion ? AURORA_CONTROLS.reducedMotion.advectionScale : 1,
      profile.compactness,
      AURORA_CONTROLS.dynamics.primarySpeed,
      AURORA_CONTROLS.dynamics.secondarySpeed,
      AURORA_CONTROLS.dynamics.laneRestoration,
      AURORA_CONTROLS.dynamics.localVariation,
      AURORA_CONTROLS.composition.primaryWidth,
      AURORA_CONTROLS.composition.secondaryWidth,
      AURORA_CONTROLS.population.primaryShare,
    ]);
    renderUniforms.set([
      visualTime,
      aspect,
      AURORA_CONTROLS.rendering.lineOpacity,
      effectivePixelRatio,
      canvas.width,
      canvas.height,
      pointer.rendererX,
      pointer.rendererY,
      pointer.strength,
      profile.interactionRadiusCss,
      profile.compactness,
      AURORA_CONTROLS.exposure.toneMapExposure,
      profile.trailPixels,
      AURORA_CONTROLS.pointer.maxDisplacementCss,
      AURORA_CONTROLS.pointer.clearing,
      AURORA_CONTROLS.pointer.edgeGain,
      AURORA_CONTROLS.composition.primaryWidth,
      AURORA_CONTROLS.composition.secondaryWidth,
      profile.revealStart,
      AURORA_CONTROLS.population.compactVisibleShare,
      AURORA_CONTROLS.exposure.sceneGain,
      AURORA_CONTROLS.exposure.glowGain,
      AURORA_CONTROLS.rendering.spriteOpacity,
      AURORA_CONTROLS.population.primaryShare,
    ]);
    device.queue.writeBuffer(simBuffer, 0, simUniforms);
    device.queue.writeBuffer(renderBuffer, 0, renderUniforms);
    diagnostics?.update(pointer, rect, profile, effectivePixelRatio);

    const targetIndex = 1 - sourceIndex;
    const encoder = device.createCommandEncoder({ label: "aurora frame encoder" });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const computePass = encoder.beginComputePass({ label: "aurora compute pass" });
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroups[sourceIndex]);
    computePass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE));
    computePass.end();

    const scenePass = encoder.beginRenderPass({
      label: "aurora scene pass",
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
      label: "aurora post pass",
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
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
          console.error(`Aurora WebGPU frame failed: ${frameError.message}`);
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
      diagnostics?.destroy();

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
    label: "aurora compute bind group",
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
    label: "aurora render bind group",
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
              dstFactor: "one-minus-src-alpha",
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
    primitive: { topology: "triangle-list" },
  });
}

function createInitialParticles(count: number, compactness: number): Float32Array {
  const particles = new Float32Array(count * FLOATS_PER_PARTICLE);

  for (let index = 0; index < count; index += 1) {
    const seed = index * 0.61803398875 + 0.123;
    const offset = index * FLOATS_PER_PARTICLE;
    const depth = hash(seed * 7.41);
    const lane = lerp(-1, 1, hash(seed * 13.3));
    const x = lerp(-1.28, 1.24, hash(seed));
    const secondary = hash(seed * 5.19) >= AURORA_CONTROLS.population.primaryShare;
    const width = secondary
      ? AURORA_CONTROLS.composition.secondaryWidth
      : AURORA_CONTROLS.composition.primaryWidth;
    const y =
      (secondary ? secondaryCenter(x, compactness) : primaryCenter(x, compactness)) +
      lane * width * (0.28 + depth * 0.72);
    const speed = secondary
      ? AURORA_CONTROLS.dynamics.secondarySpeed
      : AURORA_CONTROLS.dynamics.primarySpeed;
    const lifetime = lerp(24, 44, hash(seed * 3.91));

    particles[offset] = x;
    particles[offset + 1] = y;
    particles[offset + 2] = speed;
    particles[offset + 3] = 0;
    particles[offset + 4] = seed;
    particles[offset + 5] = depth;
    particles[offset + 6] = hash(seed * 11.7) * lifetime;
    particles[offset + 7] = lane;
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

function getResponsiveProfile(canvas: HTMLCanvasElement): ResponsiveProfile {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const aspect = width / height;
  const widthPressure = clamp(
    (AURORA_CONTROLS.responsive.compactMaxWidth + 280 - width) / 280,
    0,
    1,
  );
  const aspectPressure = clamp(
    (AURORA_CONTROLS.responsive.compactAspect + 0.24 - aspect) / 0.24,
    0,
    1,
  );
  const compactness = Math.max(widthPressure, aspectPressure);

  return {
    compactness,
    interactionRadiusCss: lerp(
      AURORA_CONTROLS.pointer.desktopRadiusCss,
      AURORA_CONTROLS.pointer.compactRadiusCss,
      compactness,
    ),
    revealStart: lerp(
      AURORA_CONTROLS.composition.desktopRevealStart,
      AURORA_CONTROLS.composition.compactRevealStart,
      compactness,
    ),
    trailPixels: lerp(
      AURORA_CONTROLS.rendering.desktopTrailPixels,
      AURORA_CONTROLS.rendering.compactTrailPixels,
      compactness,
    ),
  };
}

// Pointer coordinate contract:
// client CSS pixels -> canvas-local CSS pixels -> canvas backing-store pixels
// -> WebGPU clip/NDC coordinates. The canvas framebuffer is top-down, so -1 is
// the top edge and +1 is the bottom edge in the particle stage. The force
// center is never interpolated.
function mapPointerToRenderer(canvas: HTMLCanvasElement, pointer: PointerState): void {
  const rect = canvas.getBoundingClientRect();
  const localCssX = clamp(pointer.clientX - rect.left, 0, rect.width);
  const localCssY = clamp(pointer.clientY - rect.top, 0, rect.height);
  const backingX = localCssX * (canvas.width / Math.max(1, rect.width));
  const backingY = localCssY * (canvas.height / Math.max(1, rect.height));

  pointer.localCssX = localCssX;
  pointer.localCssY = localCssY;
  pointer.backingX = backingX;
  pointer.backingY = backingY;
  pointer.rendererX = (backingX / Math.max(1, canvas.width)) * 2 - 1;
  pointer.rendererY = (backingY / Math.max(1, canvas.height)) * 2 - 1;
}

function createPointerDiagnostics(canvas: HTMLCanvasElement): PointerDiagnostics | null {
  const debugMode = new URLSearchParams(window.location.search).get("debug");

  if (!import.meta.env.DEV || debugMode !== "pointer") {
    return null;
  }

  const root = document.createElement("div");
  const radius = document.createElement("div");
  const rawCenter = document.createElement("div");
  const effectiveCenter = document.createElement("div");
  const panel = document.createElement("pre");

  root.className = "aurora-pointer-debug is-inactive";
  radius.className = "aurora-pointer-debug__radius";
  rawCenter.className = "aurora-pointer-debug__center aurora-pointer-debug__center--raw";
  effectiveCenter.className =
    "aurora-pointer-debug__center aurora-pointer-debug__center--effective";
  panel.className = "aurora-pointer-debug__panel";
  root.append(radius, rawCenter, effectiveCenter, panel);
  (canvas.closest(".study-page") ?? document.body).append(root);

  return {
    destroy: () => root.remove(),
    update: (pointer, rect, profile, effectivePixelRatio) => {
      const mappedClientX = rect.left + ((pointer.rendererX + 1) * 0.5) * rect.width;
      const mappedClientY = rect.top + ((pointer.rendererY + 1) * 0.5) * rect.height;
      const drift = Math.hypot(mappedClientX - pointer.clientX, mappedClientY - pointer.clientY);
      const diameter = profile.interactionRadiusCss * 2;

      root.classList.toggle("is-inactive", !pointer.hasPosition);
      radius.style.width = `${diameter}px`;
      radius.style.height = `${diameter}px`;
      radius.style.transform = `translate(${mappedClientX - profile.interactionRadiusCss}px, ${mappedClientY - profile.interactionRadiusCss}px)`;
      rawCenter.style.transform = `translate(${pointer.clientX}px, ${pointer.clientY}px)`;
      effectiveCenter.style.transform = `translate(${mappedClientX}px, ${mappedClientY}px)`;
      panel.textContent = [
        `raw client css  ${pointer.clientX.toFixed(2)}, ${pointer.clientY.toFixed(2)}`,
        `canvas local    ${pointer.localCssX.toFixed(2)}, ${pointer.localCssY.toFixed(2)}`,
        `backing store   ${pointer.backingX.toFixed(2)}, ${pointer.backingY.toFixed(2)}`,
        `renderer ndc    ${pointer.rendererX.toFixed(4)}, ${pointer.rendererY.toFixed(4)}`,
        `effective css   ${mappedClientX.toFixed(2)}, ${mappedClientY.toFixed(2)}`,
        `mapping drift   ${drift.toFixed(3)} css px`,
        `radius          ${profile.interactionRadiusCss.toFixed(1)} css px`,
        `strength        ${pointer.strength.toFixed(3)}`,
        `canvas bounds   ${rect.left.toFixed(1)}, ${rect.top.toFixed(1)} / ${rect.width.toFixed(1)} x ${rect.height.toFixed(1)}`,
        `dpr             ${(window.devicePixelRatio || 1).toFixed(2)} (effective ${effectivePixelRatio.toFixed(2)})`,
      ].join("\n");
    },
  };
}

function primaryCenter(x: number, compactness: number): number {
  const desktop =
    0.42 - smoothstep(-0.52, 0.92, x) * 0.36 + Math.sin((x + 0.35) * 2.1) * 0.1;
  const compact =
    0.48 - smoothstep(-0.85, 0.9, x) * 0.2 + Math.sin((x + 0.2) * 2.1) * 0.06;
  return lerp(desktop, compact, compactness);
}

function secondaryCenter(x: number, compactness: number): number {
  return (
    primaryCenter(x, compactness) +
    lerp(-0.32, -0.28, compactness) +
    Math.sin(x * 1.6 + 1.2) * 0.025
  );
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function hash(value: number): number {
  return fract(Math.sin(value * 127.1) * 43758.5453123);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}
