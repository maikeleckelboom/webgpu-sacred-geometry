import { startFlowFieldRenderer } from './flowRenderer'

export function mountFlowFieldPage(root: HTMLDivElement): void {
  document.body.classList.add('flow-page-body')

  root.innerHTML = `
    <div class="flow-page">
      <canvas class="flow-canvas" aria-label="Abstract WebGPU particle flow field"></canvas>

      <header class="flow-header">
        <a class="flow-brand" href="/flow-field" aria-label="Maikel Eckelboom home">Maikel Eckelboom</a>
        <nav class="flow-nav" aria-label="Primary">
          <a class="flow-nav__link is-active" href="/flow-field">Home</a>
          <a class="flow-nav__link" href="#career">Loopbaan</a>
          <a class="flow-nav__link" href="#work">Werk</a>
          <a class="flow-nav__button" href="mailto:hello@example.com">Contact</a>
        </nav>
      </header>

      <main class="flow-hero">
        <p class="flow-kicker">Maikel Eckelboom - full-stack developer</p>
        <h1>Full-stack developer met een sterke frontendbasis en echte productervaring.</h1>
        <p class="flow-subtitle">
          Mijn beide softwarestages liepen aansluitend door in parttime functies:
          bij Factif als junior front-end developer en bij gwbo als full-stack developer.
        </p>
        <div class="flow-actions" aria-label="Primary actions">
          <a class="flow-action flow-action--primary" href="#work">Bekijk het werk</a>
          <a class="flow-action flow-action--secondary" href="#career">Bekijk de loopbaan &#8594;</a>
        </div>
      </main>

      <section class="flow-cards" aria-label="Experience highlights">
        <article id="career" class="flow-card">
          <p>Stage &#8594; werk</p>
          <h2>Beide softwarestages liepen aansluitend door in parttime developerfuncties - bij Factif en bij gwbo.</h2>
        </article>
        <article id="work" class="flow-card">
          <p>Frontendproductie · Factif</p>
          <h2>Ontwerpen vertaald naar responsive websites, templates en UI-componenten.</h2>
        </article>
        <article class="flow-card">
          <p>Full-stack product · gwbo</p>
          <h2>Klantvraag naar datamodel, API en interface - met autorisatie, deployment en documentatie.</h2>
        </article>
        <article class="flow-card">
          <p>Zelfstandig · sinds 2023</p>
          <h2>Eigen technisch onderzoek: codebases lezen, systemen wijzigen en beslissingen documenteren.</h2>
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
