import { setPageBodyClass } from './bodyClasses'
import { createLabHeader } from './navigation'
import { startTopographyRenderer } from './topographyRenderer'

export function mountTopographyPage(root: HTMLDivElement): void {
  setPageBodyClass('topography-page-body')
  window.scrollTo(0, 0)

  root.innerHTML = `
    <div class="topography-page">
      <canvas class="topography-canvas" aria-label="Generative WebGPU topography"></canvas>

      ${createLabHeader('topography')}

      <main class="topography-hero">
        <p class="topography-kicker">WebGPU study 03 / contour volume</p>
        <h1>Layered terrain relief with procedural contour strata.</h1>
        <p class="topography-subtitle">
          A grayscale volume study built from generated contour meshes, shallow fog,
          and a post-process focus pass.
        </p>
        <div class="topography-actions" aria-label="Primary actions">
          <a class="topography-action topography-action--primary" href="/architecture">Open architecture field</a>
          <a class="topography-action topography-action--secondary" href="/flow-field">View flow field &#8594;</a>
        </div>
      </main>

      <section class="topography-cards" aria-label="Topography structure">
        <article class="topography-card">
          <p>Geometry</p>
          <h2>Nested contour loops build actual mesh depth rather than a flat image filter.</h2>
        </article>
        <article class="topography-card">
          <p>Lighting</p>
          <h2>Metallic grayscale shading separates ridge tops, side walls, and the floor plane.</h2>
        </article>
        <article class="topography-card">
          <p>Focus</p>
          <h2>Distance-based blur and fog keep the composition calm at large screen sizes.</h2>
        </article>
        <article class="topography-card">
          <p>Interaction</p>
          <h2>Pointer motion subtly shifts the camera while preserving the studied relief structure.</h2>
        </article>
      </section>

      <div class="topography-status" role="status" hidden></div>
    </div>
  `

  const canvas = root.querySelector<HTMLCanvasElement>('.topography-canvas')
  const status = root.querySelector<HTMLDivElement>('.topography-status')

  if (!canvas || !status) {
    throw new Error('The topography page could not be mounted.')
  }

  startTopographyRenderer(canvas).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'WebGPU initialization failed.'
    status.hidden = false
    status.textContent = message
  })
}
