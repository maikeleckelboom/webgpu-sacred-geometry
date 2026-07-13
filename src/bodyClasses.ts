const pageBodyClasses = [
  "flow-sheet-page-body",
  "hero-flow-page-body",
  "hero-flow-page-body--light",
  "aurora-page-body",
  "topography-page-body",
  "refractive-nebula-page-body",
];

export function setPageBodyClass(activeClass: string): void {
  for (const className of pageBodyClasses) {
    document.body.classList.remove(className);
  }

  document.body.classList.add(activeClass);
}
