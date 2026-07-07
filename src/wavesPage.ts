import { setPageBodyClass } from './bodyClasses'
import { createLabHeader } from './navigation'
import { startWavesRenderer } from './wavesRenderer'

export function mountWavesPage(root: HTMLDivElement): void {
  setPageBodyClass('waves-page-body')
  window.scrollTo(0, 0)

  root.innerHTML = `
    <main class="waves-page" aria-labelledby="waves-title">
      <canvas class="waves-canvas" aria-label="Procedural WebGPU graphite wave field"></canvas>
      ${createLabHeader('waves')}

      <section class="waves-copy">
        <h1 id="waves-title">Maker met<br>codebasis<br>ervaring.</h1>
        <p>Parttime functies:</p>
        <p>Full-stack developer.</p>
      </section>

      <div class="waves-status" role="status" hidden></div>
    </main>
  `

  const canvas = root.querySelector<HTMLCanvasElement>('.waves-canvas')
  const status = root.querySelector<HTMLDivElement>('.waves-status')

  if (!canvas || !status) {
    throw new Error('The waves page could not be mounted.')
  }

  startWavesRenderer(canvas)
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
