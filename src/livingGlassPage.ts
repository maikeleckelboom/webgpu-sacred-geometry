import { setPageBodyClass } from "./bodyClasses";
import {
  DEFAULT_LIVING_GLASS_QUALITY,
  LIVING_GLASS_QUALITY_LEVELS,
  normalizeLivingGlassQuality,
  startLivingGlassRenderer,
  type LivingGlassQuality,
  type LivingGlassRenderer,
} from "./livingGlassRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

export function mountLivingGlassPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("living-glass-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "living-glass",
    pageClassName: "study-page--living-glass",
    canvasClassName: "living-glass-canvas",
    canvasLabel: "Volumetric WebGPU living glass nebula",
    titleId: "living-glass-title",
    kicker: "WebGPU study 06 / living glass",
    title: "Living glass nebula behind refractive star fields.",
    description:
      "A compact volumetric shader study with refracted microstructure, slow parallax drift, star glints, and conservative quality scaling.",
    actions: [
      { href: "/flow-field", label: "Open flow field", variant: "primary" },
      { href: "/aurora", label: "View aurora", variant: "secondary" },
    ],
  });

  const page = root.querySelector<HTMLElement>(".study-page--living-glass");

  if (!page) {
    throw new Error("The living glass study page could not be mounted.");
  }

  const abortController = new AbortController();
  let selectedQuality = DEFAULT_LIVING_GLASS_QUALITY;
  let activeRenderer: LivingGlassRenderer | null = null;
  const qualityDock = document.createElement("form");
  qualityDock.className = "living-glass-quality";
  qualityDock.setAttribute("aria-label", "Living glass quality settings");
  qualityDock.innerHTML = `
    <label for="living-glass-quality">Quality</label>
    <select id="living-glass-quality" data-living-glass-quality>
      ${LIVING_GLASS_QUALITY_LEVELS.map(createQualityOption).join("")}
    </select>
    <span data-living-glass-quality-meta></span>
  `;
  page.append(qualityDock);

  const qualitySelect = qualityDock.querySelector<HTMLSelectElement>("[data-living-glass-quality]");
  const qualityMeta = qualityDock.querySelector<HTMLSpanElement>("[data-living-glass-quality-meta]");

  if (!qualitySelect || !qualityMeta) {
    throw new Error("The living glass quality control could not be mounted.");
  }

  qualitySelect.value = selectedQuality;
  updateQualityMeta(qualityMeta, selectedQuality);
  qualityDock.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
    },
    { signal: abortController.signal },
  );
  qualitySelect.addEventListener(
    "change",
    () => {
      selectedQuality = normalizeLivingGlassQuality(qualitySelect.value);
      qualitySelect.value = selectedQuality;
      activeRenderer?.setQuality(selectedQuality);
      updateQualityMeta(qualityMeta, selectedQuality);
    },
    { signal: abortController.signal },
  );

  const rendererHandle = connectStudyRenderer(canvas, status, async (mountedCanvas) => {
    const renderer = await startLivingGlassRenderer(mountedCanvas, {
      quality: selectedQuality,
    });

    activeRenderer = renderer;
    return {
      destroy: () => {
        if (activeRenderer === renderer) {
          activeRenderer = null;
        }

        renderer.destroy();
      },
    };
  });

  return {
    destroy: () => {
      abortController.abort();
      rendererHandle.destroy();
      activeRenderer = null;
    },
  };
}

function createQualityOption(level: (typeof LIVING_GLASS_QUALITY_LEVELS)[number]): string {
  return `<option value="${level.id}">${level.label}</option>`;
}

function updateQualityMeta(target: HTMLSpanElement, quality: LivingGlassQuality): void {
  const level =
    LIVING_GLASS_QUALITY_LEVELS.find((candidate) => candidate.id === quality) ??
    LIVING_GLASS_QUALITY_LEVELS[0];

  const starLayerLabel = level.starLayers === 1 ? "star layer" : "star layers";
  target.textContent = `${Math.round(level.resolutionScale * 100)}% scale, ${level.rayMarchSteps} ray steps, ${level.noiseOctaves} noise octaves, ${level.starLayers} ${starLayerLabel}`;
}
