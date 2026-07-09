import { setPageBodyClass } from "./bodyClasses";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";
import { startWavesRenderer } from "./wavesRenderer";

export function mountWavesPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("waves-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "waves",
    pageClassName: "study-page--waves",
    canvasClassName: "waves-canvas",
    canvasLabel: "Procedural WebGPU graphite wave field",
    titleId: "waves-title",
    kicker: "WebGPU study 05 / graphite streamlines",
    title: "Graphite wave field reconstructed as procedural linework.",
    description:
      "A high-key canvas study of warped streamlines, narrow segment quads, and paper-like contrast.",
    actions: [
      { href: "/flow-field", label: "Open flow field", variant: "primary" },
      { href: "/topography", label: "View topography", variant: "secondary" },
    ],
  });

  return connectStudyRenderer(canvas, status, startWavesRenderer);
}
