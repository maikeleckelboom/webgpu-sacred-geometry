
struct Scene {
  viewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirection: vec4f,
  viewport: vec4f,
  params: vec4f,
  pointer: vec4f,
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) material: f32,
  @location(3) shade: f32,
  @location(4) focus: f32,
  @location(5) seed: f32,
}

@group(0) @binding(0) var<uniform> scene: Scene;

@vertex
fn vertexMain(
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) material: f32,
  @location(3) shade: f32,
  @location(4) focus: f32,
  @location(5) seed: f32,
) -> VertexOut {
  var out: VertexOut;
  out.world = position;
  out.normal = normalize(normal);
  out.material = material;
  out.shade = shade;
  out.focus = focus;
  out.seed = seed;
  out.position = scene.viewProjection * vec4f(position, 1.0);
  return out;
}

fn hash21(point: vec2f) -> f32 {
  return fract(sin(dot(point, vec2f(127.1, 311.7))) * 43758.5453123);
}

@fragment
fn fragmentMain(input: VertexOut) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  let view = normalize(scene.cameraPosition.xyz - input.world);
  let light = normalize(scene.lightDirection.xyz);
  let halfVector = normalize(light + view);
  let diffuse = clamp(dot(normal, light), 0.0, 1.0);
  let softFill = clamp(dot(normal, normalize(vec3f(0.5, 0.3, 0.7))) * 0.5 + 0.5, 0.0, 1.0);
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  let side = step(0.5, input.material) * (1.0 - step(1.5, input.material));
  let floor = step(1.5, input.material);
  let top = 1.0 - side - floor;

  let heightTone = pow(clamp(input.shade, 0.0, 1.0), 0.7);
  let topBase = mix(vec3f(0.34, 0.34, 0.32), vec3f(0.82, 0.82, 0.78), heightTone);
  let sideBase = mix(vec3f(0.006, 0.006, 0.007), vec3f(0.07, 0.07, 0.066), heightTone);
  let floorBase = vec3f(0.78, 0.78, 0.75);
  var color = topBase * top + sideBase * side + floorBase * floor;

  let sideOcclusion = side * (0.54 + (1.0 - facing) * 0.24);
  let shelfOcclusion = top * (1.0 - smoothstep(0.0, 0.28, input.shade)) * 0.2;
  color = color * (0.2 + diffuse * 0.78 + softFill * 0.1);
  color = color * (1.0 - sideOcclusion - shelfOcclusion);

  let specPower = mix(52.0, 140.0, top + heightTone * 0.45);
  let specular = pow(clamp(dot(normal, halfVector), 0.0, 1.0), specPower);
  let broadSpecular = pow(clamp(dot(reflect(-light, normal), view), 0.0, 1.0), 18.0);
  let rim = pow(1.0 - facing, 2.2) * (top * 0.18 + side * 0.38);
  let layerGlint = smoothstep(0.62, 1.0, input.shade) * top;
  color = color + vec3f(0.98, 0.98, 0.92) * specular * (0.62 + top * 1.24 + side * 1.2);
  color = color + vec3f(0.72, 0.72, 0.68) * broadSpecular * (top * 0.24 + side * 0.96);
  color = color + vec3f(0.5, 0.5, 0.48) * rim + vec3f(0.9, 0.9, 0.86) * layerGlint * specular * 0.42;

  let grain = hash21(input.world.xz * 83.0 + vec2f(input.seed, scene.params.x * 0.17));
  color = color * (0.965 + grain * 0.055);

  let distance = length(scene.cameraPosition.xyz - input.world);
  let fog = smoothstep(3.25, 5.8, distance);
  color = mix(color, vec3f(0.82, 0.82, 0.79), fog * 0.66);

  let focusDistance = scene.params.y + input.focus * 0.12;
  let blur = clamp(smoothstep(0.28, 1.22, abs(distance - focusDistance)) + fog * 0.2 + floor * 0.14, 0.0, 1.0);

  return vec4f(pow(clamp(color * scene.params.z, vec3f(0.0), vec3f(1.0)), vec3f(0.9)), blur);
}

