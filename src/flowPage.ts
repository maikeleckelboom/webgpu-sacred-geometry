import { setPageBodyClass } from './bodyClasses'
import { startFlowFieldRenderer } from './flowRenderer'
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from './studyFrame'

export function mountFlowFieldPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass('flow-page-body')

  const { canvas, status } = mountStudyFrame(root, {
    route: 'flow-field',
    pageClassName: 'study-page--flow',
    canvasClassName: 'flow-canvas',
    canvasLabel: 'Abstract WebGPU particle flow field',
    titleId: 'flow-title',
    kicker: 'WebGPU study 02 / compute flow',
    title: 'Particle routing field with soft system attractors.',
    description: 'A high-key study of fine traces moving through field basins, lenses, and slow deflection.',
    actions: [
      { href: '/topography', label: 'Open topography', variant: 'primary' },
      { href: '/architecture', label: 'View architecture', variant: 'secondary' },
    ],
  })

  return connectStudyRenderer(canvas, status, startFlowFieldRenderer)
}
