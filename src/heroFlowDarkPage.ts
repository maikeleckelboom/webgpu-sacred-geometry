import { setPageBodyClass } from "./bodyClasses";
import { startFlowFieldRenderer } from "./flowRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

// This is the page's background seam. Swap this function when trying another
// renderer behind the same hero composition; no hero markup needs to change.
const startHeroBackground = (canvas: HTMLCanvasElement) =>
  startFlowFieldRenderer(canvas, "dark");

export function mountHeroFlowDarkPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("hero-flow-dark-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "hero-flow-dark",
    pageClassName: "study-page--hero-flow study-page--hero-flow-dark",
    canvasClassName: "hero-flow-canvas",
    canvasLabel: "WebGPU particle flow field behind a dark hero example",
    titleId: "hero-flow-dark-title",
    kicker: "WebGPU study 02 / dark hero",
    title: "productsoftware van interface tot systeem.",
    description:
      "Full-stack developer met een sterke frontendbasis. Ik werk aan interfaces, applicatielogica en de technische samenhang ertussen.",
    actions: [
      { href: "https://maikel.site/werk", label: "Bekijk mijn werk", variant: "primary" },
      {
        href: "https://maikel.site/loopbaan",
        label: "Bekijk mijn loopbaan",
        variant: "secondary",
      },
    ],
  });

  const page = root.querySelector<HTMLElement>(".study-page--hero-flow-dark");

  if (!page) {
    throw new Error("The dark hero flow study page could not be mounted.");
  }

  canvas.dataset.flowTheme = "dark";
  const rendererHandle = connectStudyRenderer(canvas, status, startHeroBackground);

  return {
    destroy: () => {
      rendererHandle.destroy();
    },
  };
}
