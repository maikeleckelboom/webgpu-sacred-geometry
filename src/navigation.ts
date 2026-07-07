export type LabRoute = 'mandala' | 'flow-field' | 'topography' | 'architecture' | 'waves'

const navItems: Array<{ route: LabRoute; href: string; label: string }> = [
  { route: 'mandala', href: '/', label: 'Mandala' },
  { route: 'flow-field', href: '/flow-field', label: 'Flow field' },
  { route: 'topography', href: '/topography', label: 'Topography' },
  { route: 'architecture', href: '/architecture', label: 'Architecture' },
  { route: 'waves', href: '/waves', label: 'Waves' },
]

export function createLabHeader(activeRoute: LabRoute): string {
  const links = navItems
    .map(({ route, href, label }) => {
      const activeClass = route === activeRoute ? ' is-active' : ''
      const ariaCurrent = route === activeRoute ? ' aria-current="page"' : ''
      return `<a class="lab-nav__link${activeClass}" href="${href}" data-route="${route}"${ariaCurrent}>${label}</a>`
    })
    .join('')

  return `
    <header class="lab-header">
      <a class="lab-brand" href="/" aria-label="WebGPU Sacred Geometry home">WebGPU Sacred Geometry</a>
      <nav class="lab-nav" aria-label="Study navigation">
        ${links}
      </nav>
    </header>
  `
}

export function setLabHeaderActive(activeRoute: LabRoute): void {
  const links = document.querySelectorAll<HTMLAnchorElement>('.lab-nav__link[data-route]')

  for (const link of links) {
    const isActive = link.dataset.route === activeRoute
    link.classList.toggle('is-active', isActive)

    if (isActive) {
      link.setAttribute('aria-current', 'page')
    } else {
      link.removeAttribute('aria-current')
    }
  }
}
