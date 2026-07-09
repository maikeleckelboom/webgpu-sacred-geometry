import { setPageBodyClass } from "./bodyClasses";
import { startFlowFieldRenderer } from "./flowRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

export function mountFlowFieldPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("flow-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "flow-field",
    pageClassName: "study-page--flow",
    canvasClassName: "flow-canvas",
    canvasLabel: "Aurora WebGPU particle flow field",
    titleId: "flow-title",
    kicker: "WebGPU study 02 / aurora compute flow",
    title: "Particle flow field under northern light.",
    description:
      "A luminous field of routed particles, drifting curtains, and reactive wake lines moving through soft attractors.",
    actions: [
      { href: "/topography", label: "Open topography", variant: "primary" },
      { href: "/architecture", label: "View architecture", variant: "secondary" },
    ],
  });

  return connectStudyRenderer(canvas, status, startFlowFieldRenderer);
}
