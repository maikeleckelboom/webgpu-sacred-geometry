export interface MandalaGeometry {
  vertices: Float32Array
  vertexCount: number
}

type Point = [number, number]
type Color = [number, number, number, number]

const TAU = Math.PI * 2
const FLOATS_PER_VERTEX = 9

const cyan: Color = [0.03, 0.76, 1, 0.78]
const deepCyan: Color = [0.0, 0.32, 0.78, 0.54]
const blue: Color = [0.13, 0.46, 1, 0.92]
const electric: Color = [0.42, 0.72, 1, 0.96]
const violet: Color = [0.57, 0.25, 1, 0.82]
const white: Color = [0.9, 0.96, 1, 0.9]
const amber: Color = [1, 0.58, 0.16, 0.88]

export function createMandalaGeometry(): MandalaGeometry {
  const builder = new GeometryBuilder()

  addOuterRings(builder)
  addMainFrame(builder)
  addInnerLattice(builder)
  addPrecisionMesh(builder)
  addOrbitalMachinery(builder)
  addPanelCircuits(builder)
  addRadialGlyphs(builder)
  addStarField(builder)

  return builder.geometry()
}

class GeometryBuilder {
  private readonly data: number[] = []

  get vertexCount(): number {
    return this.data.length / FLOATS_PER_VERTEX
  }

  geometry(): MandalaGeometry {
    return {
      vertices: new Float32Array(this.data),
      vertexCount: this.vertexCount,
    }
  }

  glowLine(start: Point, end: Point, width: number, color: Color, glow = 1): void {
    this.line(start, end, width * 14 * glow, fade(color, 0.075))
    this.line(start, end, width * 7 * glow, fade(color, 0.16))
    this.line(start, end, width * 2.6, fade(color, 0.36))
    this.line(start, end, width, color)
  }

  line(start: Point, end: Point, width: number, color: Color): void {
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const length = Math.hypot(dx, dy)

    if (length < 0.00001) {
      return
    }

    const px = (-dy / length) * width * 0.5
    const py = (dx / length) * width * 0.5
    const a: Point = [start[0] + px, start[1] + py]
    const b: Point = [start[0] - px, start[1] - py]
    const c: Point = [end[0] + px, end[1] + py]
    const d: Point = [end[0] - px, end[1] - py]

    this.solidVertex(a, color)
    this.solidVertex(b, color)
    this.solidVertex(c, color)
    this.solidVertex(c, color)
    this.solidVertex(b, color)
    this.solidVertex(d, color)
  }

  polyline(points: Point[], closed: boolean, width: number, color: Color, glow = 0): void {
    const limit = closed ? points.length : points.length - 1

    for (let index = 0; index < limit; index += 1) {
      const start = points[index]
      const end = points[(index + 1) % points.length]

      if (glow > 0) {
        this.glowLine(start, end, width, color, glow)
      } else {
        this.line(start, end, width, color)
      }
    }
  }

  arc(
    radius: number,
    startAngle: number,
    endAngle: number,
    width: number,
    color: Color,
    segments = 96,
    glow = 0,
  ): void {
    const points: Point[] = []

    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments
      points.push(polar(radius, lerp(startAngle, endAngle, t)))
    }

    this.polyline(points, false, width, color, glow)
  }

  dashedArc(
    radius: number,
    dashCount: number,
    duty: number,
    width: number,
    color: Color,
    offset = 0,
    glow = 0,
  ): void {
    for (let index = 0; index < dashCount; index += 1) {
      const start = offset + (index / dashCount) * TAU
      const end = start + (TAU / dashCount) * duty
      this.arc(radius, start, end, width, color, 5, glow)
    }
  }

  polygon(sides: number, radius: number, rotation: number, width: number, color: Color, glow = 0): Point[] {
    const points = regularPolygon(sides, radius, rotation)
    this.polyline(points, true, width, color, glow)
    return points
  }

  sprite(center: Point, radius: number, color: Color, kind = 1): void {
    const corners: Point[] = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]

    for (const local of corners) {
      this.push([center[0] + local[0] * radius, center[1] + local[1] * radius], local, color, kind)
    }
  }

  ring(center: Point, radius: number, width: number, color: Color, segments = 72, glow = 0): void {
    const points: Point[] = []

    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * TAU
      points.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius])
    }

    this.polyline(points, true, width, color, glow)
  }

  plus(center: Point, radius: number, color: Color, width = 0.0012): void {
    this.line([center[0] - radius, center[1]], [center[0] + radius, center[1]], width, color)
    this.line([center[0], center[1] - radius], [center[0], center[1] + radius], width, color)
  }

  private solidVertex(point: Point, color: Color): void {
    this.push(point, [0, 0], color, 0)
  }

  private push(point: Point, local: Point, color: Color, kind: number): void {
    this.data.push(
      point[0],
      point[1],
      local[0],
      local[1],
      color[0],
      color[1],
      color[2],
      color[3],
      kind,
    )
  }
}

function addOuterRings(builder: GeometryBuilder): void {
  builder.arc(0.973, 0, TAU, 0.0011, fade(cyan, 0.58), 288, 0.8)
  builder.arc(0.951, 0, TAU, 0.001, fade(cyan, 0.36), 276)
  builder.arc(0.939, 0, TAU, 0.0011, fade(deepCyan, 0.86), 240)
  builder.dashedArc(0.913, 192, 0.42, 0.0013, fade(cyan, 0.68), 0.01)
  builder.dashedArc(0.876, 128, 0.55, 0.0015, fade(blue, 0.62), Math.PI / 128)
  builder.dashedArc(0.836, 96, 0.34, 0.0011, fade(violet, 0.54), Math.PI / 54)
  builder.arc(0.798, 0, TAU, 0.00095, fade(cyan, 0.36), 216)
  builder.arc(0.735, 0, TAU, 0.0009, fade(amber, 0.3), 216)

  for (let index = 0; index < 360; index += 1) {
    const angle = (index / 360) * TAU
    const isMajor = index % 30 === 0
    const isMinor = index % 6 === 0
    const radius = isMajor ? 0.981 : isMinor ? 0.968 : 0.954
    const length = isMajor ? 0.016 : isMinor ? 0.009 : 0.004
    const color = isMajor ? fade(cyan, 0.92) : fade(cyan, 0.46)
    const start = polar(radius - length, angle)
    const end = polar(radius, angle)

    if (isMinor || index % 2 === 0) {
      builder.line(start, end, isMajor ? 0.0016 : 0.0009, color)
    }
  }
}

function addMainFrame(builder: GeometryBuilder): void {
  const outerHex = builder.polygon(6, 0.812, -Math.PI / 2, 0.0052, fade(electric, 1), 1.48)
  builder.polygon(6, 0.782, -Math.PI / 2, 0.0016, fade(white, 0.78), 0.46)
  builder.polygon(6, 0.69, Math.PI / 6, 0.001, fade(white, 0.58), 0.15)
  builder.polygon(4, 0.694, Math.PI / 4, 0.00125, fade(white, 0.52), 0.1)
  builder.polygon(4, 0.622, Math.PI / 4, 0.001, fade(cyan, 0.34))

  for (let index = 0; index < outerHex.length; index += 1) {
    const point = outerHex[index]
    const angle = -Math.PI / 2 + (index / 6) * TAU
    const outward = polar(0.078, angle)

    builder.sprite(point, 0.04, fade(violet, 0.74), 2)
    builder.sprite(point, 0.017, fade(white, 1), 2)
    builder.ring(point, 0.031, 0.0012, fade(amber, 0.8), 44, 0.3)
    builder.ring(point, 0.052, 0.001, fade(cyan, 0.48), 56)
    builder.ring(point, 0.075, 0.0008, fade(blue, 0.32), 64)
    builder.glowLine(point, [point[0] + outward[0], point[1] + outward[1]], 0.0024, fade(electric, 0.58), 1.2)
  }

  const cardinal = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]
  for (const angle of cardinal) {
    const inner = polar(0.282, angle)
    const outer = polar(0.92, angle)
    builder.glowLine(inner, outer, 0.0019, fade(cyan, 0.54), 0.9)
    builder.sprite(outer, 0.029, fade(blue, 0.88), 2)
    builder.ring(outer, 0.039, 0.0012, fade(cyan, 0.72), 48, 0.2)
    builder.ring(outer, 0.064, 0.0008, fade(cyan, 0.4), 56)
  }

  builder.sprite([0, 0], 0.062, fade(violet, 1), 2)
  builder.sprite([0, 0], 0.024, [1, 0.92, 1, 1], 2)
}

function addInnerLattice(builder: GeometryBuilder): void {
  const rings = [0.215, 0.334, 0.456, 0.575]
  const ringPoints: Point[][] = []

  for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
    const radius = rings[ringIndex]
    const rotation = ringIndex % 2 === 0 ? -Math.PI / 2 : Math.PI / 6
    const points = builder.polygon(6, radius, rotation, 0.0016, fade(ringIndex % 2 ? amber : cyan, 0.62), 0.25)
    ringPoints.push(points)
  }

  builder.polygon(6, 0.278, Math.PI / 6, 0.0024, fade(electric, 0.9), 0.72)
  builder.polygon(6, 0.392, -Math.PI / 2, 0.0016, fade(white, 0.68), 0.24)
  builder.polygon(4, 0.39, Math.PI / 4, 0.0015, fade(violet, 0.68), 0.4)
  builder.polygon(3, 0.512, -Math.PI / 2, 0.001, fade(white, 0.42))
  builder.polygon(3, 0.512, Math.PI / 2, 0.001, fade(white, 0.42))

  for (let layer = 0; layer < ringPoints.length - 1; layer += 1) {
    for (let index = 0; index < 6; index += 1) {
      const current = ringPoints[layer][index]
      const next = ringPoints[layer + 1][index]
      const skew = ringPoints[layer + 1][(index + 1) % 6]
      builder.line(current, next, 0.0011, fade(white, 0.45))
      builder.glowLine(current, skew, 0.0015, fade(layer % 2 ? violet : blue, 0.58), 0.52)
    }
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * TAU
    const start = polar(0.092, angle)
    const end = polar(index % 2 === 0 ? 0.605 : 0.528, angle)
    builder.line(start, end, 0.0009, fade(cyan, 0.32))
  }

  const nodeRadii = [0.215, 0.334, 0.456, 0.575, 0.704]
  for (const radius of nodeRadii) {
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + (index / 6) * TAU
      const color = index % 2 === 0 ? electric : amber
      const point = polar(radius, angle)
      builder.sprite(point, radius > 0.5 ? 0.023 : 0.017, fade(color, 0.78), 2)
      builder.sprite(point, 0.0065, fade(white, 0.9), 1)
    }
  }
}

function addPrecisionMesh(builder: GeometryBuilder): void {
  const radii = [0.145, 0.255, 0.365, 0.475, 0.585, 0.695, 0.785]
  const rings: Point[][] = []

  for (let layer = 0; layer < radii.length; layer += 1) {
    const radius = radii[layer]
    const points = regularPolygon(12, radius, -Math.PI / 2)
    rings.push(points)

    builder.polyline(points, true, 0.00085, fade(layer % 2 === 0 ? cyan : white, layer < 3 ? 0.48 : 0.36))

    if (layer > 0 && layer < radii.length - 1) {
      builder.dashedArc(radius + 0.026, 72, layer % 2 === 0 ? 0.26 : 0.38, 0.00085, fade(cyan, 0.36), layer * 0.031)
      builder.dashedArc(radius - 0.021, 60, 0.32, 0.0008, fade(violet, 0.28), layer * 0.047)
    }
  }

  for (let layer = 0; layer < rings.length - 1; layer += 1) {
    for (let index = 0; index < 12; index += 1) {
      const current = rings[layer][index]
      const next = rings[layer + 1][index]
      const clockwise = rings[layer + 1][(index + 1) % 12]
      const counter = rings[layer + 1][(index + 11) % 12]

      builder.line(current, next, 0.00085, fade(white, 0.32))

      if ((index + layer) % 2 === 0) {
        builder.line(current, clockwise, 0.0009, fade(cyan, 0.38))
      }

      if ((index + layer) % 3 === 0) {
        builder.line(current, counter, 0.00085, fade(violet, 0.32))
      }
    }
  }

  for (let index = 0; index < 24; index += 1) {
    const angle = -Math.PI / 2 + (index / 24) * TAU
    const color = index % 4 === 0 ? amber : index % 3 === 0 ? violet : cyan
    builder.line(polar(0.105, angle), polar(0.826, angle), 0.00078, fade(color, index % 2 === 0 ? 0.34 : 0.22))
  }

  for (let index = 0; index < 12; index += 1) {
    const angle = -Math.PI / 2 + (index / 12) * TAU
    const outer = polar(0.742, angle)
    const inner = polar(0.265, angle + Math.PI / 12)
    const oppositeInner = polar(0.265, angle - Math.PI / 12)
    builder.glowLine(inner, outer, 0.00115, fade(index % 2 === 0 ? electric : violet, 0.48), 0.56)
    builder.line(oppositeInner, outer, 0.00095, fade(white, 0.35))

    if (index % 2 === 0) {
      builder.sprite(outer, 0.012, fade(electric, 0.58), 2)
    }
  }
}

function addOrbitalMachinery(builder: GeometryBuilder): void {
  for (let sector = 0; sector < 6; sector += 1) {
    const angle = -Math.PI / 2 + (sector / 6) * TAU
    const sideAngle = angle + Math.PI / 6
    const color = sector % 2 === 0 ? cyan : violet

    builder.arc(0.642, angle - 0.36, angle + 0.36, 0.001, fade(color, 0.38), 42)
    builder.arc(0.71, angle - 0.28, angle + 0.28, 0.0011, fade(amber, 0.38), 36)
    builder.dashedArc(0.602, 16, 0.48, 0.0009, fade(color, 0.22), sideAngle)

    const orbitCenter = polar(0.64, sideAngle)
    builder.ring(orbitCenter, 0.053, 0.0009, fade(cyan, 0.44), 48)
    builder.ring(orbitCenter, 0.028, 0.0009, fade(white, 0.5), 36)
    builder.sprite(orbitCenter, 0.011, fade(violet, 0.58), 1)

    const outer = polar(0.748, sideAngle)
    const inner = polar(0.355, sideAngle)
    builder.glowLine(inner, outer, 0.0014, fade(blue, 0.34), 0.6)
    builder.sprite(outer, 0.018, fade(amber, 0.66), 2)
  }

  for (let pair = 0; pair < 3; pair += 1) {
    const angle = Math.PI / 6 + (pair / 3) * TAU
    const a = polar(0.735, angle)
    const b = polar(0.735, angle + Math.PI)
    builder.line(a, b, 0.0009, fade(white, 0.23))
  }
}

function addPanelCircuits(builder: GeometryBuilder): void {
  for (let sector = 0; sector < 6; sector += 1) {
    const vertexAngle = -Math.PI / 2 + (sector / 6) * TAU
    const midAngle = vertexAngle + Math.PI / 6
    const center = polar(0.575, midAngle)
    const tangent = midAngle + Math.PI / 2
    const accent = sector % 2 === 0 ? cyan : violet

    builder.ring(center, 0.092, 0.00115, fade(cyan, 0.48), 72, 0.16)
    builder.ring(center, 0.061, 0.001, fade(white, 0.48), 52)
    builder.ring(center, 0.032, 0.001, fade(violet, 0.52), 36)
    builder.sprite(center, 0.013, fade(accent, 0.72), 2)

    const axisA: Point = [center[0] + Math.cos(midAngle) * 0.106, center[1] + Math.sin(midAngle) * 0.106]
    const axisB: Point = [center[0] - Math.cos(midAngle) * 0.106, center[1] - Math.sin(midAngle) * 0.106]
    const crossA: Point = [center[0] + Math.cos(tangent) * 0.074, center[1] + Math.sin(tangent) * 0.074]
    const crossB: Point = [center[0] - Math.cos(tangent) * 0.074, center[1] - Math.sin(tangent) * 0.074]
    builder.line(axisA, axisB, 0.00095, fade(white, 0.38))
    builder.glowLine(crossA, crossB, 0.00115, fade(accent, 0.42), 0.46)

    const innerA = polar(0.405, vertexAngle)
    const innerB = polar(0.405, vertexAngle + Math.PI / 3)
    builder.line(innerA, center, 0.0009, fade(cyan, 0.36))
    builder.line(innerB, center, 0.0009, fade(cyan, 0.36))
    builder.glowLine(center, polar(0.73, midAngle), 0.0012, fade(blue, 0.36), 0.45)

    for (let index = -2; index <= 2; index += 1) {
      const beadAngle = midAngle + index * 0.29
      const bead = [center[0] + Math.cos(beadAngle) * 0.092, center[1] + Math.sin(beadAngle) * 0.092] as Point
      builder.sprite(bead, index === 0 ? 0.007 : 0.0045, fade(index === 0 ? amber : white, 0.58), 1)
    }
  }

  for (let sector = 0; sector < 6; sector += 1) {
    const angle = -Math.PI / 2 + (sector / 6) * TAU
    const left = polar(0.48, angle - Math.PI / 12)
    const right = polar(0.48, angle + Math.PI / 12)
    const outerLeft = polar(0.76, angle - Math.PI / 10)
    const outerRight = polar(0.76, angle + Math.PI / 10)
    builder.line(left, outerRight, 0.0008, fade(white, 0.28))
    builder.line(right, outerLeft, 0.0008, fade(blue, 0.3))
  }
}

function addRadialGlyphs(builder: GeometryBuilder): void {
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * TAU
    const radius = index % 2 === 0 ? 0.857 : 0.765
    const center = polar(radius, angle)
    const color = index % 3 === 0 ? amber : index % 3 === 1 ? cyan : white

    builder.ring(center, index % 2 === 0 ? 0.012 : 0.009, 0.0011, fade(color, 0.72), 20)

    if (index % 4 === 0) {
      builder.plus(center, 0.017, fade(color, 0.72), 0.001)
    } else {
      builder.sprite(center, 0.006, fade(color, 0.62), 1)
    }
  }

  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * TAU
    const first = polar(0.482 + 0.018 * Math.sin(index * 1.7), angle)
    const second = polar(0.528 + 0.012 * Math.cos(index * 1.13), angle + 0.02)
    builder.line(first, second, 0.00075, fade(index % 5 === 0 ? amber : cyan, 0.24))
  }
}

function addStarField(builder: GeometryBuilder): void {
  const random = seededRandom(2047)

  for (let index = 0; index < 240; index += 1) {
    const angle = random() * (TAU / 6)
    const radius = Math.sqrt(random()) * 0.93
    const baseSize = 0.0022 + random() * 0.005
    const color = random() > 0.74 ? amber : random() > 0.5 ? cyan : blue

    for (let sector = 0; sector < 6; sector += 1) {
      const rotated = angle + (sector / 6) * TAU
      const center = polar(radius, rotated)

      if (random() > 0.52) {
        builder.sprite(center, baseSize, fade(color, 0.42 + random() * 0.32), 1)
      } else {
        const tangent = rotated + Math.PI / 2
        const half = baseSize * (1.8 + random() * 3)
        builder.line(
          [center[0] + Math.cos(tangent) * half, center[1] + Math.sin(tangent) * half],
          [center[0] - Math.cos(tangent) * half, center[1] - Math.sin(tangent) * half],
          0.00095,
          fade(color, 0.34),
        )
      }
    }
  }

  for (let index = 0; index < 18; index += 1) {
    const angle = (index / 18) * TAU
    const center = polar(0.884 + 0.027 * Math.sin(index * 2.1), angle)
    builder.plus(center, 0.013, fade(index % 2 === 0 ? amber : cyan, 0.54), 0.0009)
  }
}

function regularPolygon(sides: number, radius: number, rotation: number): Point[] {
  const points: Point[] = []

  for (let index = 0; index < sides; index += 1) {
    points.push(polar(radius, rotation + (index / sides) * TAU))
  }

  return points
}

function polar(radius: number, angle: number): Point {
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
}

function fade(color: Color, amount: number): Color {
  return [color[0], color[1], color[2], color[3] * amount]
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
