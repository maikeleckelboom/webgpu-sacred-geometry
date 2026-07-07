const SAMPLE_COUNT = 4;
const LINE_FLOATS = 12;
const NODE_FLOATS = 8;
const PLANE_FLOATS = 10;
const UNIFORM_FLOATS = 32;

const shader = /* wgsl */ `
struct Scene {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  viewport: vec4f,
  params: vec4f,
  pointer: vec4f,
}

struct LineOut {
  @builtin(position) position: vec4f,
  @location(0) side: f32,
  @location(1) along: f32,
  @location(2) alpha: f32,
  @location(3) tone: f32,
  @location(4) phase: f32,
  @location(5) focus: f32,
}

struct NodeOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) alpha: f32,
  @location(2) tone: f32,
  @location(3) phase: f32,
  @location(4) kind: f32,
}

struct PlaneOut {
  @builtin(position) position: vec4f,
  @location(0) alpha: f32,
  @location(1) tone: f32,
  @location(2) facing: f32,
  @location(3) phase: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

fn project(point: vec3f, phase: f32, layer: f32) -> vec4f {
  let time = scene.params.x;
  let motion = scene.params.y;
  let compositionOffset = vec3f(0.58, -0.13, 0.0);
  let drift = vec3f(
    sin(time * 0.17 + phase) * 0.018,
    cos(time * 0.13 + phase * 1.7) * 0.012,
    sin(time * 0.11 + phase * 0.7) * 0.018
  ) * motion * layer;
  return scene.viewProjection * vec4f(point + compositionOffset + drift, 1.0);
}

fn lineCorner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return corners[index];
}

fn spriteCorner(index: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return corners[index];
}

fn depthFocus(world: vec3f, focus: f32) -> f32 {
  let distanceToCamera = distance(scene.cameraPosition.xyz, world);
  let focalDistance = scene.params.z + focus * 0.35;
  return 1.0 - smoothstep(0.24, 2.1, abs(distanceToCamera - focalDistance));
}

fn tonalColor(tone: f32, activation: f32, kind: f32) -> vec3f {
  let paper = vec3f(0.62, 0.63, 0.61);
  let graphite = vec3f(0.045, 0.048, 0.052);
  let accent = vec3f(0.22, 0.42, 0.5);
  let base = mix(graphite, paper, clamp(tone, 0.0, 1.0));
  return mix(base, accent, clamp(activation * 0.32 + kind * 0.12, 0.0, 0.38));
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) startAndWidth: vec4f,
  @location(1) endAndAlpha: vec4f,
  @location(2) lineInfo: vec4f
) -> LineOut {
  let corner = lineCorner(vertexIndex);
  let start = startAndWidth.xyz;
  let end = endAndAlpha.xyz;
  let phase = lineInfo.y;
  let focus = lineInfo.z;
  let layer = lineInfo.w;
  let clipA = project(start, phase, layer);
  let clipB = project(end, phase + 0.53, layer);
  let ndcA = clipA.xy / clipA.w;
  let ndcB = clipB.xy / clipB.w;
  let deltaPixels = (ndcB - ndcA) * scene.viewport.xy * 0.5;
  let normalPixels = normalize(vec2f(-deltaPixels.y, deltaPixels.x) + vec2f(0.0001, 0.0002));
  let normalNdc = normalPixels * 2.0 / scene.viewport.xy;
  let widthPixels = startAndWidth.w * scene.viewport.z * (0.78 + focus * 0.34);
  let t = corner.x;
  let ndc = mix(ndcA, ndcB, t) + normalNdc * corner.y * widthPixels;
  let w = mix(clipA.w, clipB.w, t);
  let z = mix(clipA.z / clipA.w, clipB.z / clipB.w, t) * w;
  let world = mix(start, end, t);
  let nearFocus = depthFocus(world, focus);
  let distanceFade = 1.0 - smoothstep(4.0, 6.7, distance(scene.cameraPosition.xyz, world));

  var out: LineOut;
  out.position = vec4f(ndc * w, z, w);
  out.side = corner.y;
  out.along = t;
  out.alpha = endAndAlpha.w * (0.68 + nearFocus * 0.72) * distanceFade;
  out.tone = lineInfo.x;
  out.phase = phase;
  out.focus = focus;
  return out;
}

@fragment
fn lineFragment(input: LineOut) -> @location(0) vec4f {
  let sideFade = pow(clamp(1.0 - abs(input.side), 0.0, 1.0), 1.45);
  let endFade = smoothstep(0.0, 0.06, input.along) * (1.0 - smoothstep(0.94, 1.0, input.along) * 0.18);
  let pulse = 0.88 + sin(scene.params.x * 0.45 + input.phase) * 0.08 * scene.params.y;
  let activation = smoothstep(0.72, 1.0, input.focus) * pulse;
  let color = tonalColor(input.tone, activation, 0.0);
  let alpha = input.alpha * sideFade * endFade * pulse * 1.35;
  return vec4f(color, alpha);
}

@vertex
fn nodeVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) positionAndRadius: vec4f,
  @location(1) nodeInfo: vec4f
) -> NodeOut {
  let corner = spriteCorner(vertexIndex);
  let phase = nodeInfo.z;
  let kind = nodeInfo.w;
  let clip = project(positionAndRadius.xyz, phase, 0.55 + kind * 0.4);
  let ndc = clip.xy / clip.w;
  let focus = depthFocus(positionAndRadius.xyz, kind * 0.35);
  let pointerLocal = (1.0 - smoothstep(0.16, 0.9, distance(ndc, scene.pointer.xy))) * scene.pointer.z;
  let radiusPixels = positionAndRadius.w * scene.viewport.z * (0.72 + focus * 0.44 + pointerLocal * 0.06 + kind * 0.14);
  let spriteNdc = ndc + corner * radiusPixels * 2.0 / scene.viewport.xy;

  var out: NodeOut;
  out.position = vec4f(spriteNdc * clip.w, clip.z, clip.w);
  out.local = corner;
  out.alpha = nodeInfo.x * (0.74 + focus * 0.58 + pointerLocal * 0.08);
  out.tone = nodeInfo.y;
  out.phase = phase;
  out.kind = kind;
  return out;
}

@fragment
fn nodeFragment(input: NodeOut) -> @location(0) vec4f {
  let d = length(input.local);
  let disc = smoothstep(1.0, 0.78, d);
  let core = smoothstep(0.38, 0.0, d);
  let halo = pow(clamp(1.0 - d, 0.0, 1.0), 2.4);
  let pulse = 0.9 + sin(scene.params.x * 0.72 + input.phase) * 0.06 * scene.params.y;
  let color = tonalColor(input.tone, core * pulse, input.kind) + vec3f(core * 0.12);
  let alpha = input.alpha * pulse * (disc * 0.88 + core * 0.72 + halo * 0.28);
  return vec4f(color, alpha);
}

@vertex
fn planeVertex(
  @location(0) position: vec3f,
  @location(1) alpha: f32,
  @location(2) normal: vec3f,
  @location(3) planeInfo: vec3f
) -> PlaneOut {
  let clip = project(position, planeInfo.y, 0.28);
  let view = normalize(scene.cameraPosition.xyz - position);

  var out: PlaneOut;
  out.position = clip;
  out.alpha = alpha * (0.86 + depthFocus(position, planeInfo.z) * 0.5);
  out.tone = planeInfo.x;
  out.facing = abs(dot(normalize(normal), view));
  out.phase = planeInfo.y;
  return out;
}

@fragment
fn planeFragment(input: PlaneOut) -> @location(0) vec4f {
  let scan = 0.86 + sin(scene.params.x * 0.18 + input.phase) * 0.06 * scene.params.y;
  let edge = 0.42 + input.facing * 0.58;
  let color = mix(vec3f(0.08, 0.09, 0.095), vec3f(0.82, 0.84, 0.82), input.tone) * edge;
  return vec4f(color, input.alpha * scan);
}
`;

export interface ArchitectureRenderer {
  destroy: () => void;
}

interface ArchitectureScene {
  lines: Float32Array;
  lineCount: number;
  nodes: Float32Array;
  nodeCount: number;
  planes: Float32Array;
  planeVertexCount: number;
}

interface NodePoint {
  position: Vec3;
  radius: number;
  alpha: number;
  tone: number;
  phase: number;
  kind: number;
}

interface LineSegment {
  start: Vec3;
  end: Vec3;
  width: number;
  alpha: number;
  tone: number;
  phase: number;
  focus: number;
  layer: number;
}

interface PlaneVertex {
  position: Vec3;
  normal: Vec3;
  alpha: number;
  tone: number;
  phase: number;
  focus: number;
}

interface PointerState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  strength: number;
}

interface SheetSpec {
  origin: Vec3;
  u: Vec3;
  v: Vec3;
  columns: number;
  rows: number;
  phase: number;
  tone: number;
  lineAlpha: number;
  nodeAlpha: number;
  planeAlpha: number;
  layer: number;
  focus: number;
  nodeScale: number;
  diagonals: "none" | "sparse" | "dense";
}

interface SheetData {
  points: Vec3[][];
  nodeIndices: number[][];
}

export async function startArchitectureRenderer(
  canvas: HTMLCanvasElement,
): Promise<ArchitectureRenderer> {
  const forceFallback = new URLSearchParams(window.location.search).get("webgpu") === "off";

  if (forceFallback) {
    throw new Error(
      "WebGPU rendering is disabled for this view. The page content remains available without the architectural network graphic.",
    );
  }

  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available in this browser. The architectural network graphic needs a WebGPU-capable browser; the page content remains available.",
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
  const scene = createArchitectureScene();
  device.pushErrorScope("validation");
  const lineBuffer = createBuffer(device, "architecture line instances", scene.lines);
  const nodeBuffer = createBuffer(device, "architecture node instances", scene.nodes);
  const planeBuffer = createBuffer(device, "architecture plane vertices", scene.planes);
  const uniformBuffer = device.createBuffer({
    label: "architecture scene uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const module = device.createShaderModule({
    label: "architecture shader",
    code: shader,
  });
  const sceneBindGroupLayout = device.createBindGroupLayout({
    label: "architecture scene bind group layout",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: {
          type: "uniform",
        },
      },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    label: "architecture pipeline layout",
    bindGroupLayouts: [sceneBindGroupLayout],
  });
  const linePipeline = device.createRenderPipeline({
    label: "architecture line pipeline",
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: "lineVertex",
      buffers: [
        {
          arrayStride: LINE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
            { shaderLocation: 2, offset: 32, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "lineFragment",
      targets: [blendTarget(format)],
    },
    primitive: {
      topology: "triangle-list",
    },
    multisample: {
      count: SAMPLE_COUNT,
    },
  });
  const nodePipeline = device.createRenderPipeline({
    label: "architecture node pipeline",
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: "nodeVertex",
      buffers: [
        {
          arrayStride: NODE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "nodeFragment",
      targets: [blendTarget(format)],
    },
    primitive: {
      topology: "triangle-list",
    },
    multisample: {
      count: SAMPLE_COUNT,
    },
  });
  const planePipeline = device.createRenderPipeline({
    label: "architecture plane pipeline",
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: "planeVertex",
      buffers: [
        {
          arrayStride: PLANE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32" },
            { shaderLocation: 2, offset: 16, format: "float32x3" },
            { shaderLocation: 3, offset: 28, format: "float32x3" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "planeFragment",
      targets: [blendTarget(format)],
    },
    primitive: {
      topology: "triangle-list",
    },
    multisample: {
      count: SAMPLE_COUNT,
    },
  });
  const bindGroup = device.createBindGroup({
    label: "architecture scene bind group",
    layout: sceneBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });
  const setupError = await device.popErrorScope();

  if (setupError) {
    throw new Error(`Architecture WebGPU setup failed: ${setupError.message}`);
  }

  const pointer: PointerState = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    strength: 0,
  };
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  const abortController = new AbortController();
  let reducedMotion = reducedMotionQuery.matches;
  let multisampleTexture: GPUTexture | null = null;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.targetX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.targetY = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.strength = Math.min(0.22, pointer.strength + 0.035);
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.targetX = 0;
      pointer.targetY = 0;
      pointer.strength = Math.min(pointer.strength, 0.06);
    },
    { signal: abortController.signal },
  );
  reducedMotionQuery.addEventListener(
    "change",
    () => {
      reducedMotion = reducedMotionQuery.matches;
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
    if (!resizeCanvas(canvas, device) && multisampleTexture) {
      return;
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    multisampleTexture?.destroy();
    multisampleTexture = device.createTexture({
      label: "architecture multisample target",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  function renderFrame(time: number): void {
    animationFrame = 0;

    if (!active || document.hidden) {
      return;
    }

    refreshTargets();

    if (!multisampleTexture) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? 0.08 : 1;
    pointer.x += (pointer.targetX - pointer.x) * 0.032;
    pointer.y += (pointer.targetY - pointer.y) * 0.032;
    pointer.strength *= reducedMotion ? 0.78 : 0.88;

    const driftX = Math.sin(seconds * 0.11) * 0.08 * motion;
    const driftY = Math.cos(seconds * 0.09) * 0.045 * motion;
    const eye: Vec3 = [0.08 + driftX, 0.12 + driftY, 4.22];
    const target: Vec3 = [0.28 + driftX * 0.35, -0.02 + driftY * 0.3, 0.08];
    const projection = perspective((37 * Math.PI) / 180, aspect, 0.08, 9.5);
    const view = lookAt(eye, target, [0, 1, 0]);
    const viewProjection = multiplyMat4(projection, view);

    uniforms.set(viewProjection, 0);
    uniforms.set([eye[0], eye[1], eye[2], 1], 16);
    uniforms.set(
      [canvas.width, canvas.height, Math.min(window.devicePixelRatio || 1, 2.4), aspect],
      20,
    );
    uniforms.set([seconds, motion, 4.08, 0], 24);
    uniforms.set([pointer.x, pointer.y, pointer.strength, aspect], 28);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder({
      label: "architecture frame encoder",
    });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const pass = encoder.beginRenderPass({
      label: "architecture render pass",
      colorAttachments: [
        {
          view: multisampleTexture.createView(),
          resolveTarget: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.948, g: 0.948, b: 0.925, a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });

    pass.setPipeline(planePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, planeBuffer);
    pass.draw(scene.planeVertexCount);
    pass.setPipeline(linePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, lineBuffer);
    pass.draw(6, scene.lineCount);
    pass.setPipeline(nodePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, nodeBuffer);
    pass.draw(6, scene.nodeCount);
    pass.end();

    device.queue.submit([encoder.finish()]);

    if (!checkedFirstFrame) {
      checkedFirstFrame = true;
      void device.popErrorScope().then((frameError) => {
        if (frameError) {
          console.error(`Architecture WebGPU frame failed: ${frameError.message}`);
        }
      });
    }

    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || document.hidden || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(renderFrame);
  }

  const renderer: ArchitectureRenderer = {
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

      multisampleTexture?.destroy();
      lineBuffer.destroy();
      nodeBuffer.destroy();
      planeBuffer.destroy();
      uniformBuffer.destroy();
    },
  };

  scheduleFrame();
  return renderer;
}

function blendTarget(format: GPUTextureFormat): GPUColorTargetState {
  return {
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
  };
}

function createBuffer(device: GPUDevice, label: string, data: Float32Array): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: data.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function createArchitectureScene(): ArchitectureScene {
  const nodes: NodePoint[] = [];
  const lines: LineSegment[] = [];
  const planes: PlaneVertex[] = [];
  const rearVault = addSheet(nodes, lines, planes, {
    origin: [-0.55, 0.42, -1.25],
    u: [0.42, 0.18, 0.04],
    v: [-0.18, 0.28, -0.02],
    columns: 7,
    rows: 5,
    phase: 0.6,
    tone: 0.52,
    lineAlpha: 0.08,
    nodeAlpha: 0.16,
    planeAlpha: 0.028,
    layer: 0.4,
    focus: 0.08,
    nodeScale: 0.72,
    diagonals: "sparse",
  });
  const middleDeck = addSheet(nodes, lines, planes, {
    origin: [-0.22, -0.28, -0.32],
    u: [0.36, 0.14, 0.06],
    v: [-0.16, 0.25, 0.03],
    columns: 7,
    rows: 5,
    phase: 2.2,
    tone: 0.25,
    lineAlpha: 0.2,
    nodeAlpha: 0.38,
    planeAlpha: 0.052,
    layer: 0.72,
    focus: 0.48,
    nodeScale: 0.95,
    diagonals: "dense",
  });
  const foregroundFrame = addSheet(nodes, lines, planes, {
    origin: [0.42, -0.66, 0.56],
    u: [0.33, 0.17, 0.04],
    v: [-0.18, 0.28, 0.08],
    columns: 6,
    rows: 6,
    phase: 4.1,
    tone: 0.08,
    lineAlpha: 0.34,
    nodeAlpha: 0.72,
    planeAlpha: 0.064,
    layer: 1,
    focus: 0.9,
    nodeScale: 1.24,
    diagonals: "sparse",
  });
  const lowerDeck = addSheet(nodes, lines, planes, {
    origin: [0.0, -0.98, 0.22],
    u: [0.46, 0.11, 0.08],
    v: [-0.12, 0.16, 0.06],
    columns: 6,
    rows: 3,
    phase: 5.8,
    tone: 0.16,
    lineAlpha: 0.24,
    nodeAlpha: 0.42,
    planeAlpha: 0.045,
    layer: 0.9,
    focus: 0.74,
    nodeScale: 0.9,
    diagonals: "none",
  });

  addPrimaryTrusses(nodes, lines, rearVault, middleDeck, foregroundFrame, lowerDeck);
  addMeshSurfaces(lines, middleDeck, foregroundFrame, lowerDeck);
  addRailBundles(nodes, lines, middleDeck, foregroundFrame, lowerDeck);
  addForegroundTower(nodes, lines, planes, foregroundFrame);
  addDepthGhosts(lines, rearVault, middleDeck, foregroundFrame);

  return {
    lines: serializeLines(lines),
    lineCount: lines.length,
    nodes: serializeNodes(nodes),
    nodeCount: nodes.length,
    planes: serializePlanes(planes),
    planeVertexCount: planes.length,
  };
}

function addSheet(
  nodes: NodePoint[],
  lines: LineSegment[],
  planes: PlaneVertex[],
  spec: SheetSpec,
): SheetData {
  const points: Vec3[][] = [];
  const nodeIndices: number[][] = [];

  for (let row = 0; row < spec.rows; row += 1) {
    const pointRow: Vec3[] = [];
    const nodeRow: number[] = [];

    for (let column = 0; column < spec.columns; column += 1) {
      const position = add3(spec.origin, add3(scale3(spec.u, column), scale3(spec.v, row)));
      const edge =
        row === 0 || column === 0 || row === spec.rows - 1 || column === spec.columns - 1;
      const anchor = (row + column) % 4 === 0 || (edge && (row + column) % 2 === 0);
      const index = nodes.length;

      nodes.push({
        position,
        radius: (anchor ? 6.3 : edge ? 4.7 : 3.2) * spec.nodeScale,
        alpha: spec.nodeAlpha * (anchor ? 1.12 : edge ? 0.74 : 0.42),
        tone: spec.tone,
        phase: spec.phase + row * 0.47 + column * 0.29,
        kind: anchor ? spec.focus : edge ? spec.focus * 0.65 : spec.focus * 0.28,
      });
      pointRow.push(position);
      nodeRow.push(index);
    }

    points.push(pointRow);
    nodeIndices.push(nodeRow);
  }

  const topLeft = points[0][0];
  const topRight = points[0][spec.columns - 1];
  const bottomRight = points[spec.rows - 1][spec.columns - 1];
  const bottomLeft = points[spec.rows - 1][0];
  addQuad(
    planes,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
    spec.planeAlpha,
    spec.tone + 0.08,
    spec.phase,
    spec.focus,
  );

  for (let row = 0; row < spec.rows; row += 1) {
    for (let column = 0; column < spec.columns - 1; column += 1) {
      const border = row === 0 || row === spec.rows - 1;
      addSegment(
        lines,
        points[row][column],
        points[row][column + 1],
        border ? 1.05 : 0.56,
        spec.lineAlpha * (border ? 1.18 : 0.64),
        spec.tone,
        spec.phase + row * 0.21,
        spec.layer,
        spec.focus,
      );
    }
  }

  for (let column = 0; column < spec.columns; column += 1) {
    for (let row = 0; row < spec.rows - 1; row += 1) {
      const border = column === 0 || column === spec.columns - 1;
      addSegment(
        lines,
        points[row][column],
        points[row + 1][column],
        border ? 1 : 0.48,
        spec.lineAlpha * (border ? 1.05 : 0.52),
        spec.tone + 0.02,
        spec.phase + column * 0.23,
        spec.layer,
        spec.focus,
      );
    }
  }

  if (spec.diagonals !== "none") {
    for (let row = 0; row < spec.rows - 1; row += 1) {
      for (let column = 0; column < spec.columns - 1; column += 1) {
        const dense = spec.diagonals === "dense";
        const drawForward = dense ? (row + column) % 2 === 0 : row === 1 && column % 2 === 0;
        const drawBack = dense && row % 2 === 0 && column % 3 === 1;

        if (drawForward) {
          addSegment(
            lines,
            points[row][column],
            points[row + 1][column + 1],
            0.46,
            spec.lineAlpha * 0.48,
            spec.tone + 0.04,
            spec.phase + 1.1,
            spec.layer,
            spec.focus,
          );
        }

        if (drawBack) {
          addSegment(
            lines,
            points[row + 1][column],
            points[row][column + 1],
            0.38,
            spec.lineAlpha * 0.32,
            spec.tone + 0.06,
            spec.phase + 1.6,
            spec.layer,
            spec.focus,
          );
        }
      }
    }
  }

  return { points, nodeIndices };
}

function addPrimaryTrusses(
  nodes: NodePoint[],
  lines: LineSegment[],
  rearVault: SheetData,
  middleDeck: SheetData,
  foregroundFrame: SheetData,
  lowerDeck: SheetData,
): void {
  addPolyline(
    lines,
    [p(middleDeck, 1, 0), p(middleDeck, 1, 2), p(foregroundFrame, 2, 2), p(foregroundFrame, 2, 5)],
    2.35,
    0.62,
    0.05,
    8.2,
    1,
    1,
  );
  addPolyline(
    lines,
    [p(lowerDeck, 0, 0), p(lowerDeck, 0, 2), p(foregroundFrame, 1, 3), p(foregroundFrame, 1, 5)],
    2.05,
    0.54,
    0.08,
    8.8,
    0.96,
    0.9,
  );
  addPolyline(
    lines,
    [p(rearVault, 3, 0), p(middleDeck, 3, 1), p(foregroundFrame, 4, 3), p(foregroundFrame, 4, 5)],
    1.35,
    0.32,
    0.16,
    9.4,
    0.78,
    0.58,
  );
  addPolyline(
    lines,
    [p(middleDeck, 0, 3), p(foregroundFrame, 0, 2), p(foregroundFrame, 5, 3), p(lowerDeck, 2, 3)],
    0.85,
    0.22,
    0.18,
    10.2,
    0.86,
    0.64,
  );
  addPolyline(
    lines,
    [p(rearVault, 0, 2), p(rearVault, 4, 4), p(foregroundFrame, 3, 4)],
    0.7,
    0.16,
    0.28,
    10.8,
    0.48,
    0.25,
  );

  for (const position of [
    p(middleDeck, 1, 2),
    p(foregroundFrame, 2, 2),
    p(foregroundFrame, 2, 5),
    p(lowerDeck, 0, 2),
    p(foregroundFrame, 1, 3),
  ]) {
    addNode(nodes, position, 8.4, 0.86, 0.04, 11.6, 1);
  }
}

function addMeshSurfaces(
  lines: LineSegment[],
  middleDeck: SheetData,
  foregroundFrame: SheetData,
  lowerDeck: SheetData,
): void {
  addMeshPatch(
    lines,
    p(middleDeck, 1, 2),
    p(foregroundFrame, 0, 4),
    p(foregroundFrame, 3, 5),
    p(middleDeck, 3, 3),
    12,
    9,
    0.19,
    0.075,
    14.1,
    0.94,
    0.9,
  );
  addMeshPatch(
    lines,
    p(lowerDeck, 0, 1),
    p(foregroundFrame, 2, 2),
    p(foregroundFrame, 5, 4),
    p(lowerDeck, 2, 3),
    10,
    7,
    0.16,
    0.065,
    15.4,
    0.9,
    0.82,
  );
}

function addRailBundles(
  nodes: NodePoint[],
  lines: LineSegment[],
  middleDeck: SheetData,
  foregroundFrame: SheetData,
  lowerDeck: SheetData,
): void {
  addRailBundle(
    lines,
    p(middleDeck, 2, 1),
    p(foregroundFrame, 4, 5),
    [0.012, -0.055, 0.015],
    7,
    1.18,
    0.42,
    0.04,
    16.2,
    1,
    0.95,
  );
  addRailBundle(
    lines,
    p(lowerDeck, 0, 0),
    p(foregroundFrame, 2, 5),
    [0.006, -0.046, 0.02],
    5,
    0.98,
    0.34,
    0.06,
    16.9,
    0.96,
    0.88,
  );
  addRailBundle(
    lines,
    p(middleDeck, 0, 4),
    p(foregroundFrame, 5, 2),
    [-0.02, 0.038, 0.012],
    4,
    0.72,
    0.22,
    0.12,
    17.5,
    0.84,
    0.72,
  );

  for (const point of [
    p(foregroundFrame, 0, 4),
    p(foregroundFrame, 2, 5),
    p(foregroundFrame, 4, 5),
    p(foregroundFrame, 5, 2),
  ]) {
    addNode(nodes, point, 9.6, 0.96, 0.03, 18.1, 1);
  }
}

function addForegroundTower(
  nodes: NodePoint[],
  lines: LineSegment[],
  planes: PlaneVertex[],
  foregroundFrame: SheetData,
): void {
  const tower = [
    addNode(nodes, [1.28, 0.02, 0.92], 9.8, 0.98, 0.02, 19.1, 1),
    addNode(nodes, [1.48, 0.42, 0.86], 7.4, 0.84, 0.04, 19.4, 0.92),
    addNode(nodes, [1.78, 0.34, 0.72], 8.8, 0.92, 0.03, 19.7, 1),
    addNode(nodes, [2.08, 0.62, 0.58], 7.8, 0.86, 0.05, 20.1, 0.86),
    addNode(nodes, [2.22, 0.16, 0.76], 10.2, 1, 0.01, 20.4, 1),
    addNode(nodes, [1.86, -0.12, 0.96], 8.2, 0.92, 0.03, 20.8, 0.95),
    addNode(nodes, [2.26, -0.32, 0.88], 7.8, 0.82, 0.06, 21.2, 0.8),
    addNode(nodes, [1.46, -0.34, 1.08], 7.2, 0.76, 0.08, 21.7, 0.72),
  ];
  const edges: Array<[number, number, number, number]> = [
    [0, 1, 1.2, 0.42],
    [1, 2, 1.05, 0.36],
    [2, 3, 1.1, 0.34],
    [2, 4, 1.55, 0.52],
    [0, 5, 1.35, 0.44],
    [5, 6, 1.1, 0.34],
    [4, 6, 1.2, 0.38],
    [0, 2, 0.72, 0.28],
    [1, 4, 0.68, 0.24],
    [2, 5, 0.78, 0.3],
    [5, 7, 0.72, 0.24],
    [0, 7, 0.9, 0.32],
  ];

  for (const [start, end, width, alpha] of edges) {
    addSegment(
      lines,
      nodes[tower[start]].position,
      nodes[tower[end]].position,
      width,
      alpha,
      0.025,
      22 + start * 0.3 + end * 0.11,
      1,
      1,
    );
  }

  addMeshPatch(
    lines,
    nodes[tower[0]].position,
    nodes[tower[2]].position,
    nodes[tower[4]].position,
    nodes[tower[5]].position,
    8,
    6,
    0.09,
    0.08,
    23.5,
    1,
    0.96,
  );
  addQuad(
    planes,
    nodes[tower[0]].position,
    nodes[tower[2]].position,
    nodes[tower[4]].position,
    nodes[tower[5]].position,
    0.045,
    0.1,
    24.2,
    0.95,
  );
  addPolyline(
    lines,
    [p(foregroundFrame, 2, 3), nodes[tower[0]].position, nodes[tower[4]].position],
    1.15,
    0.34,
    0.04,
    24.8,
    1,
    0.98,
  );
}

function addDepthGhosts(
  lines: LineSegment[],
  rearVault: SheetData,
  middleDeck: SheetData,
  foregroundFrame: SheetData,
): void {
  addPolyline(
    lines,
    [p(rearVault, 0, 1), p(rearVault, 2, 3), p(middleDeck, 0, 5)],
    3.2,
    0.055,
    0.64,
    12.2,
    0.28,
    0.05,
  );
  addPolyline(
    lines,
    [p(rearVault, 4, 0), p(middleDeck, 3, 2), p(foregroundFrame, 0, 4)],
    2.8,
    0.05,
    0.58,
    12.8,
    0.34,
    0.08,
  );
  addPolyline(
    lines,
    [p(rearVault, 1, 5), p(middleDeck, 4, 4), p(foregroundFrame, 5, 5)],
    2.4,
    0.045,
    0.54,
    13.4,
    0.32,
    0.05,
  );
}

function addMeshPatch(
  lines: LineSegment[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  uCount: number,
  vCount: number,
  tone: number,
  alpha: number,
  phase: number,
  layer: number,
  focus: number,
): void {
  for (let index = 1; index < uCount; index += 1) {
    const u = index / uCount;
    addSegment(
      lines,
      bilerp3(a, b, c, d, u, 0),
      bilerp3(a, b, c, d, u, 1),
      0.26,
      alpha,
      tone,
      phase + index * 0.13,
      layer,
      focus,
    );
  }

  for (let index = 1; index < vCount; index += 1) {
    const v = index / vCount;
    addSegment(
      lines,
      bilerp3(a, b, c, d, 0, v),
      bilerp3(a, b, c, d, 1, v),
      0.24,
      alpha * 0.9,
      tone,
      phase + index * 0.17,
      layer,
      focus,
    );
  }

  for (let u = 0; u < uCount - 1; u += 2) {
    for (let v = 0; v < vCount - 1; v += 2) {
      const u0 = u / uCount;
      const v0 = v / vCount;
      const u1 = (u + 1) / uCount;
      const v1 = (v + 1) / vCount;
      addSegment(
        lines,
        bilerp3(a, b, c, d, u0, v0),
        bilerp3(a, b, c, d, u1, v1),
        0.18,
        alpha * 0.48,
        tone + 0.08,
        phase + u * 0.19 + v * 0.11,
        layer,
        focus,
      );
    }
  }
}

function addRailBundle(
  lines: LineSegment[],
  start: Vec3,
  end: Vec3,
  offsetDirection: Vec3,
  count: number,
  width: number,
  alpha: number,
  tone: number,
  phase: number,
  layer: number,
  focus: number,
): void {
  const center = (count - 1) / 2;

  for (let index = 0; index < count; index += 1) {
    const offset = scale3(offsetDirection, index - center);
    const weight = 1 - Math.abs(index - center) / Math.max(1, center + 1);
    addSegment(
      lines,
      add3(start, offset),
      add3(end, offset),
      width * (0.72 + weight * 0.42),
      alpha * (0.58 + weight * 0.42),
      tone,
      phase + index * 0.16,
      layer,
      focus,
    );
  }
}

function addNode(
  nodes: NodePoint[],
  position: Vec3,
  radius: number,
  alpha: number,
  tone: number,
  phase: number,
  kind: number,
): number {
  const index = nodes.length;

  nodes.push({ position, radius, alpha, tone, phase, kind });
  return index;
}

function addPolyline(
  lines: LineSegment[],
  points: Vec3[],
  width: number,
  alpha: number,
  tone: number,
  phase: number,
  layer: number,
  focus: number,
): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    addSegment(
      lines,
      points[index],
      points[index + 1],
      width,
      alpha,
      tone,
      phase + index * 0.37,
      layer,
      focus,
    );
  }
}

function p(sheet: SheetData, row: number, column: number): Vec3 {
  const safeRow = Math.min(sheet.points.length - 1, Math.max(0, row));
  const safeColumn = Math.min(sheet.points[safeRow].length - 1, Math.max(0, column));
  return sheet.points[safeRow][safeColumn];
}

function addSegment(
  lines: LineSegment[],
  start: Vec3,
  end: Vec3,
  width: number,
  alpha: number,
  tone: number,
  phase: number,
  layer: number,
  focus: number,
): void {
  lines.push({
    start,
    end,
    width,
    alpha,
    tone: clamp01(tone),
    phase,
    focus,
    layer,
  });
}

function addQuad(
  planes: PlaneVertex[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  alpha: number,
  tone: number,
  phase: number,
  focus: number,
): void {
  const normal = normalize3(cross3(subtract3(b, a), subtract3(c, a)));
  addPlaneTriangle(planes, a, b, c, normal, alpha, tone, phase, focus);
  addPlaneTriangle(planes, a, c, d, normal, alpha, tone, phase, focus);
}

function addPlaneTriangle(
  planes: PlaneVertex[],
  a: Vec3,
  b: Vec3,
  c: Vec3,
  normal: Vec3,
  alpha: number,
  tone: number,
  phase: number,
  focus: number,
): void {
  planes.push(
    { position: a, normal, alpha, tone, phase, focus },
    { position: b, normal, alpha, tone, phase, focus },
    { position: c, normal, alpha, tone, phase, focus },
  );
}

function serializeLines(lines: LineSegment[]): Float32Array {
  const data = new Float32Array(lines.length * LINE_FLOATS);

  lines.forEach((line, index) => {
    const offset = index * LINE_FLOATS;
    data.set(
      [
        line.start[0],
        line.start[1],
        line.start[2],
        line.width,
        line.end[0],
        line.end[1],
        line.end[2],
        line.alpha,
        line.tone,
        line.phase,
        line.focus,
        line.layer,
      ],
      offset,
    );
  });

  return data;
}

function serializeNodes(nodes: NodePoint[]): Float32Array {
  const data = new Float32Array(nodes.length * NODE_FLOATS);

  nodes.forEach((node, index) => {
    const offset = index * NODE_FLOATS;
    data.set(
      [
        node.position[0],
        node.position[1],
        node.position[2],
        node.radius,
        node.alpha,
        node.tone,
        node.phase,
        node.kind,
      ],
      offset,
    );
  });

  return data;
}

function serializePlanes(planes: PlaneVertex[]): Float32Array {
  const data = new Float32Array(planes.length * PLANE_FLOATS);

  planes.forEach((plane, index) => {
    const offset = index * PLANE_FLOATS;
    data.set(
      [
        plane.position[0],
        plane.position[1],
        plane.position[2],
        plane.alpha,
        plane.normal[0],
        plane.normal[1],
        plane.normal[2],
        plane.tone,
        plane.phase,
        plane.focus,
      ],
      offset,
    );
  });

  return data;
}

function resizeCanvas(canvas: HTMLCanvasElement, device: GPUDevice): boolean {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.4);
  const width = Math.max(
    1,
    Math.min(device.limits.maxTextureDimension2D, Math.floor(rect.width * pixelRatio)),
  );
  const height = Math.max(
    1,
    Math.min(device.limits.maxTextureDimension2D, Math.floor(rect.height * pixelRatio)),
  );

  if (canvas.width === width && canvas.height === height) {
    return false;
  }

  canvas.width = width;
  canvas.height = height;
  return true;
}

type Vec3 = [number, number, number];

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const rangeInv = 1 / (near - far);
  const out = new Float32Array(16);

  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * rangeInv;
  out[11] = -1;
  out[14] = 2 * far * near * rangeInv;

  return out;
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const z = normalize3(subtract3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  const out = new Float32Array(16);

  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -dot3(x, eye);
  out[13] = -dot3(y, eye);
  out[14] = -dot3(z, eye);
  out[15] = 1;

  return out;
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  const a00 = a[0];
  const a01 = a[1];
  const a02 = a[2];
  const a03 = a[3];
  const a10 = a[4];
  const a11 = a[5];
  const a12 = a[6];
  const a13 = a[7];
  const a20 = a[8];
  const a21 = a[9];
  const a22 = a[10];
  const a23 = a[11];
  const a30 = a[12];
  const a31 = a[13];
  const a32 = a[14];
  const a33 = a[15];

  let b0 = b[0];
  let b1 = b[1];
  let b2 = b[2];
  let b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  return out;
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale3(value: Vec3, amount: number): Vec3 {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function mix3(a: Vec3, b: Vec3, amount: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function bilerp3(a: Vec3, b: Vec3, c: Vec3, d: Vec3, u: number, v: number): Vec3 {
  return mix3(mix3(a, b, u), mix3(d, c, u), v);
}

function normalize3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
