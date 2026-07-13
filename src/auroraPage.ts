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
    title: "Aurora particle curtains over soft attractors.",
    description:
      "A dense field of routed particles drifting through layered curtains, lens-like attractors, and reactive wake lines.",
    actions: [
      { href: "/hero-flow", label: "Open hero flow", variant: "primary" },
      { href: "/flow-sheet", label: "View flow sheet", variant: "secondary" },
    ],
  });

  return connectStudyRenderer(canvas, status, startAuroraRenderer);
}
