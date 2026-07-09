import { defaultVisualControls, type TopographyShapeControl } from "./visualControls";
import topographyReliefShaderSource from "./shaders/topography-relief.wgsl?raw";
import topographyPostShaderSource from "./shaders/topography-post.wgsl?raw";

const TOPOGRAPHY_CONTROLS = defaultVisualControls.geometry.topography;
const TOPOGRAPHY_POINTER_CONTROLS = defaultVisualControls.pointer.topography;
const SEGMENTS = TOPOGRAPHY_CONTROLS.segments;
const UNIFORM_FLOATS = 36;
const FLOATS_PER_VERTEX = 10;
const SAMPLE_COUNT = defaultVisualControls.performance.sampleCount.topography;

interface ReliefMesh {
  vertices: Float32Array;
  vertexCount: number;
}

type ContourShape = TopographyShapeControl;

interface PointerState {
  x: number;
  y: number;
  strength: number;
}

export interface TopographyRenderer {
  destroy: () => void;
}

interface LoopPoint {
  x: number;
  z: number;
  outwardX: number;
  outwardZ: number;
}

class ReliefBuilder {
  private readonly data: number[] = [];

  get vertexCount(): number {
    return this.data.length / FLOATS_PER_VERTEX;
  }

  mesh(): ReliefMesh {
    return {
      vertices: new Float32Array(this.data),
      vertexCount: this.vertexCount,
    };
  }

  floor(): void {
    const y = -0.012;
    const seed = 0.37;
    this.triangle([-3.6, y, 2.2], [3.8, y, 2.2], [-3.6, y, -3.15], [0, 1, 0], 2, 0, 0.3, seed);
    this.triangle([3.8, y, 2.2], [3.8, y, -3.15], [-3.6, y, -3.15], [0, 1, 0], 2, 0, 0.3, seed);
  }

  shape(shape: ContourShape): void {
    const loops: LoopPoint[][] = [];

    for (let level = 0; level <= shape.levels; level += 1) {
      loops.push(createLoop(shape, level / shape.levels));
    }

    for (let level = 0; level < shape.levels; level += 1) {
      const lower = loops[level];
      const upper = loops[level + 1];
      const lowerHeight = layerHeight(shape, level);
      const upperHeight = layerHeight(shape, level + 1);
      const shade = level / shape.levels;
      const nextShade = (level + 1) / shape.levels;
      const seed = shape.phase + level * 0.137;

      this.topRing(lower, upper, lowerHeight, shade, shape.focus, seed);
      this.sideWall(upper, lowerHeight, upperHeight, nextShade, shape.focus, seed + 7.0);
    }

    this.cap(
      loops[shape.levels],
      layerHeight(shape, shape.levels),
      1,
      shape.focus,
      shape.phase + 17.0,
    );
  }

  private topRing(
    outer: LoopPoint[],
    inner: LoopPoint[],
    y: number,
    shade: number,
    focus: number,
    seed: number,
  ): void {
    for (let index = 0; index < outer.length; index += 1) {
      const next = (index + 1) % outer.length;
      const a: Vec3 = [outer[index].x, y, outer[index].z];
      const b: Vec3 = [outer[next].x, y, outer[next].z];
      const c: Vec3 = [inner[index].x, y, inner[index].z];
      const d: Vec3 = [inner[next].x, y, inner[next].z];

      this.triangle(a, c, b, [0, 1, 0], 0, shade, focus, seed + index * 0.01);
      this.triangle(b, c, d, [0, 1, 0], 0, shade, focus, seed + index * 0.01);
    }
  }

  private sideWall(
    loop: LoopPoint[],
    lowerHeight: number,
    upperHeight: number,
    shade: number,
    focus: number,
    seed: number,
  ): void {
    for (let index = 0; index < loop.length; index += 1) {
      const next = (index + 1) % loop.length;
      const current = loop[index];
      const following = loop[next];
      const normal = normalize3([
        current.outwardX + following.outwardX,
        0.18,
        current.outwardZ + following.outwardZ,
      ]);
      const a: Vec3 = [current.x, lowerHeight, current.z];
      const b: Vec3 = [following.x, lowerHeight, following.z];
      const c: Vec3 = [current.x, upperHeight, current.z];
      const d: Vec3 = [following.x, upperHeight, following.z];

      this.triangle(a, b, c, normal, 1, shade, focus, seed + index * 0.01);
      this.triangle(b, d, c, normal, 1, shade, focus, seed + index * 0.01);
    }
  }

  private cap(loop: LoopPoint[], y: number, shade: number, focus: number, seed: number): void {
    const center = loopCenter(loop, y);

    for (let index = 0; index < loop.length; index += 1) {
      const next = (index + 1) % loop.length;
      const a: Vec3 = [loop[index].x, y, loop[index].z];
      const b: Vec3 = [loop[next].x, y, loop[next].z];
      this.triangle(center, a, b, [0, 1, 0], 0, shade, focus, seed + index * 0.01);
    }
  }

  private triangle(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    normal: Vec3,
    material: number,
    shade: number,
    focus: number,
    seed: number,
  ): void {
    this.vertex(a, normal, material, shade, focus, seed);
    this.vertex(b, normal, material, shade, focus, seed);
    this.vertex(c, normal, material, shade, focus, seed);
  }

  private vertex(
    position: Vec3,
    normal: Vec3,
    material: number,
    shade: number,
    focus: number,
    seed: number,
  ): void {
    this.data.push(
      position[0],
      position[1],
      position[2],
      normal[0],
      normal[1],
      normal[2],
      material,
      shade,
      focus,
      seed,
    );
  }
}

export async function startTopographyRenderer(
  canvas: HTMLCanvasElement,
): Promise<TopographyRenderer> {
  if (!navigator.gpu) {
    throw new Error(
      "This browser does not expose navigator.gpu. Use a WebGPU-capable Chromium, Edge, or Safari build.",
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
  const mesh = createReliefMesh();
  const vertexBuffer = device.createBuffer({
    label: "topography relief vertices",
    size: mesh.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const uniformBuffer = device.createBuffer({
    label: "topography scene uniforms",
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);

  const reliefModule = device.createShaderModule({
    label: "topography relief shader",
    code: topographyReliefShaderSource,
  });
  const postModule = device.createShaderModule({
    label: "topography post shader",
    code: topographyPostShaderSource,
  });
  const reliefPipeline = device.createRenderPipeline({
    label: "topography relief pipeline",
    layout: "auto",
    vertex: {
      module: reliefModule,
      entryPoint: "vertexMain",
      buffers: [
        {
          arrayStride: FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
            { shaderLocation: 2, offset: 24, format: "float32" },
            { shaderLocation: 3, offset: 28, format: "float32" },
            { shaderLocation: 4, offset: 32, format: "float32" },
            { shaderLocation: 5, offset: 36, format: "float32" },
          ],
        },
      ],
    },
    fragment: {
      module: reliefModule,
      entryPoint: "fragmentMain",
      targets: [{ format }],
    },
    primitive: {
      topology: "triangle-list",
    },
    multisample: {
      count: SAMPLE_COUNT,
    },
    depthStencil: {
      format: "depth24plus",
      depthWriteEnabled: true,
      depthCompare: "less",
    },
  });
  const postPipeline = device.createRenderPipeline({
    label: "topography post pipeline",
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
  const reliefBindGroup = device.createBindGroup({
    label: "topography relief bind group",
    layout: reliefPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  });
  const sampler = device.createSampler({
    label: "topography post sampler",
    magFilter: "linear",
    minFilter: "linear",
  });
  const pointer: PointerState = { x: 0, y: 0, strength: 0 };
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const uniforms = new Float32Array(UNIFORM_FLOATS);
  const light: Vec3 = [-0.42, 0.76, 0.5];
  let colorTexture: GPUTexture | null = null;
  let multisampleTexture: GPUTexture | null = null;
  let depthTexture: GPUTexture | null = null;
  let postBindGroup: GPUBindGroup | null = null;
  const abortController = new AbortController();
  let animationFrame = 0;
  let active = true;

  canvas.addEventListener(
    "pointermove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      pointer.strength = TOPOGRAPHY_POINTER_CONTROLS.enterStrength;
    },
    { signal: abortController.signal },
  );
  canvas.addEventListener(
    "pointerleave",
    () => {
      pointer.strength = Math.min(pointer.strength, TOPOGRAPHY_POINTER_CONTROLS.leaveStrengthCap);
    },
    { signal: abortController.signal },
  );
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
    if (
      !resizeCanvas(canvas) &&
      colorTexture &&
      multisampleTexture &&
      depthTexture &&
      postBindGroup
    ) {
      return;
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: "opaque",
    });

    colorTexture?.destroy();
    multisampleTexture?.destroy();
    depthTexture?.destroy();
    colorTexture = device.createTexture({
      label: "topography scene color",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    multisampleTexture = device.createTexture({
      label: "topography scene multisample color",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    depthTexture = device.createTexture({
      label: "topography scene depth",
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format: "depth24plus",
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    postBindGroup = device.createBindGroup({
      label: "topography post bind group",
      layout: postPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: sampler,
        },
        {
          binding: 1,
          resource: colorTexture.createView(),
        },
        {
          binding: 2,
          resource: {
            buffer: uniformBuffer,
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

    if (!colorTexture || !multisampleTexture || !depthTexture || !postBindGroup) {
      scheduleFrame();
      return;
    }

    const seconds = time * 0.001;
    const aspect = canvas.width / Math.max(1, canvas.height);
    const motion = reducedMotion ? TOPOGRAPHY_POINTER_CONTROLS.reducedMotionScale : 1;
    const drift = Math.sin(seconds * 0.12) * 0.02 * motion;
    const eye: Vec3 = [
      0.02 + pointer.x * pointer.strength * TOPOGRAPHY_POINTER_CONTROLS.eyeXInfluence,
      1.05 + pointer.y * pointer.strength * TOPOGRAPHY_POINTER_CONTROLS.eyeYInfluence,
      3.3,
    ];
    const target: Vec3 = [1.08 + drift, 0.22, -0.42];
    const projection = perspective((35 * Math.PI) / 180, aspect, 0.08, 7.2);
    const view = lookAt(eye, target, [0, 1, 0]);
    const viewProjection = multiplyMat4(projection, view);
    pointer.strength *= reducedMotion
      ? TOPOGRAPHY_POINTER_CONTROLS.reducedMotionIdleDecay
      : TOPOGRAPHY_POINTER_CONTROLS.idleDecay;

    uniforms.set(viewProjection, 0);
    uniforms.set([eye[0], eye[1], eye[2], 1], 16);
    uniforms.set([light[0], light[1], light[2], 0], 20);
    uniforms.set([canvas.width, canvas.height, window.devicePixelRatio || 1, aspect], 24);
    uniforms.set([seconds, 3, 1.08, motion], 28);
    uniforms.set([pointer.x, pointer.y, pointer.strength, 0], 32);
    device.queue.writeBuffer(uniformBuffer, 0, uniforms);

    const encoder = device.createCommandEncoder({
      label: "topography frame encoder",
    });
    const reliefPass = encoder.beginRenderPass({
      label: "topography relief pass",
      colorAttachments: [
        {
          view: multisampleTexture.createView(),
          resolveTarget: colorTexture.createView(),
          clearValue: { r: 0.86, g: 0.86, b: 0.83, a: 0.85 },
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "discard",
      },
    });
    reliefPass.setPipeline(reliefPipeline);
    reliefPass.setBindGroup(0, reliefBindGroup);
    reliefPass.setVertexBuffer(0, vertexBuffer);
    reliefPass.draw(mesh.vertexCount);
    reliefPass.end();

    const postPass = encoder.beginRenderPass({
      label: "topography post pass",
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.88, g: 0.88, b: 0.85, a: 1 },
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
    scheduleFrame();
  }

  function scheduleFrame(): void {
    if (!active || document.hidden || animationFrame !== 0) {
      return;
    }

    animationFrame = requestAnimationFrame(frame);
  }

  const renderer: TopographyRenderer = {
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

      colorTexture?.destroy();
      multisampleTexture?.destroy();
      depthTexture?.destroy();
      vertexBuffer.destroy();
      uniformBuffer.destroy();
    },
  };

  scheduleFrame();
  return renderer;
}

function createReliefMesh(): ReliefMesh {
  const builder = new ReliefBuilder();

  builder.floor();

  for (const shape of shapes) {
    builder.shape(shape);
  }

  return builder.mesh();
}

const shapes = TOPOGRAPHY_CONTROLS.shapes;

function createLoop(shape: ContourShape, fraction: number): LoopPoint[] {
  const points: LoopPoint[] = [];
  const scale = Math.max(0.24, Math.pow(1 - fraction * 0.9, 0.62));
  const innerCalm = 1 - fraction * 0.55;
  const cosRotation = Math.cos(shape.rotation);
  const sinRotation = Math.sin(shape.rotation);
  const ridgeDrift = fraction * (1 - fraction * 0.28);
  const driftX =
    (Math.sin(shape.phase * 0.73) * shape.radius[0] * 0.18 + Math.cos(shape.phase * 1.17) * 0.04) *
    ridgeDrift;
  const driftZ =
    (Math.cos(shape.phase * 0.61) * shape.radius[1] * 0.14 + Math.sin(shape.phase * 1.31) * 0.03) *
    ridgeDrift;

  for (let index = 0; index < SEGMENTS; index += 1) {
    const angle = (index / SEGMENTS) * Math.PI * 2;
    const radial =
      1 +
      Math.sin(angle * 3 + shape.phase) * shape.roughness * innerCalm +
      Math.sin(angle * 5 - shape.phase * 0.7) * shape.roughness * 0.46 * innerCalm +
      Math.sin(angle * 9 + shape.phase * 1.9) * shape.roughness * 0.22 * innerCalm +
      Math.sin(angle * 14 - shape.phase * 2.3) * shape.roughness * 0.09 * innerCalm +
      Math.sin(angle * 19 + shape.phase * 0.4) * shape.roughness * 0.045 * innerCalm;
    const localX = Math.cos(angle) * shape.radius[0] * scale * radial;
    const localZ = Math.sin(angle) * shape.radius[1] * scale * radial;
    const x = shape.center[0] + driftX + localX * cosRotation - localZ * sinRotation;
    const z = shape.center[1] + driftZ + localX * sinRotation + localZ * cosRotation;
    const outward = normalize2([
      localX * cosRotation - localZ * sinRotation,
      localX * sinRotation + localZ * cosRotation,
    ]);

    points.push({
      x,
      z,
      outwardX: outward[0],
      outwardZ: outward[1],
    });
  }

  return points;
}

function layerHeight(shape: ContourShape, level: number): number {
  const fraction = level / shape.levels;
  const crown = Math.sin(fraction * Math.PI) * 0.018;
  return fraction * shape.height + crown;
}

function loopCenter(loop: LoopPoint[], y: number): Vec3 {
  let x = 0;
  let z = 0;

  for (const point of loop) {
    x += point.x;
    z += point.z;
  }

  return [x / loop.length, y, z / loop.length];
}

function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    defaultVisualControls.performance.maxPixelRatio.topography,
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

type Vec2 = readonly [number, number];
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

function normalize2(value: Vec2): Vec2 {
  const length = Math.hypot(value[0], value[1]) || 1;
  return [value[0] / length, value[1] / length];
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
