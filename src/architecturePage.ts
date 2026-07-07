import { startArchitectureRenderer } from './architectureRenderer'
import { setPageBodyClass } from './bodyClasses'
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from './studyFrame'

export function mountArchitecturePage(root: HTMLDivElement): PageHandle {
  setPageBodyClass('architecture-page-body')

  const { canvas, status } = mountStudyFrame(root, {
    route: 'architecture',
    pageClassName: 'study-page--architecture',
    canvasClassName: 'architecture-canvas',
    canvasLabel: 'WebGPU architectural network lattice',
    titleId: 'architecture-title',
    kicker: 'WebGPU study 04 / architectural network',
    title: 'Architectural network field.',
    description: 'A spatial system graph of structured nodes, instanced rails, and translucent routing planes rendered as a quiet 3D lattice.',
    actions: [
      { href: '/waves', label: 'Open waves', variant: 'primary' },
      { href: '/topography', label: 'View topography', variant: 'secondary' },
    ],
  })

  return connectStudyRenderer(canvas, status, startArchitectureRenderer)
}
