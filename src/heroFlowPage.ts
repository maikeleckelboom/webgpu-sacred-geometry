import { setPageBodyClass } from "./bodyClasses";
import { startInkFlowRenderer } from "./inkFlowRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

// Portfolio hero prototype: graphite streamlines on paper. The luminous
// dark treatment lives on its own route so each page has one renderer and
// one stable surface contract.
export function mountHeroFlowPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("hero-flow-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "hero-flow",
    pageClassName: "study-page--hero-flow",
    canvasClassName: "hero-flow-canvas",
    canvasLabel: "WebGPU particle flow field hero background",
    titleId: "hero-flow-title",
    kicker: "WebGPU study 02 / aurora compute flow",
    title: "Particle flow field under northern light.",
    description:
      "A luminous field of routed particles, drifting curtains, and reactive wake lines moving through soft attractors.",
    actions: [
      { href: "/hero-flow-dark", label: "Open dark hero", variant: "primary" },
      { href: "/aurora", label: "View aurora", variant: "secondary" },
    ],
  });

  const page = root.querySelector<HTMLElement>(".study-page--hero-flow");

  if (!page) {
    throw new Error("The hero flow study page could not be mounted.");
  }

  page.classList.add("is-flow-light");
  document.body.classList.add("hero-flow-page-body--light");
  canvas.dataset.flowTheme = "light";
  const rendererHandle = connectStudyRenderer(canvas, status, startInkFlowRenderer);

  return {
    destroy: () => {
      document.body.classList.remove("hero-flow-page-body--light");
      rendererHandle.destroy();
    },
  };
}
