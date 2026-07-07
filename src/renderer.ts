import { createMandalaGeometry } from './geometry'

const shader = /* wgsl */ `
struct Scene {
  clipScale: vec2f,
  time: f32,
  contrast: f32,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) kind: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

@vertex
fn vertexMain(
  @location(0) position: vec2f,
  @location(1) local: vec2f,
  @location(2) color: vec4f,
  @location(3) kind: f32,
) -> VertexOut {
  var out: VertexOut;
  let scale = scene.clipScale * (0.982 + 0.003 * sin(scene.time * 0.42));
  out.position = vec4f(position * scale, 0.0, 1.0);
  out.local = local;
  out.color = color;
  out.kind = kind;
  return out;
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  if (input.kind < 0.5) {
    return vec4f(input.color.rgb * scene.contrast, input.color.a);
  }

  let d = length(input.local);
  let halo = pow(clamp(1.0 - d, 0.0, 1.0), 2.0);
  let core = smoothstep(0.3, 0.0, d);
  let rayX = pow(clamp(1.0 - abs(input.local.y) * 3.8, 0.0, 1.0), 4.0) *
    pow(clamp(1.0 - abs(input.local.x), 0.0, 1.0), 0.8);
  let rayY = pow(clamp(1.0 - abs(input.local.x) * 3.8, 0.0, 1.0), 4.0) *
    pow(clamp(1.0 - abs(input.local.y), 0.0, 1.0), 0.8);
  let star = max(rayX, rayY) * select(0.0, 0.52, input.kind > 1.5);
  let pulse = 0.94 + 0.06 * sin(scene.time * 1.8 + input.color.b * 4.0);
  let alpha = input.color.a * clamp(core * 1.18 + halo * 0.72 + star, 0.0, 1.35) * pulse;
  let hot = vec3f(1.0, 0.96, 1.0) * core * 0.42;
  let rgb = input.color.rgb * (0.75 + halo * 1.6 + star * 1.2) + hot;

  return vec4f(rgb * scene.contrast, alpha);
}
`

export interface MandalaRenderer {
  destroy: () => void
}

export async function startMandalaRenderer(canvas: HTMLCanvasElement): Promise<MandalaRenderer> {
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
  const geometry = createMandalaGeometry()
  const vertexBuffer = device.createBuffer({
    label: 'mandala vertices',
    size: geometry.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(vertexBuffer, 0, geometry.vertices)

  const uniformBuffer = device.createBuffer({
    label: 'scene uniforms',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const module = device.createShaderModule({
    label: 'mandala shader',
    code: shader,
  })

  const pipeline = device.createRenderPipeline({
    label: 'additive mandala pipeline',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vertexMain',
      buffers: [
        {
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 8, format: 'float32x2' },
            { shaderLocation: 2, offset: 16, format: 'float32x4' },
            { shaderLocation: 3, offset: 32, format: 'float32' },
          ],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one',
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

  const bindGroup = device.createBindGroup({
    label: 'scene bind group',
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: {
          buffer: uniformBuffer,
        },
      },
    ],
  })

  gpuContext.configure({
    device,
    format,
    alphaMode: 'opaque',
  })

  const uniforms = new Float32Array(4)
  const abortController = new AbortController()
  let animationFrame = 0
  let active = true

  document.addEventListener(
    'visibilitychange',
    () => {
      if (!document.hidden) {
        scheduleFrame()
      }
    },
    { signal: abortController.signal },
  )

  function frame(time: number): void {
    animationFrame = 0

    if (!active || document.hidden) {
      return
    }

    if (resizeCanvas(canvas)) {
      gpuContext.configure({
        device,
        format,
        alphaMode: 'opaque',
      })
    }

    const width = Math.max(1, canvas.width)
    const height = Math.max(1, canvas.height)
    const scaleX = width >= height ? height / width : 1
    const scaleY = height >= width ? width / height : 1
    uniforms.set([scaleX, scaleY, time * 0.001, 1.08])
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)

    const encoder = device.createCommandEncoder({
      label: 'mandala frame encoder',
    })
    const pass = encoder.beginRenderPass({
      label: 'mandala render pass',
      colorAttachments: [
        {
          view: gpuContext.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })

    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, vertexBuffer)
    pass.draw(geometry.vertexCount)
    pass.end()

    device.queue.submit([encoder.finish()])
    scheduleFrame()
  }

  function scheduleFrame(): void {
    if (!active || document.hidden || animationFrame !== 0) {
      return
    }

    animationFrame = requestAnimationFrame(frame)
  }

  const renderer: MandalaRenderer = {
    destroy: () => {
      if (!active) {
        return
      }

      active = false
      abortController.abort()

      if (animationFrame !== 0) {
        cancelAnimationFrame(animationFrame)
        animationFrame = 0
      }

      vertexBuffer.destroy()
      uniformBuffer.destroy()
    },
  }

  scheduleFrame()
  return renderer
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
