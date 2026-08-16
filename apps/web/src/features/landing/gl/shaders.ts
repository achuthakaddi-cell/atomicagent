/**
 * GLSL for the background field.
 *
 * A fullscreen quad rendered with an orthographic camera. There is no geometry
 * to speak of — everything visible is computed per-pixel in the fragment
 * shader, which is why it can be this dense without costing frames.
 *
 * WHAT IT DRAWS
 * -------------
 * Layered simplex noise, domain-warped so the field folds into itself rather
 * than looking like uniform static. Contour lines are extracted from the noise
 * to read as a topographic survey — a blueprint of terrain — which suits a page
 * about verification and settlement better than generic crypto glow.
 *
 * WHAT DRIVES IT
 * --------------
 *   uTime      continuous drift, so nothing is ever static
 *   uScroll    page progress, shifts colour from cold blue to brass
 *   uVelocity  scroll speed, stretches and smears the field
 *   uMouse     cursor position, pulls the domain warp toward it
 *   uSettle    binding intensity, brightens and tightens the contours
 *
 * PERFORMANCE
 * -----------
 * Three octaves of noise, not five. On an integrated GPU driving a projector
 * the difference between three and five octaves is the difference between 60fps
 * and 40, and nobody can see the extra detail from the back of a room.
 */

export const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

export const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform float uScroll;
  uniform float uVelocity;
  uniform float uSettle;
  uniform vec2  uMouse;
  uniform vec2  uResolution;

  // Palette, matching the design tokens exactly.
  const vec3 VOID      = vec3(0.027, 0.043, 0.063);
  const vec3 BLUEPRINT = vec3(0.051, 0.098, 0.149);
  const vec3 PENDING   = vec3(0.290, 0.498, 0.710);
  const vec3 VERIFY    = vec3(0.208, 0.839, 0.643);
  const vec3 BRASS     = vec3(0.910, 0.722, 0.294);

  /**
   * 2D hash. Cheap pseudo-random from a coordinate.
   */
  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  /**
   * Simplex-style gradient noise. Smoother than value noise and cheaper than
   * true simplex, which matters when it runs on every pixel every frame.
   */
  float noise(vec2 p) {
    const float K1 = 0.366025404;
    const float K2 = 0.211324865;

    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    float m = step(a.y, a.x);
    vec2 o = vec2(m, 1.0 - m);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;

    vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
    vec3 n = h * h * h * h * vec3(
      dot(a, hash2(i)),
      dot(b, hash2(i + o)),
      dot(c, hash2(i + 1.0))
    );

    return dot(n, vec3(70.0));
  }

  /**
   * Fractal noise. Three octaves is the performance ceiling we chose.
   */
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;

    for (int i = 0; i < 3; i++) {
      value += amplitude * noise(p);
      p *= 2.02;
      amplitude *= 0.5;
    }

    return value;
  }

  void main() {
    // Correct for aspect ratio, so the field is not stretched on wide screens.
    vec2 uv = vUv;
    vec2 p = (uv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);

    float t = uTime * 0.055;

    // ---- domain warp ----
    //
    // Feeding noise back into its own coordinates is what makes the field fold
    // and curl instead of drifting uniformly. This is the single line that
    // separates "moving background" from "living surface".
    vec2 warp = vec2(
      fbm(p * 1.6 + vec2(t, t * 0.7)),
      fbm(p * 1.6 + vec2(t * 0.8 + 5.2, t * 1.1 + 1.3))
    );

    // Cursor pulls the warp toward itself.
    vec2 toMouse = p - (uMouse - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float mouseDist = length(toMouse);
    float mousePull = exp(-mouseDist * 2.4) * 0.55;
    warp += normalize(toMouse + 0.0001) * mousePull;

    // Scroll velocity smears the field vertically, so fast scrolling feels fast.
    warp.y += uVelocity * 0.9;

    float field = fbm(p * 2.3 + warp * 1.5 + vec2(0.0, uScroll * 1.4));

    // ---- contour lines ----
    //
    // Extracting bands from the noise reads as a topographic survey rather than
    // a smear. Density tightens as settlement approaches.
    float density = mix(11.0, 22.0, uSettle);
    float bands = abs(fract(field * density) - 0.5) * 2.0;
    float lines = 1.0 - smoothstep(0.0, 0.09, bands);

    // ---- colour ----
    //
    // One palette throughout: deep blueprint blue, brightening slightly as the
    // reader descends. An earlier version warmed toward brass near settlement,
    // which broke the page into two visual halves. Brass is reserved for
    // settlement itself, so the background must not compete with it.
    vec3 deep = mix(BLUEPRINT, PENDING, 0.35);
    vec3 bright = mix(BLUEPRINT, PENDING, 0.75);
    vec3 tint = mix(deep, bright, smoothstep(0.0, 1.0, uScroll));

    // Settlement lifts the field's intensity without changing its hue.
    tint = mix(tint, PENDING, uSettle * 0.35);

    vec3 colour = VOID;
    colour += tint * lines * (0.16 + uSettle * 0.5);

    // Broad glow between the lines, so the field has depth rather than being
    // wireframe on black.
    colour += tint * smoothstep(-0.4, 0.9, field) * 0.05;

    // Cursor halo.
    colour += tint * mousePull * 0.5;

    // Vignette. Keeps attention centred and hides tiling at the edges.
    float vignette = 1.0 - smoothstep(0.35, 1.15, length(uv - 0.5) * 1.7);
    colour *= vignette;

    gl_FragColor = vec4(colour, 1.0);
  }
`;