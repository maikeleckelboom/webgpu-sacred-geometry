import './style.css'
import { mountArchitecturePage } from './architecturePage'
import { setPageBodyClass } from './bodyClasses'
import { mountFlowFieldPage } from './flowPage'
import { startMandalaRenderer } from './renderer'
import { createLabHeader } from './navigation'
import { mountTopographyPage } from './topographyPage'
import { mountWavesPage } from './wavesPage'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('The app root could not be mounted.')
}

const pathname = window.location.pathname.replace(/\/$/, '')

if (pathname === '/flow-field') {
  mountFlowFieldPage(app)
} else if (pathname === '/topography') {
  mountTopographyPage(app)
} else if (pathname === '/architecture') {
  mountArchitecturePage(app)
} else if (pathname === '/waves') {
  mountWavesPage(app)
} else {
  mountMandalaPage(app)
}

function mountMandalaPage(root: HTMLDivElement): void {
  setPageBodyClass('mandala-page-body')
  root.innerHTML = `
    <canvas id="mandala" aria-label="WebGPU sacred geometry study"></canvas>
    ${createLabHeader('mandala')}
    <section class="mandala-summary" aria-labelledby="mandala-title">
      <p>WebGPU study 01 / luminous symmetry</p>
      <h1 id="mandala-title">Mandala geometry study</h1>
    </section>
    <div id="status" role="status" hidden></div>
  `

  const canvas = document.querySelector<HTMLCanvasElement>('#mandala')
  const status = document.querySelector<HTMLDivElement>('#status')

  if (!canvas || !status) {
    throw new Error('The mandala canvas could not be mounted.')
  }

  startMandalaRenderer(canvas).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'WebGPU initialization failed.'
    status.hidden = false
    status.textContent = message
  })
}
