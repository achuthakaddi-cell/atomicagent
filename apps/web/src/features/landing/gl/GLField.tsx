/**
 * The WebGL background field.
 *
 * A single fullscreen quad rendered with three.js, fixed behind the entire
 * page. It runs continuously and reacts to scroll position, scroll velocity,
 * cursor position, and a settlement intensity value.
 *
 * WHY VANILLA THREE RATHER THAN REACT THREE FIBER
 * -----------------------------------------------
 * We render one quad with one shader. A scene-graph reconciler adds a
 * dependency and a render-loop abstraction for something that needs neither.
 * Driving the loop directly also lets us pause it when the tab is hidden.
 *
 * PERFORMANCE
 * -----------
 * Pixel ratio is capped at 2. Retina displays report 3, which triples the
 * fragment count for detail nobody can see — and this has to hold sixty frames
 * on a venue projector.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.js';

interface GLFieldProps {
  /** Page scroll progress, 0 to 1. */
  scroll: number;
  /** Scroll velocity, roughly -1 to 1. */
  velocity: number;
  /** Settlement intensity, 0 to 1. Brightens and tightens the field. */
  settle: number;
}

export function GLField({ scroll, velocity, settle }: GLFieldProps) {
  const holderRef = useRef<HTMLDivElement | null>(null);

  // Live values the render loop reads without re-running the effect.
  const scrollRef = useRef(scroll);
  const velocityRef = useRef(velocity);
  const settleRef = useRef(settle);

  useEffect(() => {
    scrollRef.current = scroll;
  }, [scroll]);

  useEffect(() => {
    velocityRef.current = velocity;
  }, [velocity]);

  useEffect(() => {
    settleRef.current = settle;
  }, [settle]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- renderer ----
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });

    // Capped at 2. A 3x retina display triples fragment work for no visible gain.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x070b10, 1);

    holder.appendChild(renderer.domElement);

    // ---- scene ----
    //
    // An orthographic camera with a plane sized in clip space means the vertex
    // shader can pass position straight through. No projection maths needed.
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const uniforms = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uVelocity: { value: 0 },
      uSettle: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uResolution: {
        value: new THREE.Vector2(window.innerWidth, window.innerHeight),
      },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    // ---- input ----
    const targetMouse = new THREE.Vector2(0.5, 0.5);

    const onPointer = (event: PointerEvent): void => {
      targetMouse.set(
        event.clientX / window.innerWidth,
        1 - event.clientY / window.innerHeight,
      );
    };

    const onResize = (): void => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', onResize);

    // ---- loop ----
    const clock = new THREE.Clock();
    let raf = 0;
    let running = true;

    // Smoothed values, so the field eases rather than snapping.
    let smoothVelocity = 0;
    let smoothSettle = 0;

    const frame = (): void => {
      if (!running) return;

      const elapsed = clock.getElapsedTime();

      uniforms.uTime.value = reduce ? 0 : elapsed;
      uniforms.uScroll.value = scrollRef.current;

      // Ease toward the target rather than jumping, so a sudden scroll does not
      // produce a visible jolt in the field.
      smoothVelocity += (velocityRef.current - smoothVelocity) * 0.08;
      smoothSettle += (settleRef.current - smoothSettle) * 0.06;

      uniforms.uVelocity.value = smoothVelocity;
      uniforms.uSettle.value = smoothSettle;

      uniforms.uMouse.value.x += (targetMouse.x - uniforms.uMouse.value.x) * 0.06;
      uniforms.uMouse.value.y += (targetMouse.y - uniforms.uMouse.value.y) * 0.06;

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };

    // Pause when the tab is hidden. A GPU shader running in a background tab
    // drains battery for nothing.
    const onVisibility = (): void => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);

      // Free GPU memory explicitly. Without this, hot reloading during
      // development leaks a renderer and its buffers on every save.
      quad.geometry.dispose();
      material.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === holder) {
        holder.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={holderRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden="true"
    />
  );
}