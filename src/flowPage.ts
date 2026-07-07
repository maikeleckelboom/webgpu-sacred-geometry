import { setPageBodyClass } from './bodyClasses'
import { startFlowFieldRenderer } from './flowRenderer'
import { createLabHeader } from './navigation'

export function mountFlowFieldPage(root: HTMLDivElement): void {
  setPageBodyClass('flow-page-body')

  root.innerHTML = `
    <div class="flow-page">
      <canvas class="flow-canvas" aria-label="Abstract WebGPU particle flow field"></canvas>

      ${createLabHeader('flow-field')}

      <main class="flow-hero">
        <p class="flow-kicker">WebGPU study 02 / compute flow</p>
        <h1>Particle routing field with soft system attractors.</h1>
        <p class="flow-subtitle">
          A high-key study of many fine traces moving through field basins, lenses,
          and slow pointer deflection.
        </p>
        <div class="flow-actions" aria-label="Primary actions">
          <a class="flow-action flow-action--primary" href="/architecture">Open architecture field</a>
          <a class="flow-action flow-action--secondary" href="/topography">View topography &#8594;</a>
        </div>
      </main>

      <section class="flow-cards" aria-label="Flow field structure">
        <article class="flow-card">
          <p>Simulation</p>
          <h2>Compute buffers update trace position and velocity without CPU-side particle work per frame.</h2>
        </article>
        <article class="flow-card">
          <p>Field</p>
          <h2>Layered attractors, basins, and lenses create a routed surface instead of loose particle noise.</h2>
        </article>
        <article class="flow-card">
          <p>Rendering</p>
          <h2>Instanced trails and small node sprites keep the visual sharp while preserving soft motion.</h2>
        </article>
        <article class="flow-card">
          <p>Motion</p>
          <h2>Reduced-motion users receive a calmer field with the same static composition and route context.</h2>
        </article>
      </section>

      <div class="flow-status" role="status" hidden></div>
    </div>
  `

  const canvas = root.querySelector<HTMLCanvasElement>('.flow-canvas')
  const status = root.querySelector<HTMLDivElement>('.flow-status')

  if (!canvas || !status) {
    throw new Error('The flow field page could not be mounted.')
  }

  startFlowFieldRenderer(canvas).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'WebGPU initialization failed.'
    status.hidden = false
    status.textContent = message
  })
}
