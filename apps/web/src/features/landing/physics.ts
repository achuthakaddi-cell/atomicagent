/**
 * Spring physics.
 *
 * Every animated value on this page runs through a spring simulator rather
 * than a CSS transition. The difference is momentum: a spring carries velocity,
 * so it overshoots its target and settles, and if the target changes mid-flight
 * it blends rather than snapping.
 *
 * That is the whole of what "weight" means in interface animation. A curve
 * arrives; a spring lands.
 *
 * THE MODEL
 * ---------
 * A damped harmonic oscillator, integrated per frame:
 *
 *   force        = -stiffness * (position - target)
 *   damping      = -damping * velocity
 *   acceleration = (force + damping) / mass
 *
 * Higher stiffness pulls harder. Higher damping resists motion. Higher mass
 * makes both slower to take effect.
 */

/** Tunable spring characteristics. */
export interface SpringConfig {
    stiffness: number;
    damping: number;
    mass: number;
    /** Below this distance and velocity, the spring is considered at rest. */
    precision?: number;
  }
  
  /** Presets, named for how they feel rather than their numbers. */
  export const SPRING = {
    /** Snaps into place with a small overshoot. For anything that locks. */
    snap: { stiffness: 320, damping: 22, mass: 1 },
    /** Heavy and deliberate. For large elements that should feel substantial. */
    heavy: { stiffness: 140, damping: 20, mass: 2.4 },
    /** Loose and bouncy. Obvious overshoot. Use sparingly. */
    bouncy: { stiffness: 260, damping: 12, mass: 1 },
    /** Smooth with no visible overshoot. For values that must not distract. */
    glide: { stiffness: 180, damping: 26, mass: 1 },
    /** Very fast, minimal wobble. For cursor-following and similar. */
    quick: { stiffness: 500, damping: 34, mass: 0.7 },
  } as const satisfies Record<string, SpringConfig>;
  
  /** One spring, holding its own position and velocity. */
  export class Spring {
    private position: number;
    private velocity = 0;
    private target: number;
    private readonly config: Required<SpringConfig>;
  
    /**
     * @param initial - starting position
     * @param config - spring characteristics
     */
    constructor(initial = 0, config: SpringConfig = SPRING.glide) {
      this.position = initial;
      this.target = initial;
      this.config = {
        stiffness: config.stiffness,
        damping: config.damping,
        mass: config.mass,
        precision: config.precision ?? 0.001,
      };
    }
  
    /**
     * Sets where the spring is heading.
     *
     * Velocity is deliberately preserved. A spring redirected mid-flight should
     * carry its momentum into the new target, which is what makes rapid input
     * feel fluid rather than stuttery.
     *
     * @param value - the new target
     */
    setTarget(value: number): void {
      this.target = value;
    }
  
    /**
     * Jumps to a position immediately, killing all motion.
     *
     * @param value - the position to jump to
     */
    jump(value: number): void {
      this.position = value;
      this.target = value;
      this.velocity = 0;
    }
  
    /**
     * Advances the simulation.
     *
     * The timestep is clamped. If a tab is backgrounded and then restored, the
     * elapsed time can be seconds, and integrating that in one step throws the
     * spring across the screen.
     *
     * @param deltaMs - milliseconds since the last step
     * @returns the current position
     */
    step(deltaMs: number): number {
      const dt = Math.min(deltaMs, 32) / 1000;
  
      const displacement = this.position - this.target;
      const springForce = -this.config.stiffness * displacement;
      const dampingForce = -this.config.damping * this.velocity;
      const acceleration = (springForce + dampingForce) / this.config.mass;
  
      this.velocity += acceleration * dt;
      this.position += this.velocity * dt;
  
      // Snap to rest once both displacement and velocity are negligible.
      // Without this the spring oscillates at imperceptible amplitude forever,
      // keeping the render loop busy for no visible benefit.
      if (
        Math.abs(this.position - this.target) < this.config.precision &&
        Math.abs(this.velocity) < this.config.precision
      ) {
        this.position = this.target;
        this.velocity = 0;
      }
  
      return this.position;
    }
  
    /**
     * Current position, without advancing.
     *
     * @returns the position
     */
    get value(): number {
      return this.position;
    }
  
    /**
     * Current velocity. Useful for deriving effects from motion, such as
     * stretching an element in the direction it is travelling.
     *
     * @returns the velocity
     */
    get speed(): number {
      return this.velocity;
    }
  
    /**
     * Whether the spring has settled.
     *
     * @returns true if at rest
     */
    get isResting(): boolean {
      return this.velocity === 0 && this.position === this.target;
    }
  }
  
  /**
   * A group of springs sharing one configuration.
   *
   * Used where many elements animate together — a row of cards, a set of
   * characters — so they can be stepped in a single pass.
   */
  export class SpringGroup {
    private readonly springs: Spring[];
  
    /**
     * @param count - how many springs
     * @param initial - starting position for all of them
     * @param config - shared spring characteristics
     */
    constructor(count: number, initial = 0, config: SpringConfig = SPRING.glide) {
      this.springs = Array.from({ length: count }, () => new Spring(initial, config));
    }
  
    /**
     * Sets every target at once, with an optional stagger applied by the caller.
     *
     * @param targets - one target per spring
     */
    setTargets(targets: number[]): void {
      for (let i = 0; i < this.springs.length; i += 1) {
        const spring = this.springs[i];
        const target = targets[i];
        if (spring && target !== undefined) spring.setTarget(target);
      }
    }
  
    /**
     * Sets a single spring's target.
     *
     * @param index - which spring
     * @param target - the new target
     */
    setTarget(index: number, target: number): void {
      this.springs[index]?.setTarget(target);
    }
  
    /**
     * Advances every spring.
     *
     * @param deltaMs - milliseconds since the last step
     * @returns current positions
     */
    step(deltaMs: number): number[] {
      return this.springs.map((spring) => spring.step(deltaMs));
    }
  
    /**
     * Current positions, without advancing.
     *
     * @returns the positions
     */
    get values(): number[] {
      return this.springs.map((spring) => spring.value);
    }
  
    /**
     * Whether every spring has settled.
     *
     * @returns true if all are at rest
     */
    get allResting(): boolean {
      return this.springs.every((spring) => spring.isResting);
    }
  }