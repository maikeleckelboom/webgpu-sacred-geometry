const SEGMENTS = 216
const UNIFORM_FLOATS = 36
const FLOATS_PER_VERTEX = 10
const SAMPLE_COUNT = 4

const reliefShader = /* wgsl */ `
struct Scene {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirection: vec4f,
  viewport: vec4f,
  params: vec4f,
  pointer: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) material: f32,
  @location(3) shade: f32,
  @location(4) focus: f32,
  @location(5) seed: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) material: f32,
  @location(3) shade: f32,
  @location(4) focus: f32,
  @location(5) seed: f32,
) -> VertexOut {
  var out: VertexOut;
  out.world = position;
  out.normal = normalize(normal);
  out.material = material;
  out.shade = shade;
  out.focus = focus;
  out.seed = seed;
  out.position = scene.viewProjection * vec4f(position, 1.0);
  return out;
}

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  let view = normalize(scene.cameraPosition.xyz - input.world);
  let light = normalize(scene.lightDirection.xyz);
  let halfVector = normalize(light + view);
  let diffuse = clamp(dot(normal, light), 0.0, 1.0);
  let softFill = clamp(dot(normal, normalize(vec3f(0.5, 0.3, 0.7))) * 0.5 + 0.5, 0.0, 1.0);
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  let side = step(0.5, input.material) * (1.0 - step(1.5, input.material));
  let floor = step(1.5, input.material);
  let top = 1.0 - side - floor;

  let heightTone = pow(clamp(input.shade, 0.0, 1.0), 0.7);
  let topBase = mix(vec3f(0.34, 0.34, 0.32), vec3f(0.82, 0.82, 0.78), heightTone);
  let sideBase = mix(vec3f(0.006, 0.006, 0.007), vec3f(0.07, 0.07, 0.066), heightTone);
  let floorBase = vec3f(0.78, 0.78, 0.75);
  var color = topBase * top + sideBase * side + floorBase * floor;

  let sideOcclusion = side * (0.54 + (1.0 - facing) * 0.24);
  let shelfOcclusion = top * (1.0 - smoothstep(0.0, 0.28, input.shade)) * 0.2;
  color = color * (0.2 + diffuse * 0.78 + softFill * 0.1);
  color = color * (1.0 - sideOcclusion - shelfOcclusion);

  let specPower = mix(52.0, 140.0, top + heightTone * 0.45);
  let specular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), specPower);
  let broadSpecular = pow(clamp(dot(reflect(-light, normal), view), 0.0, 1.0), 18.0);
  let rim = pow(1.0 - facing, 2.2) * (top * 0.18 + side * 0.38);
  let layerGlint = smoothstep(0.62, 1.0, input.shade) * top;
  color = color + vec3f(0.98, 0.98, 0.92) * specular * (0.62 + top * 1.24 + side * 1.2);
  color = color + vec3f(0.72, 0.72, 0.68) * broadSpecular * (top * 0.24 + side * 0.96);
  color = color + vec3f(0.5, 0.5, 0.48) * rim + vec3f(0.9, 0.9, 0.86) * layerGlint * specular * 0.42;

  let grain = hash21(input.world.xz * 83.0 + vec2f(input.seed, scene.params.x * 0.17));
  color = color * (0.965 + grain * 0.055);

  let distance = length(scene.cameraPosition.xyz - input.world);
  let fog = smoothstep(3.25, 5.8, distance);
  color = mix(color, vec3f(0.82, 0.82, 0.79), fog * 0.66);

  let focusDistance = scene.params.y + input.focus * 0.12;
  let blur = clamp(smoothstep(0.28, 1.22, abs(distance - focusDistance)) + fog * 0.2 + floor * 0.14, 0.0, 1.0);

  return vec4f(pow(clamp(color * scene.params.z, vec3f(0.0), vec3f(1.0)), vec3f(0.9)), blur);
}
`

const postShader = /* wgsl */ `
struct Scene {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirection: vec4f,
  viewport: vec4f,
  params: vec4f,
  pointer: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> scene: Scene;

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let position = positions[vertexIndex];

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.uv = position * 0.5 + vec2f(0.5, 0.5);
  return out;
}

fn sampleScene(uv: vec2f, offset: vec2f) -> vec4f {
  return textureSample(sceneTexture, postSampler, uv + offset);
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let texel = 1.0 / max(scene.viewport.xy, vec2f(1.0, 1.0));
  let center = sampleScene(input.uv, vec2f(0.0));
  let opticalFalloff = smoothstep(0.2, 0.9, length((input.uv - vec2f(0.64, 0.48)) * vec2f(1.16, 1.0)));
  let foregroundFalloff = smoothstep(0.7, 0.98, input.uv.y) * 0.28;
  let blur = clamp(center.a * 0.54 + opticalFalloff * 0.22 + foregroundFalloff, 0.0, 1.0);
  let radius = texel * (0.24 + blur * 6.5);

  var color = center.rgb * 0.52;
  color = color + sampleScene(input.uv, radius * vec2f(1.0, 0.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(-1.0, 0.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(0.0, 1.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(0.0, -1.0)).rgb * 0.07;
  color = color + sampleScene(input.uv, radius * vec2f(0.72, 0.72)).rgb * 0.05;
  color = color + sampleScene(input.uv, radius * vec2f(-0.72, 0.72)).rgb * 0.05;
  color = color + sampleScene(input.uv, radius * vec2f(0.72, -0.72)).rgb * 0.05;
  color = color + sampleScene(input.uv, radius * vec2f(-0.72, -0.72)).rgb * 0.05;

  let bloomRadius = radius * 3.2;
  let bloom =
    sampleScene(input.uv, bloomRadius * vec2f(1.0, 0.18)).rgb +
    sampleScene(input.uv, bloomRadius * vec2f(-1.0, -0.18)).rgb +
    sampleScene(input.uv, bloomRadius * vec2f(0.18, 1.0)).rgb +
    sampleScene(input.uv, bloomRadius * vec2f(-0.18, -1.0)).rgb;
  let bloomAmount = smoothstep(0.54, 1.05, max(max(bloom.r, bloom.g), bloom.b) * 0.25);
  color = color + bloom * bloomAmount * 0.035;

  let leftPaper = smoothstep(0.48, 0.02, input.uv.x) * smoothstep(1.02, 0.18, input.uv.y);
  color = mix(color, vec3f(0.93, 0.93, 0.9), leftPaper * 0.2);
  let vignette = smoothstep(1.0, 0.24, length((input.uv - vec2f(0.57, 0.5)) * vec2f(1.02, 0.86)));
  color = color * mix(0.9, 1.06, vignette);

  let grain = hash21(input.uv * scene.viewport.xy + scene.params.x * 11.0);
  color = color + vec3f((grain - 0.5) * 0.012);

  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
}
`

interface ReliefMesh {
  vertices: Float32Array
  vertexCount: number
}

interface ContourShape {
  center: Vec2
  radius: Vec2
  rotation: number
  levels: number
  height: number
  phase: number
  roughness: number
  focus: number
}

interface PointerState {
  x: number
  y: number
  strength: number
}

interface LoopPoint {
  x: number
  z: number
  outwardX: number
  outwardZ: number
}

class ReliefBuilder {
  private readonly data: number[] = []

  get vertexCount(): number {
    return this.data.length / FLOATS_PER_VERTEX
  }

  mesh(): ReliefMesh {
    return {
      vertices: new Float32Array(this.data),
      vertexCount: this.vertexCount,
    }
  }

  floor(): void {
    const y = -0.012
    const seed = 0.37
    this.triangle([-3.6, y, 2.2], [3.8, y, 2.2], [-3.6, y, -3.15], [0, 1, 0], 2, 0, 0.3, seed)
    this.triangle([3.8, y, 2.2], [3.8, y, -3.15], [-3.6, y, -3.15], [0, 1, 0], 2, 0, 0.3, seed)
  }

  shape(shape: ContourShape): void {
    const loops: LoopPoint[][] = []

    for (let level = 0; level <= shape.levels; level += 1) {
      loops.push(createLoop(shape, level / shape.levels))
    }

    for (let level = 0; level < shape.levels; level += 1) {
      const lower = loops[level]
      const upper = loops[level + 1]
      const lowerHeight = layerHeight(shape, level)
      const upperHeight = layerHeight(shape, level + 1)
      const shade = level / shape.levels
      const nextShade = (level + 1) / shape.levels
      const seed = shape.phase + level * 0.137

      this.topRing(lower, upper, lowerHeight, shade, shape.focus, seed)
      this.sideWall(upper, lowerHeight, upperHeight, nextShade, shape.focus, seed + 7.0)
    }

    this.cap(loops[shape.levels], layerHeight(shape, shape.levels), 1, shape.focus, shape.phase + 17.0)
  }

  private topRing(outer: LoopPoint[], inner: LoopPoint[], y: number, shade: number, focus: number, seed: number): void {
    for (let index = 0; index < outer.length; index += 1) {
      const next = (index + 1) % outer.length
      const a: Vec3 = [outer[index].x, y, outer[index].z]
      const b: Vec3 = [outer[next].x, y, outer[next].z]
      const c: Vec3 = [inner[index].x, y, inner[index].z]
      const d: Vec3 = [inner[next].x, y, inner[next].z]

      this.triangle(a, c, b, [0, 1, 0], 0, shade, focus, seed + index * 0.01)
      this.triangle(b, c, d, [0, 1, 0], 0, shade, focus, seed + index * 0.01)
    }
  }

  private sideWall(loop: LoopPoint[], lowerHeight: number, upperHeight: number, shade: number, focus: number, seed: number): void {
    for (let index = 0; index < loop.length; index += 1) {
      const next = (index + 1) % loop.length
      const current = loop[index]
      const following = loop[next]
      const normal = normalize3([current.outwardX + following.outwardX, 0.18, current.outwardZ + following.outwardZ])
      const a: Vec3 = [current.x, lowerHeight, current.z]
      const b: Vec3 = [following.x, lowerHeight, following.z]
      const c: Vec3 = [current.x, upperHeight, current.z]
      const d: Vec3 = [following.x, upperHeight, following.z]

      this.triangle(a, b, c, normal, 1, shade, focus, seed + index * 0.01)
      this.triangle(b, d, c, normal, 1, shade, focus, seed + index * 0.01)
    }
  }

  private cap(loop: LoopPoint[], y: number, shade: number, focus: number, seed: number): void {
    const center = loopCenter(loop, y)

    for (let index = 0; index < loop.length; index += 1) {
      const next = (index + 1) % loop.length
      const a: Vec3 = [loop[index].x, y, loop[index].z]
      const b: Vec3 = [loop[next].x, y, loop[next].z]
      this.triangle(center, a, b, [0, 1, 0], 0, shade, focus, seed + index * 0.01)
    }
  }

  private triangle(a: Vec3, b: Vec3, c: Vec3, normal: Vec3, material: number, shade: number, focus: number, seed: number): void {
    this.vertex(a, normal, material, shade, focus, seed)
    this.vertex(b, normal, material, shade, focus, seed)
    this.vertex(c, normal, material, shade, focus, seed)
  }

  private vertex(position: Vec3, normal: Vec3, material: number, shade: number, focus: number, seed: number): void {
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
    )
  }
}

export async function startTopographyRenderer(canvas: HTMLCanvasElement): Promise<void> {
  if (!navigator.gpu) {
    throw new Error('This browser does not expose navigator.gpu. Use a WebGPU-capable Chromium, Edge, or Safari build.')
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  })

  if (!adapter) {
    throw new Error('WebGPU is available, but no compatible GPU adapter was returned.')
  }

  const device = await adapter.requestDevice()
  const context = canvas.getContext('webgpu')

  if (!context) {
    throw new Error('Could not create a WebGPU canvas context.')
  }

  const gpuContext = context
  const format = navigator.gpu.getPreferredCanvasFormat()
  const mesh = createReliefMesh()
  const vertexBuffer = device.createBuffer({
    label: 'topography relief vertices',
    size: mesh.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  const uniformBuffer = device.createBuffer({
    label: 'topography scene uniforms',
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices)

  const reliefModule = device.createShaderModule({
    label: 'topography relief shader',
    code: reliefShader,
  })
  const postModule = device.createShaderModule({
    label: 'topography post shader',
    code: postShader,
  })
  const reliefPipeline = device.createRenderPipeline({
    label: 'topography relief pipeline',
    layout: 'auto',
    vertex: {
      module: reliefModule,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
            { shaderLocation: 2, offset: 24, format: 'float32' },
            { shaderLocation: 3, offset: 28, format: 'float32' },
            { shaderLocation: 4, offset: 32, format: 'float32' },
            { shaderLocation: 5, offset: 36, format: 'float32' },
          ],
        },
      ],
    },
    fragment: {
      module: reliefModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
    multisample: {
      count: SAMPLE_COUNT,
    },
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  })
  const postPipeline = device.createRenderPipeline({
    label: 'topography post pipeline',
    layout: 'auto',
    vertex: {
      module: postModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: postModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  })
  const reliefBindGroup = device.createBindGroup({
    label: 'topography relief bind group',
    layout: reliefPipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  })
  const sampler = device.createSampler({
    label: 'topography post sampler',
    magFilter: 'linear',
    minFilter: 'linear',
  })
  const pointer: PointerState = { x: 0, y: 0, strength: 0 }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const uniforms = new Float32Array(UNIFORM_FLOATS)
  const light: Vec3 = [-0.42, 0.76, 0.5]
  let colorTexture: GPUTexture | null = null
  let multisampleTexture: GPUTexture | null = null
  let depthTexture: GPUTexture | null = null
  let postBindGroup: GPUBindGroup | null = null

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
    pointer.y = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1
    pointer.strength = 1
  })
  canvas.addEventListener('pointerleave', () => {
    pointer.strength = Math.min(pointer.strength, 0.15)
  })

  function refreshTargets(): void {
    if (!resizeCanvas(canvas) && colorTexture && multisampleTexture && depthTexture && postBindGroup) {
      return
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: 'opaque',
    })

    colorTexture?.destroy()
    multisampleTexture?.destroy()
    depthTexture?.destroy()
    colorTexture = device.createTexture({
      label: 'topography scene color',
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    multisampleTexture = device.createTexture({
      label: 'topography scene multisample color',
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    depthTexture = device.createTexture({
      label: 'topography scene depth',
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format: 'depth24plus',
      sampleCount: SAMPLE_COUNT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    postBindGroup = device.createBindGroup({
      label: 'topography post bind group',
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
    })
  }

  function frame(time: number): void {
    refreshTargets()

    if (!colorTexture || !multisampleTexture || !depthTexture || !postBindGroup) {
      requestAnimationFrame(frame)
      return
    }

    const seconds = time * 0.001
    const aspect = canvas.width / Math.max(1, canvas.height)
    const motion = reducedMotion ? 0.15 : 1
    const drift = Math.sin(seconds * 0.12) * 0.02 * motion
    const eye: Vec3 = [0.02 + pointer.x * pointer.strength * 0.035, 1.05 + pointer.y * pointer.strength * 0.018, 3.3]
    const target: Vec3 = [1.08 + drift, 0.22, -0.42]
    const projection = perspective((35 * Math.PI) / 180, aspect, 0.08, 7.2)
    const view = lookAt(eye, target, [0, 1, 0])
    const viewProjection = multiplyMat4(projection, view)
    pointer.strength *= reducedMotion ? 0.92 : 0.97

    uniforms.set(viewProjection, 0)
    uniforms.set([eye[0], eye[1], eye[2], 1], 16)
    uniforms.set([light[0], light[1], light[2], 0], 20)
    uniforms.set([canvas.width, canvas.height, window.devicePixelRatio || 1, aspect], 24)
    uniforms.set([seconds, 3, 1.08, motion], 28)
    uniforms.set([pointer.x, pointer.y, pointer.strength, 0], 32)
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)

    const encoder = device.createCommandEncoder({
      label: 'topography frame encoder',
    })
    const reliefPass = encoder.beginRenderPass({
      label: 'topography relief pass',
      colorAttachments: [
        {
          view: multisampleTexture.createView(),
          resolveTarget: colorTexture.createView(),
          clearValue: { r: 0.86, g: 0.86, b: 0.83, a: 0.85 },
          loadOp: 'clear',
          storeOp: 'discard',
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    })
    reliefPass.setPipeline(reliefPipeline)
    reliefPass.setBindGroup(0, reliefBindGroup)
    reliefPass.setVertexBuffer(0, vertexBuffer)
    reliefPass.draw(mesh.vertexCount)
    reliefPass.end()

    const postPass = encoder.beginRenderPass({
      label: 'topography post pass',
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0.88, g: 0.88, b: 0.85, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    postPass.setPipeline(postPipeline)
    postPass.setBindGroup(0, postBindGroup)
    postPass.draw(3)
    postPass.end()

    device.queue.submit([encoder.finish()])
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

function createReliefMesh(): ReliefMesh {
  const builder = new ReliefBuilder()

  builder.floor()

  for (const shape of shapes) {
    builder.shape(shape)
  }

  return builder.mesh()
}

const shapes: ContourShape[] = [
  {
    center: [0.98, -0.16],
    radius: [0.92, 0.6],
    rotation: -0.16,
    levels: 25,
    height: 0.66,
    phase: 1.2,
    roughness: 0.18,
    focus: 0.05,
  },
  {
    center: [1.66, 0.12],
    radius: [0.82, 0.52],
    rotation: 0.24,
    levels: 19,
    height: 0.48,
    phase: 2.6,
    roughness: 0.16,
    focus: -0.04,
  },
  {
    center: [0.18, 0.28],
    radius: [0.68, 0.44],
    rotation: 0.18,
    levels: 15,
    height: 0.34,
    phase: 4.7,
    roughness: 0.17,
    focus: 0.15,
  },
  {
    center: [1.22, -1.18],
    radius: [1.18, 0.46],
    rotation: -0.03,
    levels: 16,
    height: 0.34,
    phase: 5.4,
    roughness: 0.09,
    focus: 0.6,
  },
  {
    center: [0.4, -1.42],
    radius: [0.86, 0.34],
    rotation: -0.08,
    levels: 12,
    height: 0.26,
    phase: 6.35,
    roughness: 0.16,
    focus: 0.72,
  },
  {
    center: [2.18, -0.34],
    radius: [1.08, 0.4],
    rotation: 0.08,
    levels: 13,
    height: 0.3,
    phase: 7.2,
    roughness: 0.17,
    focus: 0.3,
  },
  {
    center: [-1.22, 1.05],
    radius: [1.12, 0.52],
    rotation: -0.08,
    levels: 13,
    height: 0.3,
    phase: 8.3,
    roughness: 0.16,
    focus: -0.72,
  },
  {
    center: [0.18, -1.78],
    radius: [0.92, 0.38],
    rotation: 0.06,
    levels: 11,
    height: 0.25,
    phase: 9.8,
    roughness: 0.1,
    focus: 0.82,
  },
]

function createLoop(shape: ContourShape, fraction: number): LoopPoint[] {
  const points: LoopPoint[] = []
  const scale = Math.max(0.24, Math.pow(1 - fraction * 0.9, 0.62))
  const innerCalm = 1 - fraction * 0.55
  const cosRotation = Math.cos(shape.rotation)
  const sinRotation = Math.sin(shape.rotation)
  const ridgeDrift = fraction * (1 - fraction * 0.28)
  const driftX = (Math.sin(shape.phase * 0.73) * shape.radius[0] * 0.18 + Math.cos(shape.phase * 1.17) * 0.04) * ridgeDrift
  const driftZ = (Math.cos(shape.phase * 0.61) * shape.radius[1] * 0.14 + Math.sin(shape.phase * 1.31) * 0.03) * ridgeDrift

  for (let index = 0; index < SEGMENTS; index += 1) {
    const angle = (index / SEGMENTS) * Math.PI * 2
    const radial =
      1 +
      Math.sin(angle * 3 + shape.phase) * shape.roughness * innerCalm +
      Math.sin(angle * 5 - shape.phase * 0.7) * shape.roughness * 0.46 * innerCalm +
      Math.sin(angle * 9 + shape.phase * 1.9) * shape.roughness * 0.22 * innerCalm +
      Math.sin(angle * 14 - shape.phase * 2.3) * shape.roughness * 0.09 * innerCalm +
      Math.sin(angle * 19 + shape.phase * 0.4) * shape.roughness * 0.045 * innerCalm
    const localX = Math.cos(angle) * shape.radius[0] * scale * radial
    const localZ = Math.sin(angle) * shape.radius[1] * scale * radial
    const x = shape.center[0] + driftX + localX * cosRotation - localZ * sinRotation
    const z = shape.center[1] + driftZ + localX * sinRotation + localZ * cosRotation
    const outward = normalize2([localX * cosRotation - localZ * sinRotation, localX * sinRotation + localZ * cosRotation])

    points.push({
      x,
      z,
      outwardX: outward[0],
      outwardZ: outward[1],
    })
  }

  return points
}

function layerHeight(shape: ContourShape, level: number): number {
  const fraction = level / shape.levels
  const crown = Math.sin(fraction * Math.PI) * 0.018
  return fraction * shape.height + crown
}

function loopCenter(loop: LoopPoint[], y: number): Vec3 {
  let x = 0
  let z = 0

  for (const point of loop) {
    x += point.x
    z += point.z
  }

  return [x / loop.length, y, z / loop.length]
}

function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5)
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio))
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio))

  if (canvas.width === width && canvas.height === height) {
    return false
  }

  canvas.width = width
  canvas.height = height
  return true
}

type Vec2 = [number, number]
type Vec3 = [number, number, number]

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2)
  const rangeInv = 1 / (near - far)
  const out = new Float32Array(16)

  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * rangeInv
  out[11] = -1
  out[14] = 2 * far * near * rangeInv

  return out
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const z = normalize3(subtract3(eye, target))
  const x = normalize3(cross3(up, z))
  const y = cross3(z, x)
  const out = new Float32Array(16)

  out[0] = x[0]
  out[1] = y[0]
  out[2] = z[0]
  out[4] = x[1]
  out[5] = y[1]
  out[6] = z[1]
  out[8] = x[2]
  out[9] = y[2]
  out[10] = z[2]
  out[12] = -dot3(x, eye)
  out[13] = -dot3(y, eye)
  out[14] = -dot3(z, eye)
  out[15] = 1

  return out
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  const a00 = a[0]
  const a01 = a[1]
  const a02 = a[2]
  const a03 = a[3]
  const a10 = a[4]
  const a11 = a[5]
  const a12 = a[6]
  const a13 = a[7]
  const a20 = a[8]
  const a21 = a[9]
  const a22 = a[10]
  const a23 = a[11]
  const a30 = a[12]
  const a31 = a[13]
  const a32 = a[14]
  const a33 = a[15]

  let b0 = b[0]
  let b1 = b[1]
  let b2 = b[2]
  let b3 = b[3]
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[4]
  b1 = b[5]
  b2 = b[6]
  b3 = b[7]
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[8]
  b1 = b[9]
  b2 = b[10]
  b3 = b[11]
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[12]
  b1 = b[13]
  b2 = b[14]
  b3 = b[15]
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  return out
}

function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function normalize2(value: Vec2): Vec2 {
  const length = Math.hypot(value[0], value[1]) || 1
  return [value[0] / length, value[1] / length]
}

function normalize3(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1
  return [value[0] / length, value[1] / length, value[2] / length]
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
