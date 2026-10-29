// js/bitmap.js — bitmap / ordered-dither post-process pass for OPEN CITY (hometown)
// Default look: TINY / FINE (2px cells, 32 levels, light dither).
// Drop into js/, add as the LAST pass in the composer (after bloom / OutputPass).

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const BitmapShader = {
  name: 'BitmapShader',
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) }, // drawing-buffer size in device px
    uCell: { value: 2 },                      // cell size in device px
    uLevels: { value: 32 },                   // colour steps per channel
    uDither: { value: 0.6 },                  // 0 = flat posterize, 1 = full Bayer
    uHeat: { value: 0 },                      // 0..1 wanted-level tint
    uNight: { value: 0 },                     // 0..1 cool night shift
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uCell, uLevels, uDither, uHeat, uNight, uTime;
    varying vec2 vUv;

    float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
    float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

    void main() {
      // snap to the pixel grid, sample at cell centre
      vec2 cell = floor(vUv * uRes / uCell);
      vec2 uv = (cell + 0.5) * uCell / uRes;
      vec3 c = texture2D(tDiffuse, uv).rgb;

      // state tints
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      float flick = step(0.5, fract(uTime * 3.0));
      vec3 heatCol = mix(vec3(1.0, 0.1, 0.15), vec3(0.1, 0.25, 1.0), flick);
      c = mix(c, c * 0.6 + heatCol * l * 0.7, uHeat * 0.6);
      c = mix(c, c * vec3(0.8, 0.9, 1.15), uNight * 0.5);

      // ordered dither + quantize
      float steps = max(uLevels - 1.0, 1.0);
      float d = bayer8(cell) - 0.5;
      c += d * uDither / steps;
      c = floor(c * steps + 0.5) / steps;

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

export const BITMAP_PRESETS = {
  tiny:  { basePixel: 2, maxPixel: 5,  levels: 32, dither: 0.6 }, // DEFAULT
  fine:  { basePixel: 3, maxPixel: 6,  levels: 24, dither: 0.7 },
  chunky:{ basePixel: 4, maxPixel: 8,  levels: 12, dither: 0.9 },
  raw:   { basePixel: 6, maxPixel: 12, levels: 6,  dither: 1.0 },
};
const PRESET_ORDER = ['tiny', 'fine', 'chunky', 'raw'];

export class BitmapPass extends ShaderPass {
  /**
   * @param {object} [opts]
   * @param {string} [opts.preset='tiny']
   * @param {number} [opts.pixelRatio=1]  pass renderer.getPixelRatio()
   * @param {boolean} [opts.speedReactive=true]  cells grow with player speed
   * @param {number} [opts.speedMax=55]  speed (m/s) at which cells hit maxPixel (~200 km/h)
   */
  constructor(opts = {}) {
    super(BitmapShader);
    this.presetName = opts.preset in BITMAP_PRESETS ? opts.preset : 'tiny';
    this.pixelRatio = opts.pixelRatio ?? 1;
    this.speedReactive = opts.speedReactive ?? true;
    this.speedMax = opts.speedMax ?? 55;
    this._applyPreset();
  }

  _applyPreset() {
    const p = BITMAP_PRESETS[this.presetName];
    this.basePixel = p.basePixel;
    this.maxPixel = p.maxPixel;
    this.uniforms.uLevels.value = p.levels;
    this.uniforms.uDither.value = p.dither;
    this.uniforms.uCell.value = p.basePixel * this.pixelRatio;
  }

  setPreset(name) {
    if (!(name in BITMAP_PRESETS)) return;
    this.presetName = name;
    this._applyPreset();
  }

  cyclePreset() {
    const i = PRESET_ORDER.indexOf(this.presetName);
    this.setPreset(PRESET_ORDER[(i + 1) % PRESET_ORDER.length]);
    return this.presetName;
  }

  setPixelRatio(r) {
    this.pixelRatio = r;
    this._applyPreset();
  }

  // EffectComposer calls this with drawing-buffer size
  setSize(w, h) {
    this.uniforms.uRes.value.set(w, h);
  }

  /**
   * Call once per frame, BEFORE composer.render().
   * @param {number} dt seconds
   * @param {{speed?:number, heat?:number, night?:number}} state
   *   speed: player/vehicle speed m/s · heat: wanted level 0..1 · night: 0..1
   */
  update(dt, { speed = 0, heat = 0, night = 0 } = {}) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uHeat.value += (heat - u.uHeat.value) * Math.min(1, dt * 4);
    u.uNight.value += (night - u.uNight.value) * Math.min(1, dt * 2);

    let px = this.basePixel;
    if (this.speedReactive) {
      const t = Math.min(1, Math.max(0, speed / this.speedMax));
      px = this.basePixel + (this.maxPixel - this.basePixel) * t * t; // eased
    }
    // whole device pixels only, so cells never shimmer
    u.uCell.value = Math.max(1, Math.round(px * this.pixelRatio));
  }
}

/** F8 = toggle bitmap look · F9 = cycle preset (B and N are taken by plane-bail / horn). */
export function installBitmapHotkeys(pass, onChange) {
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'F8') { e.preventDefault(); pass.enabled = !pass.enabled; onChange?.(pass); }
    else if (e.code === 'F9' && pass.enabled) { e.preventDefault(); pass.cyclePreset(); onChange?.(pass); }
  });
}
