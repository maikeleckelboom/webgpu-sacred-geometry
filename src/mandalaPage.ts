import { setPageBodyClass } from './bodyClasses'
import { startMandalaRenderer } from './renderer'
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from './studyFrame'

export function mountMandalaPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass('mandala-page-body')

  const { canvas, status } = mountStudyFrame(root, {
    route: 'mandala',
    pageClassName: 'study-page--mandala',
    canvasClassName: 'mandala-canvas',
    canvasLabel: 'WebGPU luminous mandala geometry study',
    titleId: 'mandala-title',
    kicker: 'WebGPU study 01 / luminous symmetry',
    title: 'Mandala geometry study',
    description: 'A compact symmetry study rendered with expanded WebGPU linework, additive light, and responsive geometry scaling.',
    actions: [
      { href: '/flow-field', label: 'Open flow field', variant: 'primary' },
      { href: '/topography', label: 'View topography', variant: 'secondary' },
    ],
  })

  return connectStudyRenderer(canvas, status, startMandalaRenderer)
}
