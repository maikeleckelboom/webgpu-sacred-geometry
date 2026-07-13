import { setPageBodyClass } from "./bodyClasses";
import { startAuroraRenderer } from "./auroraRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

export function mountAuroraPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("aurora-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "aurora",
    pageClassName: "study-page--aurora",
    canvasClassName: "aurora-canvas",
    canvasLabel: "Aurora WebGPU particle curtains study",
    titleId: "aurora-title",
    kicker: "WebGPU study 01 / aurora curtains",
    title: "An authored aurora river with a calm magnetic lens.",
    description:
      "One luminous primary flow, a distant supporting curtain, and sparse atmosphere composed around deliberate negative space.",
    actions: [
      { href: "/hero-flow", label: "Open hero flow", variant: "primary" },
      { href: "/topography", label: "View topography", variant: "secondary" },
    ],
  });

  return connectStudyRenderer(canvas, status, startAuroraRenderer);
}
