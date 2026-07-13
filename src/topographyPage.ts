import { setPageBodyClass } from "./bodyClasses";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";
import { startTopographyRenderer } from "./topographyRenderer";

export function mountTopographyPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("topography-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "topography",
    pageClassName: "study-page--topography",
    canvasClassName: "topography-canvas",
    canvasLabel: "Generative WebGPU topography",
    titleId: "topography-title",
    kicker: "WebGPU study 03 / contour volume",
    title: "Layered terrain relief with procedural contour strata.",
    description:
      "A grayscale volume study built from generated contour meshes, shallow fog, and a post-process focus pass.",
    actions: [
      { href: "/refractive-nebula", label: "Open refractive nebula", variant: "primary" },
      { href: "/hero-flow", label: "View hero flow", variant: "secondary" },
    ],
  });

  return connectStudyRenderer(canvas, status, startTopographyRenderer);
}
