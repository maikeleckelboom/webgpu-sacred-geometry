import flowSheetShaderSource from "./shaders/flow-sheet.wgsl?raw";
import { defaultVisualControls } from "./visualControls";

const FLOW_SHEET_CONTROLS = defaultVisualControls.geometry.flowSheet;
const POINTER_CONTROLS = defaultVisualControls.pointer.flowSheet;
const SAMPLE_COUNT = defaultVisualControls.performance.sampleCount.flowSheet;
const SEGMENT_FLOATS = 16;
const SURFACE_FLOATS = 6;
const UNIFORM_FLOATS = 16;

export interface FlowSheetRenderer {
  destroy: () => void;
}

interface Point {
  x: number;
  y: number;
  depth: number;
}

interface SegmentStyle {
  width: number;
  alpha: number;
  tone: number;
  softness: number;
}

interface SegmentMotion {
  phase: number;
  row: number;
  layer: number;
}

export async function startFlowSheetRenderer(
  canvas: HTMLCanvasElement,
): Promise<FlowSheetRenderer> {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available in this browser. The dimensional flow sheet needs a WebGPU-capable browser.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });

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
  const segments = createFlowSheetSegments();
  const surfaceVertices = createSurfaceVertices();
  const segmentBuffer = device.createBuffer({
    label: "flow sheet segments",
    size: segments.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const surfaceBuffer = device.createBuffer({
    label: "flow sheet surface",
    size: surfaceVertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const uniformBuffer = device.createBuffer({
    label: "flow sheet uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(segmentBuffer, 0, segments);
  device.queue.writeBuffer(surfaceBuffer, 0, surfaceVertices);

  const module = device.createShaderModule({
    label: "flow sheet shader",
    code: flowSheetShaderSource,
  });
  const compilationInfo = await module.getCompilationInfo();
  const compilationErrors = compilationInfo.messages.filter(({ type }) => type === "error");

  if (compilationErrors.length > 0) {
    const details = compilationErrors
      .map(({ lineNum, linePos, message }) => `${lineNum}:${linePos} ${message}`)
      .join("\n");
    throw new Error(`Flow sheet shader compilation failed:\n${details}`);
  }

  const pipeline = device.createRenderPipeline({
    label: "flow sheet pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: SEGMENT_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
            { shaderLocation: 2, offset: 32, format: "float32x4" },
            { shaderLocation: 3, offset: 48, format: "float32x4" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "fragmentMain",
      targets: [blendTarget(format)],
    },
    primitive: { topology: "triangle-list" },
    multisample: { count: SAMPLE_COUNT },
  });
  const surfacePipeline = device.createRenderPipeline({
    label: "flow sheet surface pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "surfaceVertexMain",
      buffers: [
        {
          arrayStride: SURFACE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: "surfaceFragmentMain",
      targets: [blendTarget(format)],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
    multisample: { count: SAMPLE_COUNT },
  });
  const bindGroup = device.createBindGroup({
    label: "flow sheet bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });
  const surfaceBindGroup = device.createBindGroup({
    label: "flow sheet surface bind group",
    layout: surfacePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  const abortController = new AbortController();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motionScale = reducedMotion ? POINTER_CONTROLS.reducedMotionScale : 1;
  const pointer = {
    x: 0.5,
    y: 0.54,
    targetX: 0.5,
    targetY: 0.54,
    strength: 0,
    targetStrength: 0,
  };
  const grab = {
    x: 0.5,
    y: 0.54,
    strength: 0,
    targetStrength: 0,
    releaseAfter: 0,
    releaseRequested: false,
  };
  let multisampleTexture: GPUTexture | null = null;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;
  let pressedPointerId: number | null = null;

  canvas.addEventListener(
    "pointermove",
    (event) => {
      updatePointerTarget(event);
      pointer.targetStrength = 1;

      if (pressedPointerId === event.pointerId) {
        grab.x = pointer.targetX;
        grab.y = pointer.targetY;
      }
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      updatePointerTarget(event);
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
      pointer.strength = 1;
      pointer.targetStrength = 1;
      grab.x = pointer.targetX;
      grab.y = pointer.targetY;
      grab.strength = 1;
      grab.targetStrength = 1;
      grab.releaseAfter = performance.now() * 0.001 + 0.45;
      grab.releaseRequested = false;
      pressedPointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    },
    { signal: abortController.signal },
  );
  const releaseGrab = (event: PointerEvent): void => {
    if (pressedPointerId !== event.pointerId) {
      return;
    }

    grab.releaseRequested = true;
    pressedPointerId = null;

    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener("pointerup", releaseGrab, { signal: abortController.signal });
  canvas.addEventListener("pointercancel", releaseGrab, { signal: abortController.signal });
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.targetStrength = 0;
    },
    { signal: abortController.signal },
  );
  window.addEventListener("resize", scheduleFrame, { signal: abortController.signal });

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        scheduleFrame();
      }
    },
    { signal: abortController.signal },
  );

  function updatePointerTarget(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    pointer.targetX = clamp01((event.clientX - rect.left) / Math.max(1, rect.width));
    pointer.targetY = clamp01((event.clientY - rect.top) / Math.max(1, rect.height));
  }

  function refreshTargets(): void {
    if (!resizeCanvas(canvas, device) && multisampleTexture) {
      return;
    }

    gpuContext.configure({ device, format, alphaMode: "opaque" });
    multisampleTexture?.destroy();
    multisampleTexture = device.createTexture({
      label: "flow sheet multisample target",
      size: { width: canvas.width, height: canvas.height },
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

    pointer.x += (pointer.targetX - pointer.x) * POINTER_CONTROLS.lerpRate;
    pointer.y += (pointer.targetY - pointer.y) * POINTER_CONTROLS.lerpRate;
    pointer.strength += (pointer.targetStrength - pointer.strength) * POINTER_CONTROLS.lerpRate;

    if (pointer.targetStrength === 0) {
      pointer.strength *= POINTER_CONTROLS.idleDecay;
    }

    const timeSeconds = time * 0.001;

    if (grab.releaseRequested && timeSeconds >= grab.releaseAfter) {
      grab.targetStrength = 0;
      grab.releaseRequested = false;
    }

    const grabRate =
      grab.targetStrength > grab.strength
        ? POINTER_CONTROLS.grabResponse
        : POINTER_CONTROLS.grabRelease;
    grab.strength += (grab.targetStrength - grab.strength) * grabRate;

    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      defaultVisualControls.performance.maxPixelRatio.flowSheet,
    );
    uniforms.set(
      [canvas.width, canvas.height, pixelRatio, canvas.width / Math.max(1, canvas.height)],
      0,
    );
    uniforms.set([pointer.x, pointer.y, pointer.strength, motionScale], 4);
    uniforms.set([grab.x, grab.y, grab.strength, pressedPointerId === null ? 0 : 1], 8);
    uniforms.set([timeSeconds, 0, 0, 0], 12);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder({ label: "flow sheet frame encoder" });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const pass = encoder.beginRenderPass({
      label: "flow sheet render pass",
      colorAttachments: [
        {
          view: multisampleTexture.createView(),
          resolveTarget: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.982, g: 0.982, b: 0.974, a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    pass.setPipeline(surfacePipeline);
    pass.setBindGroup(0, surfaceBindGroup);
    pass.setVertexBuffer(0, surfaceBuffer);
    pass.draw(surfaceVertices.length / SURFACE_FLOATS);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, segmentBuffer);
    pass.draw(6, segments.length / SEGMENT_FLOATS);
    pass.end();
    device.queue.submit([encoder.finish()]);

    if (!checkedFirstFrame) {
      checkedFirstFrame = true;
      void device.popErrorScope().then((frameError) => {
        if (frameError) {
          console.error(`Flow sheet WebGPU frame failed: ${frameError.message}`);
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

  const renderer: FlowSheetRenderer = {
    destroy: () => {
      if (!active) {
        return;
      }

      active = false;
      abortController.abort();

      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame);
      }

      multisampleTexture?.destroy();
      surfaceBuffer.destroy();
      segmentBuffer.destroy();
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

function createSurfaceVertices(): Float32Array {
  const columnCount = 96;
  const rowCount = 56;
  const points: Point[][] = [];

  for (let row = 0; row < rowCount; row += 1) {
    const lane = -1.08 + (row / (rowCount - 1)) * 2.16;
    const pointRow: Point[] = [];

    for (let column = 0; column < columnCount; column += 1) {
      const x = -0.22 + (column / (columnCount - 1)) * 1.44;
      pointRow.push(foldSheetPoint(x, lane, 0, 0));
    }

    points.push(pointRow);
  }

  const normals = points.map((pointRow, row) =>
    pointRow.map((_, column) => {
      const left = points[row][Math.max(0, column - 1)];
      const right = points[row][Math.min(columnCount - 1, column + 1)];
      const above = points[Math.max(0, row - 1)][column];
      const below = points[Math.min(rowCount - 1, row + 1)][column];
      return normalizePoint(crossPoint(subtractPoint(right, left), subtractPoint(below, above)));
    }),
  );
  const data: number[] = [];

  for (let row = 0; row < rowCount - 1; row += 1) {
    for (let column = 0; column < columnCount - 1; column += 1) {
      pushSurfaceVertex(data, points[row][column], normals[row][column]);
      pushSurfaceVertex(data, points[row + 1][column], normals[row + 1][column]);
      pushSurfaceVertex(data, points[row][column + 1], normals[row][column + 1]);
      pushSurfaceVertex(data, points[row][column + 1], normals[row][column + 1]);
      pushSurfaceVertex(data, points[row + 1][column], normals[row + 1][column]);
      pushSurfaceVertex(data, points[row + 1][column + 1], normals[row + 1][column + 1]);
    }
  }

  return new Float32Array(data);
}

function pushSurfaceVertex(data: number[], point: Point, normal: Point): void {
  data.push(point.x, point.y, point.depth, normal.x, normal.y, normal.depth);
}

function subtractPoint(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y, depth: a.depth - b.depth };
}

function crossPoint(a: Point, b: Point): Point {
  return {
    x: a.y * b.depth - a.depth * b.y,
    y: a.depth * b.x - a.x * b.depth,
    depth: a.x * b.y - a.y * b.x,
  };
}

function normalizePoint(point: Point): Point {
  const length = Math.hypot(point.x, point.y, point.depth) || 1;
  return { x: point.x / length, y: point.y / length, depth: point.depth / length };
}

function createFlowSheetSegments(): Float32Array {
  const data: number[] = [];
  const layerCount: number = FLOW_SHEET_CONTROLS.layerCount;
  const rowsPerLayer: number = FLOW_SHEET_CONTROLS.rowsPerLayer;
  const pointCount: number = FLOW_SHEET_CONTROLS.pointCount;

  for (let layer = 0; layer < layerCount; layer += 1) {
    const layerAmount = layerCount > 1 ? layer / (layerCount - 1) : 0.5;
    const depth = -1 + layerAmount * 2;
    const phase = layer * 1.618;

    for (let row = 0; row < rowsPerLayer; row += 1) {
      const rowAmount = row / (rowsPerLayer - 1);
      const lane =
        -1.08 +
        rowAmount * 2.16 +
        (layerAmount - 0.5) * 0.018 +
        Math.sin((row + layer * 17) * 1.713) * 0.004;
      let previous = foldSheetPoint(-0.22, lane, depth, phase);

      for (let index = 1; index < pointCount; index += 1) {
        const x = -0.22 + (index / (pointCount - 1)) * 1.44;
        const current = foldSheetPoint(x, lane, depth, phase);

        if (segmentIntersectsView(previous, current)) {
          const midX = (previous.x + current.x) * 0.5;
          const midY = (previous.y + current.y) * 0.5;
          const style = segmentStyle(midX, midY, rowAmount, depth);
          const motion = { phase, row: rowAmount, layer: layerAmount };

          if (style.alpha > 0.001) {
            if (style.tone > 0.42) {
              pushSegment(data, previous, current, {
                ...style,
                width: style.width * 2.35,
                alpha: style.alpha * 0.1,
                softness: 0.88,
              }, motion);
            }

            pushSegment(data, previous, current, style, motion);
          }
        }

        previous = current;
      }
    }
  }

  return new Float32Array(data);
}

function foldSheetPoint(x: number, lane: number, depth: number, phase: number): Point {
  const pinch = Math.exp(-square((x - 0.5) / 0.205));
  const rightFan = smoothstep(0.44, 1.12, x);
  const depthWave = Math.sin(lane * 2.15 + x * 2.7 + phase) * 0.085;
  const fineDepth = Math.sin(x * 6.2 - lane * 1.4 + phase * 0.6) * 0.026;
  const z = depth * 0.22 + depthWave + fineDepth;
  const center =
    0.53 + Math.sin((x - 0.05) * 2.35) * 0.014 + pinch * 0.004 - rightFan * 0.008;
  const spread = 0.88 - pinch * 0.04 + rightFan * 0.04;
  const crossSection = lane * 0.43 * spread;
  const fan = rightFan * (lane * 0.022 + Math.sign(lane) * lane * lane * 0.008);
  const surfaceRipple = Math.sin(x * 4.8 + lane * 2.0 + phase) * 0.01;

  return {
    x,
    y: center + crossSection + fan + surfaceRipple,
    depth: z,
  };
}

function segmentStyle(
  x: number,
  y: number,
  rowAmount: number,
  depth: number,
): SegmentStyle {
  const throat = Math.exp(-square((x - 0.5) / 0.24) - square((y - 0.56) / 0.2));
  const centerBand = Math.exp(-square((rowAmount - 0.5) / 0.13));
  const horizontalFade = smoothstep(-0.18, 0.02, x) * (1 - smoothstep(1.08, 1.22, x));
  const verticalFade = smoothstep(-0.14, 0.03, y) * (1 - smoothstep(0.98, 1.13, y));
  const layerRhythm = 0.86 + Math.sin(rowAmount * Math.PI * 21 + depth * 3.4) * 0.14;
  const rowEnvelope = 0.7 + Math.pow(Math.sin(rowAmount * Math.PI), 0.45) * 0.3;
  const alpha =
    horizontalFade *
    verticalFade *
    layerRhythm *
    rowEnvelope *
    (0.064 + throat * 0.065 + centerBand * throat * 0.055 + (1 - Math.abs(depth)) * 0.01);

  return {
    width: 0.54 + throat * 0.34 + (1 - Math.abs(depth)) * 0.1,
    alpha: clamp01(alpha),
    tone: clamp01(0.3 + throat * 0.48 + centerBand * 0.14 + (1 - Math.abs(depth)) * 0.08),
    softness: 0.035 + Math.abs(depth) * 0.055,
  };
}

function pushSegment(
  data: number[],
  start: Point,
  end: Point,
  style: SegmentStyle,
  motion: SegmentMotion,
): void {
  data.push(
    start.x,
    start.y,
    start.depth,
    0,
    end.x,
    end.y,
    end.depth,
    0,
    style.width,
    style.alpha,
    style.tone,
    style.softness,
    motion.phase,
    motion.row,
    motion.layer,
    0,
  );
}

function segmentIntersectsView(a: Point, b: Point): boolean {
  return (
    Math.max(a.x, b.x) >= -0.2 &&
    Math.min(a.x, b.x) <= 1.2 &&
    Math.max(a.y, b.y) >= -0.16 &&
    Math.min(a.y, b.y) <= 1.16
  );
}

function resizeCanvas(canvas: HTMLCanvasElement, device: GPUDevice): boolean {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    defaultVisualControls.performance.maxPixelRatio.flowSheet,
  );
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

function smoothstep(edge0: number, edge1: number, value: number): number {
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function square(value: number): number {
  return value * value;
}
