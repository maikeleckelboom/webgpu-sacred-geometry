import './style.css'
import { mountFlowFieldPage } from './flowPage'
import { startMandalaRenderer } from './renderer'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('The app root could not be mounted.')
}

const pathname = window.location.pathname.replace(/\/$/, '')

if (pathname === '/flow-field') {
  mountFlowFieldPage(app)
} else {
  mountMandalaPage(app)
}

function mountMandalaPage(root: HTMLDivElement): void {
  document.body.classList.remove('flow-page-body')
  root.innerHTML = `
  <canvas id="mandala" aria-label="WebGPU sacred geometry study"></canvas>
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
