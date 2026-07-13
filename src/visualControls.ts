export type Vec2Control = readonly [number, number];

export interface TopographyShapeControl {
  center: Vec2Control;
  radius: Vec2Control;
  rotation: number;
  levels: number;
  height: number;
  phase: number;
  roughness: number;
  focus: number;
}

export interface VisualControls {
  particles: {
    flowCount: number;
    auroraCount: number;
    flowTrailDecay: number;
  };
  flow: {
    modeTransitionRate: number;
    reducedMotionScale: number;
  };
  stars: {
    shaderLocalFiles: readonly string[];
  };
  sky: {
    auroraPointerHome: Vec2Control;
    refractiveNebula: {
      defaultOptions: {
        quality: "low" | "medium" | "high" | "ultra";
        intensity: number;
        parallax: number;
        seed: number;
      };
      qualitySettings: {
        low: RefractiveNebulaQualityControl;
        medium: RefractiveNebulaQualityControl;
        high: RefractiveNebulaQualityControl;
        ultra: RefractiveNebulaQualityControl;
      };
    };
  };
  bloom: {
    flow: {
      levels: number;
      baseMax: number;
      threshold: number;
      softKnee: number;
      intensity: number;
      exposure: number;
      shadingStrength: number;
    };
  };
  pointer: {
    flow: {
      activeStrengthGain: number;
      pressedStrengthGain: number;
      idleDecay: number;
      reducedMotionIdleDecay: number;
      pressureChargeRate: number;
      pressureReleaseRate: number;
      pressureChargeReducedMotionScale: number;
      pressureReleaseReducedMotionScale: number;
    };
    aurora: {
      moveStrengthGain: number;
      leaveStrengthCap: number;
      lerpRate: number;
      idleDecay: number;
      reducedMotionIdleDecay: number;
      reducedMotionScale: number;
    };
    topography: {
      enterStrength: number;
      leaveStrengthCap: number;
      reducedMotionScale: number;
      eyeXInfluence: number;
      eyeYInfluence: number;
      idleDecay: number;
      reducedMotionIdleDecay: number;
    };
    flowSheet: {
      lerpRate: number;
      idleDecay: number;
      reducedMotionScale: number;
      grabResponse: number;
      grabRelease: number;
    };
  };
  performance: {
    maxPixelRatio: {
      flow: number;
      aurora: number;
      topography: number;
      flowSheet: number;
      refractiveNebula: number;
    };
    sampleCount: {
      topography: number;
      flowSheet: number;
    };
  };
  geometry: {
    topography: {
      segments: number;
      shapes: readonly TopographyShapeControl[];
    };
    flowSheet: {
      layerCount: number;
      rowsPerLayer: number;
      pointCount: number;
    };
  };
}

interface RefractiveNebulaQualityControl {
  label: string;
  shaderQuality: 0 | 1 | 2 | 3;
  resolutionScale: number;
  rayMarchSteps: number;
  noiseOctaves: number;
  starLayers: number;
}

export const defaultVisualControls = {
  particles: {
    flowCount: 36000,
    auroraCount: 72000,
    flowTrailDecay: 0.965,
  },
  flow: {
    modeTransitionRate: 7.0,
    reducedMotionScale: 0.28,
  },
  stars: {
    shaderLocalFiles: [
      "src/shaders/flow-post.wgsl",
      "src/shaders/aurora-post.wgsl",
      "src/shaders/refractive-nebula.wgsl",
    ],
  },
  sky: {
    auroraPointerHome: [0.42, 0],
    refractiveNebula: {
      defaultOptions: {
        quality: "medium",
        intensity: 1,
        parallax: 0.8,
        seed: 1,
      },
      qualitySettings: {
        low: {
          label: "Low",
          shaderQuality: 0,
          resolutionScale: 0.5,
          rayMarchSteps: 5,
          noiseOctaves: 3,
          starLayers: 1,
        },
        medium: {
          label: "Medium",
          shaderQuality: 1,
          resolutionScale: 0.66,
          rayMarchSteps: 7,
          noiseOctaves: 4,
          starLayers: 1,
        },
        high: {
          label: "High",
          shaderQuality: 2,
          resolutionScale: 0.82,
          rayMarchSteps: 10,
          noiseOctaves: 5,
          starLayers: 2,
        },
        ultra: {
          label: "Ultra",
          shaderQuality: 3,
          resolutionScale: 1,
          rayMarchSteps: 12,
          noiseOctaves: 6,
          starLayers: 3,
        },
      },
    },
  },
  bloom: {
    flow: {
      levels: 5,
      baseMax: 640,
      threshold: 0.5,
      softKnee: 0.7,
      intensity: 1.08,
      exposure: 1.04,
      shadingStrength: 0.5,
    },
  },
  pointer: {
    flow: {
      activeStrengthGain: 0.4,
      pressedStrengthGain: 0.5,
      idleDecay: 0.94,
      reducedMotionIdleDecay: 0.86,
      pressureChargeRate: 2.15,
      pressureReleaseRate: 3.0,
      pressureChargeReducedMotionScale: 0.5,
      pressureReleaseReducedMotionScale: 0.6,
    },
    aurora: {
      moveStrengthGain: 0.18,
      leaveStrengthCap: 0.18,
      lerpRate: 0.065,
      idleDecay: 0.965,
      reducedMotionIdleDecay: 0.9,
      reducedMotionScale: 0.28,
    },
    topography: {
      enterStrength: 1,
      leaveStrengthCap: 0.15,
      reducedMotionScale: 0.15,
      eyeXInfluence: 0.035,
      eyeYInfluence: 0.018,
      idleDecay: 0.97,
      reducedMotionIdleDecay: 0.92,
    },
    flowSheet: {
      lerpRate: 0.1,
      idleDecay: 0.96,
      reducedMotionScale: 0.28,
      grabResponse: 0.18,
      grabRelease: 0.012,
    },
  },
  performance: {
    maxPixelRatio: {
      flow: 2,
      aurora: 2,
      topography: 2.5,
      flowSheet: 2.5,
      refractiveNebula: 2,
    },
    sampleCount: {
      topography: 4,
      flowSheet: 4,
    },
  },
  geometry: {
    topography: {
      segments: 216,
      shapes: [
        {
          center: [0.98, -0.16],
          radius: [0.92, 0.6],
          rotation: -0.16,
          levels: 25,
          height: 0.66,
          phase: 1.2,
          roughness: 0.18,
          focus: 0.05,
        },
        {
          center: [1.66, 0.12],
          radius: [0.82, 0.52],
          rotation: 0.24,
          levels: 19,
          height: 0.48,
          phase: 2.6,
          roughness: 0.16,
          focus: -0.04,
        },
        {
          center: [0.18, 0.28],
          radius: [0.68, 0.44],
          rotation: 0.18,
          levels: 15,
          height: 0.34,
          phase: 4.7,
          roughness: 0.17,
          focus: 0.15,
        },
        {
          center: [1.22, -1.18],
          radius: [1.18, 0.46],
          rotation: -0.03,
          levels: 16,
          height: 0.34,
          phase: 5.4,
          roughness: 0.09,
          focus: 0.6,
        },
        {
          center: [0.4, -1.42],
          radius: [0.86, 0.34],
          rotation: -0.08,
          levels: 12,
          height: 0.26,
          phase: 6.35,
          roughness: 0.16,
          focus: 0.72,
        },
        {
          center: [2.18, -0.34],
          radius: [1.08, 0.4],
          rotation: 0.08,
          levels: 13,
          height: 0.3,
          phase: 7.2,
          roughness: 0.17,
          focus: 0.3,
        },
        {
          center: [-1.22, 1.05],
          radius: [1.12, 0.52],
          rotation: -0.08,
          levels: 13,
          height: 0.3,
          phase: 8.3,
          roughness: 0.16,
          focus: -0.72,
        },
        {
          center: [0.18, -1.78],
          radius: [0.92, 0.38],
          rotation: 0.06,
          levels: 11,
          height: 0.25,
          phase: 9.8,
          roughness: 0.1,
          focus: 0.82,
        },
      ],
    },
    flowSheet: {
      layerCount: 1,
      rowsPerLayer: 104,
      pointCount: 640,
    },
  },
} as const satisfies VisualControls;

// TODO: Star density/brightness/twinkle, sky gradients, fine flow-field noise,
// bloom upsample/gamma, and pressure boost color math remain shader-local for
// now. Move them to uniforms before treating them as live runtime controls.
