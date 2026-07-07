const pageBodyClasses = [
  'mandala-page-body',
  'flow-page-body',
  'topography-page-body',
  'architecture-page-body',
  'waves-page-body',
]

export function setPageBodyClass(activeClass: string): void {
  for (const className of pageBodyClasses) {
    document.body.classList.remove(className)
  }

  document.body.classList.add(activeClass)
}
