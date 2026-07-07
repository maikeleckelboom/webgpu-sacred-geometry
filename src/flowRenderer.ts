const PARTICLE_COUNT = 68000
const WORKGROUP_SIZE = 64
const FLOATS_PER_PARTICLE = 8
const UNIFORM_FLOATS = 8

const computeShader = /* wgsl */ `
const particleCount = ${PARTICLE_COUNT}u;

struct Particle {
  position: vec2f,
  velocity: vec2f,
  seed: f32,
  depth: f32,
  age: f32,
  lane: f32,
}

struct Sim {
  deltaTime: f32,
  time: f32,
  aspect: f32,
  motion: f32,
  pointer: vec2f,
  pointerStrength: f32,
  padding: f32,
}

@group(0) @binding(0) var<storage, read> sourceParticles: array<Particle>;
@group(0) @binding(1) var<storage, read_write> targetParticles: array<Particle>;
@group(0) @binding(2) var<uniform> sim: Sim;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn spawn(seed: f32, epoch: f32) -> Particle {
  let h0 = hash11(seed + epoch * 1.37);
  let h1 = hash11(seed * 2.31 + epoch * 1.91);
  let h2 = hash11(seed * 3.73 + epoch * 2.17);
  let h3 = hash11(seed * 5.19 + epoch * 2.73);
  let h4 = hash11(seed * 7.41 + epoch * 3.11);
  let h5 = hash11(seed * 11.7 + epoch * 3.97);
  let h6 = hash11(seed * 13.3 + epoch * 5.23);

  var particle: Particle;
  particle.position = vec2f(mix(-0.52, 1.36, h0), mix(-1.08, 1.05, h1));
  particle.velocity = vec2f(mix(0.03, 0.15, h2), mix(-0.07, 0.07, h3));
  particle.seed = seed;
  particle.depth = h4;
  particle.age = h5 * mix(10.0, 20.0, h4);
  particle.lane = mix(-1.0, 1.0, h6);
  return particle;
}

fn flowNoise(point: vec2f, lane: f32, time: f32) -> vec2f {
  let waveA = sin((point.y + lane * 0.12) * 8.4 + point.x * 1.9 + time * 0.31);
  let waveB = cos((point.x - lane * 0.08) * 6.7 - point.y * 1.6 - time * 0.24);
  let waveC = sin((point.x * 3.4 - point.y * 4.1) + lane * 2.2 + time * 0.17);
  let waveD = cos((point.x * 2.1 + point.y * 3.6) - time * 0.19);
  return normalize(vec2f(waveA + waveC * 0.72, waveB - waveD * 0.58) + vec2f(0.001, -0.002));
}

fn basin(point: vec2f, center: vec2f, radius: f32) -> f32 {
  return 1.0 - smoothstep(radius * 0.14, radius, length(point - center));
}

fn vortex(point: vec2f, center: vec2f, spin: f32, radius: f32, orbitStrength: f32, pullStrength: f32) -> vec2f {
  let toCenter = center - point;
  let distance = max(length(toCenter), 0.001);
  let toward = toCenter / distance;
  let tangent = vec2f(-toward.y, toward.x) * spin;
  let outer = 1.0 - smoothstep(radius * 0.28, radius * 1.42, distance);
  let inner = 1.0 - smoothstep(radius * 0.04, radius * 0.64, distance);
  let shell = outer * (0.34 + inner * 0.66);
  return tangent * orbitStrength * shell + toward * pullStrength * inner;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn computeMain(@builtin(global_invocation_id) globalId: vec3u) {
  if (globalId.x >= particleCount) {
    return;
  }

  let index = globalId.x;
  var particle = sourceParticles[index];
  let lifetime = mix(10.0, 20.0, hash11(particle.seed * 3.91));
  let epoch = floor(sim.time * 0.046 + particle.seed * 0.013);

  if (
    particle.age > lifetime ||
    particle.position.x < -0.76 ||
    particle.position.x > 1.52 ||
    abs(particle.position.y) > 1.26
  ) {
    particle = spawn(particle.seed, epoch);
  }

  let deltaTime = min(sim.deltaTime, 0.033);
  let position = particle.position;
  let centerA = vec2f(0.34 + sin(sim.time * 0.09) * 0.045, -0.04 + cos(sim.time * 0.11) * 0.035);
  let centerB = vec2f(0.72 + cos(sim.time * 0.13) * 0.052, 0.32 + sin(sim.time * 0.10) * 0.045);
  let centerC = vec2f(0.78 + sin(sim.time * 0.10) * 0.048, -0.42 + cos(sim.time * 0.12) * 0.055);
  let centerD = vec2f(1.13 + cos(sim.time * 0.08) * 0.045, 0.03 + sin(sim.time * 0.16) * 0.05);
  let centerE = vec2f(0.05 + cos(sim.time * 0.07) * 0.045, 0.55 + sin(sim.time * 0.09) * 0.04);
  let centerF = vec2f(0.08 + sin(sim.time * 0.06) * 0.05, -0.73 + cos(sim.time * 0.10) * 0.05);

  let weightA = basin(position, centerA, 1.08);
  let weightB = basin(position, centerB, 0.8);
  let weightC = basin(position, centerC, 0.82);
  let weightD = basin(position, centerD, 0.74);
  let weightE = basin(position, centerE, 0.78);
  let weightF = basin(position, centerF, 0.78);

  let curl = flowNoise(position, particle.lane, sim.time);
  let river = vec2f(0.12, 0.0) + curl * 0.09;
  let vortexField =
    vortex(position, centerA, 1.0, 1.08, 0.18, 0.032) +
    vortex(position, centerB, -1.0, 0.8, 0.13, 0.018) +
    vortex(position, centerC, -1.0, 0.82, 0.12, 0.02) +
    vortex(position, centerD, 1.0, 0.74, 0.11, 0.016) +
    vortex(position, centerE, -1.0, 0.78, 0.08, 0.012) +
    vortex(position, centerF, 1.0, 0.78, 0.08, 0.012);

  let bridgeAB = normalize(centerB - centerA + vec2f(0.001, 0.001)) * weightA * weightB * 0.07;
  let bridgeAC = normalize(centerC - centerA + vec2f(0.001, -0.001)) * weightA * weightC * 0.06;
  let bridgeBD = normalize(centerD - centerB + vec2f(0.001, 0.001)) * weightB * weightD * 0.05;
  let bridgeCF = normalize(centerC - centerF + vec2f(-0.001, 0.001)) * weightC * weightF * 0.045;
  let saddle = bridgeAB + bridgeAC + bridgeBD + bridgeCF;

  let pointerVector = position - sim.pointer;
  let pointerDistance = max(length(pointerVector), 0.001);
  let pointerFalloff = (1.0 - smoothstep(0.02, 0.36, pointerDistance)) * sim.pointerStrength;
  let pointerDeflection = normalize(pointerVector + vec2f(0.001, 0.001)) * pointerFalloff * 0.34;

  let targetVelocity = river + vortexField + saddle + pointerDeflection;
  let response = 0.035 + particle.depth * 0.052;
  particle.velocity = mix(particle.velocity, targetVelocity, response);
  particle.position = particle.position + particle.velocity * deltaTime * sim.motion * (0.5 + particle.depth * 0.5);
  particle.age = particle.age + deltaTime * (0.68 + particle.depth * 0.34);

  if (particle.age > lifetime) {
    particle = spawn(particle.seed, epoch + 1.0);
  }

  targetParticles[index] = particle;
}
`

const particleRenderShader = /* wgsl */ `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  seed: f32,
  depth: f32,
  age: f32,
  lane: f32,
}

struct Render {
  time: f32,
  aspect: f32,
  opacity: f32,
  pixelRatio: f32,
  viewport: vec2f,
  padding: vec2f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
}

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> render: Render;

fn hash11(value: f32) -> f32 {
  return fract(sin(value * 127.1) * 43758.5453123);
}

fn quadCorner(vertexIndex: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(0.0, 1.0),
    vec2f(0.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  return corners[vertexIndex];
}

fn spriteCorner(vertexIndex: u32) -> vec2f {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
  );
  return corners[vertexIndex];
}

fn lifeFade(particle: Particle) -> f32 {
  let lifetime = mix(10.0, 20.0, hash11(particle.seed * 3.91));
  let birth = smoothstep(0.0, 1.2, particle.age);
  let death = 1.0 - smoothstep(lifetime - 2.4, lifetime, particle.age);
  return clamp(birth * death, 0.0, 1.0);
}

fn basin(point: vec2f, center: vec2f, radius: f32) -> f32 {
  return 1.0 - smoothstep(radius * 0.14, radius, length(point - center));
}

fn fieldEnergy(point: vec2f, time: f32) -> f32 {
  let centerA = vec2f(0.34 + sin(time * 0.09) * 0.045, -0.04 + cos(time * 0.11) * 0.035);
  let centerB = vec2f(0.72 + cos(time * 0.13) * 0.052, 0.32 + sin(time * 0.10) * 0.045);
  let centerC = vec2f(0.78 + sin(time * 0.10) * 0.048, -0.42 + cos(time * 0.12) * 0.055);
  let centerD = vec2f(1.13 + cos(time * 0.08) * 0.045, 0.03 + sin(time * 0.16) * 0.05);
  let centerE = vec2f(0.05 + cos(time * 0.07) * 0.045, 0.55 + sin(time * 0.09) * 0.04);
  let centerF = vec2f(0.08 + sin(time * 0.06) * 0.05, -0.73 + cos(time * 0.10) * 0.05);
  let primary = max(max(basin(point, centerA, 0.9), basin(point, centerB, 0.66)), max(basin(point, centerC, 0.68), basin(point, centerD, 0.58)));
  let outer = max(basin(point, centerE, 0.62), basin(point, centerF, 0.62)) * 0.72;
  return clamp(max(primary, outer), 0.0, 1.0);
}

fn rightSideMask(position: vec2f) -> f32 {
  let horizontal = smoothstep(-0.42, 0.24, position.x);
  let vertical = 1.0 - smoothstep(0.86, 1.12, abs(position.y));
  return horizontal * vertical;
}

@vertex
fn lineVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = quadCorner(vertexIndex);
  let speed = length(particle.velocity);
  let direction = normalize(particle.velocity + vec2f(0.0001, 0.0002));
  let screenDirection = normalize(vec2f(direction.x * render.viewport.x, direction.y * render.viewport.y));
  let screenNormal = vec2f(-screenDirection.y, screenDirection.x);
  let ndcPixel = vec2f(2.0 / render.viewport.x, 2.0 / render.viewport.y);
  let normal = vec2f(screenNormal.x * ndcPixel.x, screenNormal.y * ndcPixel.y);
  let trail = 0.015 + speed * 0.076 + particle.depth * 0.022;
  let head = particle.position;
  let tail = head - direction * trail;
  let center = mix(tail, head, corner.x);
  let focusBand = 1.0 - abs(particle.depth - 0.56) * 1.7;
  let blur = smoothstep(0.82, 1.0, particle.depth) + smoothstep(0.08, 0.0, particle.depth);
  let widthPixels = 0.28 + clamp(focusBand, 0.0, 1.0) * 0.44 + blur * 0.58 + speed * 2.9;
  let position = center + normal * corner.y * widthPixels;
  let mask = rightSideMask(particle.position);
  let energy = fieldEnergy(particle.position, render.time);
  let glint = step(0.992, hash11(particle.seed * 23.71));

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = mix(vec3f(0.62, 0.67, 0.7), vec3f(0.18, 0.19, 0.2), particle.depth);
  out.color = mix(out.color, vec3f(0.58, 0.78, 0.9), glint);
  out.alpha = render.opacity * mask * lifeFade(particle) * (0.016 + energy * 0.046 + (1.0 - particle.depth) * 0.009 + glint * 0.056);
  return out;
}

@fragment
fn lineFragment(input: VertexOut) -> @location(0) vec4f {
  let side = pow(clamp(1.0 - abs(input.local.y), 0.0, 1.0), 1.35);
  let headFade = smoothstep(0.0, 0.16, input.local.x);
  let tailFade = 1.0 - smoothstep(0.82, 1.0, input.local.x) * 0.36;
  let alpha = input.alpha * side * headFade * tailFade;
  return vec4f(input.color, alpha);
}

@vertex
fn spriteVertex(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOut {
  let particle = particles[instanceIndex];
  let corner = spriteCorner(vertexIndex);
  let ndcPixel = vec2f(2.0 / render.viewport.x, 2.0 / render.viewport.y);
  let marker = smoothstep(0.948, 0.998, hash11(particle.seed * 17.17));
  let node = step(0.997, hash11(particle.seed * 29.17));
  let glint = step(0.989, hash11(particle.seed * 41.83));
  let energy = fieldEnergy(particle.position, render.time);
  let pulse = 0.92 + sin(render.time * 1.8 + particle.seed * 0.031) * 0.08;
  let radiusPixels = (0.42 + marker * (1.65 + energy * 1.7) + node * 3.8 + glint * 2.2) * pulse;
  let position = particle.position + corner * ndcPixel * radiusPixels;
  let mask = rightSideMask(particle.position);

  var out: VertexOut;
  out.position = vec4f(position, 0.0, 1.0);
  out.local = corner;
  out.color = mix(vec3f(0.035, 0.038, 0.041), vec3f(0.58, 0.78, 0.9), glint);
  out.alpha = render.opacity * mask * lifeFade(particle) * (marker * (0.14 + energy * 0.2) + node * 0.34 + glint * 0.2);
  return out;
}

@fragment
fn spriteFragment(input: VertexOut) -> @location(0) vec4f {
  let distance = length(input.local);
  let disc = smoothstep(1.0, 0.78, distance);
  let alpha = input.alpha * disc;
  return vec4f(input.color, alpha);
}
`

const postShader = /* wgsl */ `
struct Render {
  time: f32,
  aspect: f32,
  opacity: f32,
  pixelRatio: f32,
  viewport: vec2f,
  padding: vec2f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var postSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
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

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let center = textureSample(sceneTexture, postSampler, input.uv);
  let alpha = clamp(center.a, 0.0, 0.92);
  let color = min(center.rgb, vec3f(alpha));
  return vec4f(color, alpha);
}
`

interface PointerState {
  x: number
  y: number
  strength: number
}

export async function startFlowFieldRenderer(canvas: HTMLCanvasElement): Promise<void> {
  if (!navigator.gpu) {
    throw new Error('This browser does not expose navigator.gpu. Use a WebGPU-capable Chromium, Edge, or Safari build.')
  }

  const adapter = await navigator.gpu.requestAdapter()

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
  const particleData = createInitialParticles(PARTICLE_COUNT)
  const particleBuffers = [
    createStorageBuffer(device, 'flow particles A', particleData.byteLength),
    createStorageBuffer(device, 'flow particles B', particleData.byteLength),
  ]

  device.queue.writeBuffer(particleBuffers[0], 0, particleData)
  device.queue.writeBuffer(particleBuffers[1], 0, particleData)

  const simBuffer = device.createBuffer({
    label: 'flow simulation uniforms',
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const renderBuffer = device.createBuffer({
    label: 'flow render uniforms',
    size: UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const computeModule = device.createShaderModule({
    label: 'flow compute shader',
    code: computeShader,
  })
  const renderModule = device.createShaderModule({
    label: 'flow particle render shader',
    code: particleRenderShader,
  })
  const postModule = device.createShaderModule({
    label: 'flow post shader',
    code: postShader,
  })
  const computePipeline = device.createComputePipeline({
    label: 'flow compute pipeline',
    layout: 'auto',
    compute: {
      module: computeModule,
      entryPoint: 'computeMain',
    },
  })
  const linePipeline = createParticlePipeline(device, renderModule, format, 'lineVertex', 'lineFragment', 'flow line pipeline')
  const spritePipeline = createParticlePipeline(device, renderModule, format, 'spriteVertex', 'spriteFragment', 'flow sprite pipeline')
  const postPipeline = device.createRenderPipeline({
    label: 'flow post pipeline',
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
  const computeBindGroups = [
    createComputeBindGroup(device, computePipeline, particleBuffers[0], particleBuffers[1], simBuffer),
    createComputeBindGroup(device, computePipeline, particleBuffers[1], particleBuffers[0], simBuffer),
  ]
  const lineBindGroups = [
    createRenderBindGroup(device, linePipeline, particleBuffers[0], renderBuffer),
    createRenderBindGroup(device, linePipeline, particleBuffers[1], renderBuffer),
  ]
  const spriteBindGroups = [
    createRenderBindGroup(device, spritePipeline, particleBuffers[0], renderBuffer),
    createRenderBindGroup(device, spritePipeline, particleBuffers[1], renderBuffer),
  ]
  const sampler = device.createSampler({
    label: 'flow post sampler',
    magFilter: 'linear',
    minFilter: 'linear',
  })
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const pointer: PointerState = { x: 2, y: 2, strength: 0 }
  const simUniforms = new Float32Array(UNIFORM_FLOATS)
  const renderUniforms = new Float32Array(UNIFORM_FLOATS)
  let offscreenTexture: GPUTexture | null = null
  let postBindGroup: GPUBindGroup | null = null
  let sourceIndex = 0
  let lastTime = 0

  window.addEventListener(
    'pointermove',
    (event) => {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      pointer.y = (1 - (event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1
      pointer.strength = 1
    },
    { passive: true },
  )
  window.addEventListener(
    'pointerleave',
    () => {
      pointer.strength = 0
    },
    { passive: true },
  )

  function refreshTargets(): void {
    if (!resizeCanvas(canvas) && offscreenTexture && postBindGroup) {
      return
    }

    gpuContext.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    })

    offscreenTexture?.destroy()
    offscreenTexture = device.createTexture({
      label: 'flow offscreen texture',
      size: {
        width: canvas.width,
        height: canvas.height,
      },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    postBindGroup = device.createBindGroup({
      label: 'flow post bind group',
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
      ],
    })
  }

  function frame(time: number): void {
    refreshTargets()

    if (!offscreenTexture || !postBindGroup) {
      requestAnimationFrame(frame)
      return
    }

    const seconds = time * 0.001
    const deltaTime = lastTime > 0 ? seconds - lastTime : 1 / 60
    const aspect = canvas.width / Math.max(1, canvas.height)
    const motion = reducedMotion ? 0.28 : 1
    pointer.strength *= 0.94
    lastTime = seconds

    simUniforms.set([deltaTime, seconds, aspect, motion, pointer.x, pointer.y, pointer.strength, 0])
    renderUniforms.set([seconds, aspect, 1, window.devicePixelRatio || 1, canvas.width, canvas.height, 0, 0])
    device.queue.writeBuffer(simBuffer, 0, simUniforms)
    device.queue.writeBuffer(renderBuffer, 0, renderUniforms)

    const targetIndex = 1 - sourceIndex
    const encoder = device.createCommandEncoder({
      label: 'flow frame encoder',
    })
    const computePass = encoder.beginComputePass({
      label: 'flow compute pass',
    })
    computePass.setPipeline(computePipeline)
    computePass.setBindGroup(0, computeBindGroups[sourceIndex])
    computePass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / WORKGROUP_SIZE))
    computePass.end()

    const scenePass = encoder.beginRenderPass({
      label: 'flow scene pass',
      colorAttachments: [
        {
          view: offscreenTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    scenePass.setPipeline(linePipeline)
    scenePass.setBindGroup(0, lineBindGroups[targetIndex])
    scenePass.draw(6, PARTICLE_COUNT)
    scenePass.setPipeline(spritePipeline)
    scenePass.setBindGroup(0, spriteBindGroups[targetIndex])
    scenePass.draw(6, PARTICLE_COUNT)
    scenePass.end()

    const postPass = encoder.beginRenderPass({
      label: 'flow post pass',
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
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
    sourceIndex = targetIndex
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}

function createStorageBuffer(device: GPUDevice, label: string, size: number): GPUBuffer {
  return device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
}

function createComputeBindGroup(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  source: GPUBuffer,
  target: GPUBuffer,
  uniforms: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: 'flow compute bind group',
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
  })
}

function createRenderBindGroup(
  device: GPUDevice,
  pipeline: GPURenderPipeline,
  particles: GPUBuffer,
  uniforms: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    label: 'flow render bind group',
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
  })
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
    layout: 'auto',
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
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
  })
}

function createInitialParticles(count: number): Float32Array {
  const particles = new Float32Array(count * FLOATS_PER_PARTICLE)

  for (let index = 0; index < count; index += 1) {
    const seed = index * 0.61803398875 + 0.123
    const offset = index * FLOATS_PER_PARTICLE
    const depth = hash(seed * 7.41)
    const lifetime = lerp(7.5, 15, hash(seed * 3.91))

    particles[offset] = lerp(-0.04, 1.28, hash(seed))
    particles[offset + 1] = lerp(-0.9, 0.9, hash(seed * 2.31))
    particles[offset + 2] = lerp(0.02, 0.13, hash(seed * 3.73))
    particles[offset + 3] = lerp(-0.06, 0.06, hash(seed * 5.19))
    particles[offset + 4] = seed
    particles[offset + 5] = depth
    particles[offset + 6] = hash(seed * 11.7) * lifetime
    particles[offset + 7] = lerp(-1, 1, hash(seed * 13.3))
  }

  return particles
}

function resizeCanvas(canvas: HTMLCanvasElement): boolean {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio))
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio))

  if (canvas.width === width && canvas.height === height) {
    return false
  }

  canvas.width = width
  canvas.height = height
  return true
}

function hash(value: number): number {
  return fract(Math.sin(value * 127.1) * 43758.5453123)
}

function fract(value: number): number {
  return value - Math.floor(value)
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}
