export const HISTORY_ROWS = 240;

export const spectrumShader = (size: number) => /* wgsl */ `
  @group(0) @binding(0) var<storage, read> levels: array<f32>;
  @group(0) @binding(1) var<storage, read> history: array<f32>;
  struct Display {
    markerX: f32, floorDb: f32, rangeDb: f32, guideGap: f32,
    nextRow: u32, rowCount: u32, _padding2: vec2u,
    cold: vec4f, mid: vec4f, hot: vec4f, peak: vec4f, trace: vec4f, marker: vec4f,
  }
  @group(0) @binding(2) var<uniform> display: Display;
  struct FullscreenOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f }
  @vertex fn fullscreenVertex(@builtin(vertex_index) index: u32) -> FullscreenOutput {
    let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    let p = positions[index];
    var output: FullscreenOutput;
    output.position = vec4f(p, 0.0, 1.0);
    output.uv = vec2f((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
    return output;
  }
  fn colorMap(value: f32) -> vec3f {
    let t = clamp(value, 0.0, 1.0);
    let cold = display.cold.rgb;
    let violet = display.mid.rgb;
    let electric = display.hot.rgb;
    let stellar = display.peak.rgb;
    return select(mix(cold, violet, t * 2.0), select(mix(violet, electric, (t - 0.5) * 3.0), mix(electric, stellar, (t - 0.83) * 5.88), t > 0.83), t > 0.5);
  }
  @fragment fn waterfallFragment(input: FullscreenOutput) -> @location(0) vec4f {
    let waterfallStart = 0.38 + display.guideGap;
    if (input.uv.y < waterfallStart || display.rowCount == 0u) { discard; }
    let relativeY = clamp((input.uv.y - waterfallStart) / (1.0 - waterfallStart), 0.0, 0.999999);
    let age = min(u32(relativeY * f32(display.rowCount)), display.rowCount - 1u);
    let row = (display.nextRow + ${HISTORY_ROWS}u - 1u - age) % ${HISTORY_ROWS}u;
    let bin = min(u32(clamp(input.uv.x, 0.0, 0.999999) * f32(${size})), ${size - 1}u);
    let level = history[row * ${size}u + bin];
    if (level < -1000.0) { return vec4f(0.17, 0.19, 0.19, 1.0); }
    return vec4f(colorMap((level - display.floorDb) / display.rangeDb), 1.0);
  }
  @vertex fn spectrumVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let x = f32(index) / f32(${size - 1}) * 2.0 - 1.0;
    let normalized = clamp((levels[index] - display.floorDb) / display.rangeDb, 0.0, 1.0);
    return vec4f(x, 0.25 + normalized * 0.67, 0.0, 1.0);
  }
  @vertex fn markerVertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    return vec4f(display.markerX, select(-0.92, 0.92, index == 1u), 0.0, 1.0);
  }
  @fragment fn spectrumFragment() -> @location(0) vec4f { return display.trace; }
  @fragment fn markerFragment() -> @location(0) vec4f { return vec4f(display.marker.rgb, 0.96); }
`;
