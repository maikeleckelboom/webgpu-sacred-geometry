import { setPageBodyClass } from "./bodyClasses";
import { startFlowSheetRenderer } from "./flowSheetRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

export function mountFlowSheetPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("flow-sheet-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "flow-sheet",
    pageClassName: "study-page--flow-sheet",
    canvasClassName: "flow-sheet-canvas",
    canvasLabel: "Layered WebGPU flow sheet folding through a dimensional throat",
    titleId: "flow-sheet-title",
    kicker: "WebGPU study 04 / dimensional flow sheet",
    title: "A field folded into a sheet.",
    description:
      "Layered trajectories converge through a quiet throat, then open into a shifting graphite surface with depth-aware parallax.",
    actions: [
      { href: "/flow-field", label: "Open flow field", variant: "primary" },
      { href: "/topography", label: "View topography", variant: "secondary" },
    ],
  });

  return connectStudyRenderer(canvas, status, startFlowSheetRenderer);
}
