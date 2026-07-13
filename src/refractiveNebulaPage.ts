import { setPageBodyClass } from "./bodyClasses";
import {
  DEFAULT_REFRACTIVE_NEBULA_QUALITY,
  REFRACTIVE_NEBULA_QUALITY_LEVELS,
  normalizeRefractiveNebulaQuality,
  startRefractiveNebulaRenderer,
  type RefractiveNebulaQuality,
  type RefractiveNebulaRenderer,
} from "./refractiveNebulaRenderer";
import { connectStudyRenderer, mountStudyFrame, type PageHandle } from "./studyFrame";

export function mountRefractiveNebulaPage(root: HTMLDivElement): PageHandle {
  setPageBodyClass("refractive-nebula-page-body");

  const { canvas, status } = mountStudyFrame(root, {
    route: "refractive-nebula",
    pageClassName: "study-page--refractive-nebula",
    canvasClassName: "refractive-nebula-canvas",
    canvasLabel: "Volumetric WebGPU refractive nebula",
    titleId: "refractive-nebula-title",
    kicker: "WebGPU study 06 / refractive nebula",
    title: "Volumetric nebula through a refractive field.",
    description:
      "A compact volumetric shader study with refracted microstructure, slow parallax drift, star glints, and conservative quality scaling.",
    actions: [
      { href: "/hero-flow", label: "Open hero flow", variant: "primary" },
      { href: "/aurora", label: "View aurora", variant: "secondary" },
    ],
  });

  const page = root.querySelector<HTMLElement>(".study-page--refractive-nebula");

  if (!page) {
    throw new Error("The refractive nebula study page could not be mounted.");
  }

  const abortController = new AbortController();
  let selectedQuality = DEFAULT_REFRACTIVE_NEBULA_QUALITY;
  let activeRenderer: RefractiveNebulaRenderer | null = null;
  const qualityDock = document.createElement("form");
  qualityDock.className = "refractive-nebula-quality";
  qualityDock.setAttribute("aria-label", "Refractive nebula quality settings");
  qualityDock.innerHTML = `
    <label for="refractive-nebula-quality">Quality</label>
    <select id="refractive-nebula-quality" data-refractive-nebula-quality>
      ${REFRACTIVE_NEBULA_QUALITY_LEVELS.map(createQualityOption).join("")}
    </select>
    <span data-refractive-nebula-quality-meta></span>
  `;
  page.append(qualityDock);

  const qualitySelect = qualityDock.querySelector<HTMLSelectElement>(
    "[data-refractive-nebula-quality]",
  );
  const qualityMeta = qualityDock.querySelector<HTMLSpanElement>(
    "[data-refractive-nebula-quality-meta]",
  );

  if (!qualitySelect || !qualityMeta) {
    throw new Error("The refractive nebula quality control could not be mounted.");
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
      selectedQuality = normalizeRefractiveNebulaQuality(qualitySelect.value);
      qualitySelect.value = selectedQuality;
      activeRenderer?.setQuality(selectedQuality);
      updateQualityMeta(qualityMeta, selectedQuality);
    },
    { signal: abortController.signal },
  );

  const rendererHandle = connectStudyRenderer(canvas, status, async (mountedCanvas) => {
    const renderer = await startRefractiveNebulaRenderer(mountedCanvas, {
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

function createQualityOption(level: (typeof REFRACTIVE_NEBULA_QUALITY_LEVELS)[number]): string {
  return `<option value="${level.id}">${level.label}</option>`;
}

function updateQualityMeta(target: HTMLSpanElement, quality: RefractiveNebulaQuality): void {
  const level =
    REFRACTIVE_NEBULA_QUALITY_LEVELS.find((candidate) => candidate.id === quality) ??
    REFRACTIVE_NEBULA_QUALITY_LEVELS[0];

  const starLayerLabel = level.starLayers === 1 ? "star layer" : "star layers";
  target.textContent = `${Math.round(level.resolutionScale * 100)}% scale, ${level.rayMarchSteps} ray steps, ${level.noiseOctaves} noise octaves, ${level.starLayers} ${starLayerLabel}`;
}
