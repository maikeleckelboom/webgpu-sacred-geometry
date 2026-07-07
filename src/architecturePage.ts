import { startArchitectureRenderer } from './architectureRenderer'
import { setPageBodyClass } from './bodyClasses'
import { createLabHeader } from './navigation'

export function mountArchitecturePage(root: HTMLDivElement): void {
  setPageBodyClass('architecture-page-body')
  window.scrollTo(0, 0)

  root.innerHTML = `
    <div class="architecture-page">
      ${createLabHeader('architecture')}

      <main class="architecture-stage" aria-labelledby="architecture-title">
        <canvas class="architecture-canvas" aria-label="WebGPU architectural network lattice"></canvas>

        <section class="architecture-copy">
          <p class="architecture-kicker">WebGPU study 04 / architectural network</p>
          <h1 id="architecture-title">Architectural network field</h1>
          <p>
            A spatial system graph of structured nodes, instanced rails, and translucent routing planes.
            The scene is generated as a real 3D lattice, then rendered with slow camera drift and focus depth.
          </p>
        </section>

        <div class="architecture-status" role="status" hidden></div>
      </main>

      <section class="architecture-strip" aria-label="Architecture rendering structure">
        <div>
          <span>Graph</span>
          <strong>clustered lattice</strong>
        </div>
        <div>
          <span>Rails</span>
          <strong>instanced screen quads</strong>
        </div>
        <div>
          <span>Depth</span>
          <strong>fog, focus, planes</strong>
        </div>
        <div>
          <span>Motion</span>
          <strong>reduced-motion aware</strong>
        </div>
      </section>
    </div>
  `

  const canvas = root.querySelector<HTMLCanvasElement>('.architecture-canvas')
  const status = root.querySelector<HTMLDivElement>('.architecture-status')

  if (!canvas || !status) {
    throw new Error('The architecture page could not be mounted.')
  }

  startArchitectureRenderer(canvas)
    .then((renderer) => {
      window.addEventListener('pagehide', () => renderer.destroy(), { once: true })
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'WebGPU initialization failed.'
      canvas.hidden = true
      status.hidden = false
      status.textContent = message
    })
}
