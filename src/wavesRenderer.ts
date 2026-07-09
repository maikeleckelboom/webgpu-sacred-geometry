import { defaultVisualControls } from "./visualControls";
import wavesShaderSource from "./shaders/waves.wgsl?raw";

const WAVES_CONTROLS = defaultVisualControls.geometry.waves;
const SAMPLE_COUNT = defaultVisualControls.performance.sampleCount.waves;
const LINE_FLOATS = 8;
const UNIFORM_FLOATS = 8;

export interface WavesRenderer {
  destroy: () => void;
}

interface Point {
  x: number;
  y: number;
}

interface SegmentStyle {
  width: number;
  alpha: number;
  tone: number;
  softness: number;
}

export async function startWavesRenderer(canvas: HTMLCanvasElement): Promise<WavesRenderer> {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is not available in this browser. The graphite wave field needs a WebGPU-capable browser.",
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
  const waveSegments = createWaveSegments();
  const segmentBuffer = device.createBuffer({
    label: "waves streamline segments",
    size: waveSegments.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const uniformBuffer = device.createBuffer({
    label: "waves scene uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(segmentBuffer, 0, waveSegments);

  const module = device.createShaderModule({
    label: "waves streamline shader",
    code: wavesShaderSource,
  });
  const pipeline = device.createRenderPipeline({
    label: "waves streamline pipeline",
    layout: "auto",
    vertex: {
      module,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: LINE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
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
      entryPoint: "fragmentMain",
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
    label: "waves scene bind group",
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  const abortController = new AbortController();
  let multisampleTexture: GPUTexture | null = null;
  let animationFrame = 0;
  let active = true;
  let checkedFirstFrame = false;

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
      label: "waves multisample target",
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

    const pixelRatio = Math.min(
      window.devicePixelRatio || 1,
      defaultVisualControls.performance.maxPixelRatio.wavesUniform,
    );
    uniforms.set(
      [canvas.width, canvas.height, pixelRatio, canvas.width / Math.max(1, canvas.height)],
      0,
    );
    uniforms.set([time * 0.001, 0, 0, 0], 4);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder({
      label: "waves frame encoder",
    });

    if (!checkedFirstFrame) {
      device.pushErrorScope("validation");
    }

    const pass = encoder.beginRenderPass({
      label: "waves render pass",
      colorAttachments: [
        {
          view: multisampleTexture.createView(),
          resolveTarget: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.976, g: 0.974, b: 0.958, a: 1 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, segmentBuffer);
    pass.draw(6, waveSegments.length / LINE_FLOATS);
    pass.end();

    device.queue.submit([encoder.finish()]);

    if (!checkedFirstFrame) {
      checkedFirstFrame = true;
      void device.popErrorScope().then((frameError) => {
        if (frameError) {
          console.error(`Waves WebGPU frame failed: ${frameError.message}`);
        }
      });
    }

    if (!checkedFirstFrame) {
      scheduleFrame();
    }
  }

  function scheduleFrame(): void {
    if (!active || document.hidden || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(renderFrame);
  }

  const renderer: WavesRenderer = {
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

function createWaveSegments(): Float32Array {
  const data: number[] = [];
  const rowCount = WAVES_CONTROLS.rowCount;

  for (let row = 0; row < rowCount; row += 1) {
    const rowAmount = row / (rowCount - 1);
    const lane = (row - rowCount * 0.5) * 0.044;
    const points = createWarpedLine(rowAmount, lane, row);

    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];

      if (!segmentIntersectsView(a, b)) {
        continue;
      }

      const mid = {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
      };
      const style = streamlineStyle(mid, rowAmount, lane);

      if (style.alpha <= 0.001) {
        continue;
      }

      pushSegment(data, a, b, {
        width: style.width * 2.05,
        alpha: style.alpha * 0.08,
        tone: Math.max(0, style.tone - 0.14),
        softness: 0.82,
      });

      pushSegment(data, a, b, style);
    }
  }

  addAccentArcs(data);

  return new Float32Array(data);
}

function createWarpedLine(rowAmount: number, lane: number, row: number): Point[] {
  const points: Point[] = [];
  const pointCount = WAVES_CONTROLS.pointCount;
  const sourceY = -0.24 + rowAmount * 1.56 + Math.sin(row * 1.713) * 0.0025;

  for (let index = 0; index < pointCount; index += 1) {
    const x = -0.24 + (index / (pointCount - 1)) * 1.62;
    points.push(warpPoint({ x, y: sourceY }, lane));
  }

  return points;
}

function warpPoint(source: Point, lane: number): Point {
  const centerX = 0.63;
  const centerY = 0.395;
  let x = source.x;
  let y =
    source.y +
    Math.sin(source.x * 3.6 + source.y * 3.8 + lane * 0.12) * 0.052 +
    Math.sin(source.x * 8.4 - source.y * 2.7 + lane * 0.16) * 0.018;
  const wideLift = Math.exp(-square((source.x - 0.52) / 0.58) - square((source.y - 0.76) / 0.24));
  const topFall = Math.exp(-square((source.x - 0.72) / 0.56) - square((source.y - 0.19) / 0.18));

  y += topFall * 0.06 - wideLift * 0.065;

  const dx = x - centerX;
  const dy = y - centerY;
  const normalizedX = dx / 0.37;
  const normalizedY = dy / 0.255;
  const radiusSquared = normalizedX * normalizedX + normalizedY * normalizedY;
  const influence = Math.exp(-radiusSquared * 0.72);
  const rotation = (-1.34 * influence) / (0.72 + radiusSquared * 0.24);
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  const rotatedX = dx * cosRotation - dy * sinRotation;
  const rotatedY = dx * sinRotation + dy * cosRotation;
  const compression = 1 - influence * 0.055;

  x = centerX + rotatedX * compression + Math.sin((source.y - centerY) * 10.5) * influence * 0.018;
  y = centerY + rotatedY * (1 - influence * 0.04);

  return { x, y };
}

function traceStreamline(origin: Point, lane: number, steps: number): Point[] {
  const points: Point[] = [origin];
  let point = origin;
  const stepSize = 0.0089;

  for (let step = 0; step < steps; step += 1) {
    const first = flowAt(point, lane);
    const midpoint = {
      x: point.x + first.x * stepSize * 0.5,
      y: point.y + first.y * stepSize * 0.5,
    };
    const second = flowAt(midpoint, lane);
    point = {
      x: point.x + second.x * stepSize,
      y: point.y + second.y * stepSize,
    };
    points.push(point);

    if (point.x > 1.16 || point.y < -0.24 || point.y > 1.22) {
      break;
    }
  }

  return points;
}

function flowAt(point: Point, lane: number): Point {
  const primary = vortexContribution(point, 0.685, 0.425, 1.42, 0.92, 1.55, 1.86);
  const upper = vortexContribution(point, 0.71, 0.19, 1.18, 1.34, 2.7, 0.54);
  const lower = vortexContribution(point, 0.62, 0.73, 1, 1.1, 2.05, -0.42);
  const trough = Math.exp(-square((point.x - 0.55) / 0.38) - square((point.y - 0.63) / 0.27));
  const highSweep = Math.exp(-square((point.x - 0.72) / 0.55) - square((point.y - 0.17) / 0.2));
  const lowSweep = Math.exp(-square((point.x - 0.5) / 0.58) - square((point.y - 0.86) / 0.24));

  let x = 1.0;
  let y =
    Math.sin(point.x * 4.1 + lane * 0.34) * 0.07 +
    Math.sin(point.x * 8.2 - point.y * 2.4 + lane * 0.18) * 0.043 +
    Math.cos(point.x * 2.6 + point.y * 4.4 - lane * 0.12) * 0.032;

  x += primary.x + upper.x + lower.x;
  y += primary.y + upper.y + lower.y;
  y += trough * -0.18 + highSweep * 0.08 + lowSweep * -0.13;
  x += Math.exp(-square((point.x - 0.78) / 0.36) - square((point.y - 0.46) / 0.24)) * 0.2;
  x = Math.max(0.16, x);

  const length = Math.hypot(x, y) || 1;
  return {
    x: x / length,
    y: y / length,
  };
}

function vortexContribution(
  point: Point,
  centerX: number,
  centerY: number,
  scaleX: number,
  scaleY: number,
  falloff: number,
  spin: number,
): Point {
  const dx = (point.x - centerX) * scaleX;
  const dy = (point.y - centerY) * scaleY;
  const radiusSquared = dx * dx + dy * dy + 0.006;
  const shell = Math.exp(-radiusSquared * falloff);
  const inner = 1 / (0.2 + radiusSquared * 2.65);
  const orbit = shell * inner * spin;
  const pull = shell * 0.18;

  return {
    x: -dy * orbit - dx * pull,
    y: dx * orbit - dy * pull,
  };
}

function streamlineStyle(point: Point, rowAmount: number, lane: number): SegmentStyle {
  const center = ellipticalFocus(point, 0.685, 0.425, 0.36, 0.255);
  const throat = ellipticalFocus(point, 0.57, 0.5, 0.34, 0.18);
  const lowerBand = ellipticalFocus(point, 0.57, 0.71, 0.6, 0.18);
  const rightMask = smoothstep(-0.18, 0.12, point.x);
  const topMask = smoothstep(-0.2, -0.02, point.y);
  const bottomMask = 1 - smoothstep(1.18, 1.36, point.y);
  const farRightMask = 1 - smoothstep(1.2, 1.42, point.x);
  const paperFade = rightMask * topMask * bottomMask * farRightMask;
  const rowRhythm = 0.86 + Math.sin(rowAmount * Math.PI * 17 + lane) * 0.14;
  const mainBand =
    Math.exp(-square((rowAmount - 0.49) / 0.055)) * ellipticalFocus(point, 0.5, 0.54, 0.44, 0.13);
  const density = 0.2 + center * 0.78 + throat * 0.4 + lowerBand * 0.22 + mainBand * 0.64;
  const alpha = clamp01(paperFade * rowRhythm * (0.042 + density * 0.152));
  const tone = clamp01(0.34 + center * 0.54 + throat * 0.28 + mainBand * 0.52 + lowerBand * 0.18);
  const width = 0.44 + center * 0.38 + throat * 0.18 + mainBand * 0.22;

  return {
    width,
    alpha: alpha * 0.82,
    tone,
    softness: 0.02 + center * 0.035,
  };
}

function addAccentArcs(data: number[]): void {
  const arcs = [
    { y: 0.52, lane: 0.04, tone: 0.92, alpha: 0.062, width: 1.42 },
    { y: 0.565, lane: 0.28, tone: 0.7, alpha: 0.04, width: 1.22 },
    { y: 0.372, lane: -0.46, tone: 0.62, alpha: 0.034, width: 1.12 },
  ];

  for (const arc of arcs) {
    const points = traceStreamline({ x: 0.12, y: arc.y }, arc.lane, 142);

    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index];
      const b = points[index + 1];
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const focus = ellipticalFocus({ x: midX, y: midY }, 0.61, 0.49, 0.31, 0.15);
      const mask = smoothstep(0.28, 0.48, midX) * (1 - smoothstep(0.84, 1.0, midX)) * focus;

      if (mask <= 0.002) {
        continue;
      }

      pushSegment(data, a, b, {
        width: arc.width * 1.5,
        alpha: arc.alpha * mask * 0.06,
        tone: arc.tone,
        softness: 0.62,
      });
      pushSegment(data, a, b, {
        width: arc.width * 0.78,
        alpha: arc.alpha * mask * 0.72,
        tone: arc.tone,
        softness: 0.03,
      });
    }
  }
}

function pushSegment(data: number[], start: Point, end: Point, style: SegmentStyle): void {
  data.push(start.x, start.y, end.x, end.y, style.width, style.alpha, style.tone, style.softness);
}

function segmentIntersectsView(a: Point, b: Point): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  return maxX >= -0.24 && minX <= 1.24 && maxY >= -0.2 && minY <= 1.24;
}

function ellipticalFocus(
  point: Point,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
): number {
  return Math.exp(-square((point.x - centerX) / radiusX) - square((point.y - centerY) / radiusY));
}

function resizeCanvas(canvas: HTMLCanvasElement, device: GPUDevice): boolean {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    defaultVisualControls.performance.maxPixelRatio.waves,
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
