const pageBodyClasses = [
  "flow-page-body",
  "aurora-page-body",
  "topography-page-body",
  "architecture-page-body",
  "waves-page-body",
  "living-glass-page-body",
];

export function setPageBodyClass(activeClass: string): void {
  for (const className of pageBodyClasses) {
    document.body.classList.remove(className);
  }

  document.body.classList.add(activeClass);
}
