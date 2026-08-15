/**
 * A 3D camera flying through layered content.
 *
 * Children are placed at different z-depths inside a CSS perspective. As the
 * reader scrolls, the whole stage translates along z, which is mathematically
 * identical to moving a camera forward through stationary objects — and reads
 * exactly that way.
 *
 * WHY THIS FEELS DIFFERENT FROM PARALLAX
 * --------------------------------------
 * Parallax moves layers at different speeds on a flat plane. This is real
 * perspective projection: near objects grow enormous and rush past the edges of
 * the viewport, far objects approach slowly and stay small. The difference is
 * the same as sliding photographs versus walking down a corridor.
 *
 * WHY CSS 3D RATHER THAN WEBGL
 * ----------------------------
 * Text rendered in WebGL is either a texture, which goes blurry, or an SDF font
 * atlas, which is a project in itself. CSS 3D transforms keep text as real text
 * — selectable, accessible, crisp at any depth — and the browser composites it
 * on the GPU anyway.
 */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface DepthStageProps {
  /**
   * How many viewport heights of scroll the flight consumes. Longer means the
   * camera moves more slowly relative to the reader's scrolling.
   */
  length?: number;
  /** How far the camera travels along z, in pixels. */
  travel?: number;
  children: (progress: number) => ReactNode;
}

export function DepthStage({
  length = 5,
  travel = 4200,
  children,
}: DepthStageProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    let frame = 0;

    const update = (): void => {
      frame = 0;

      // Read layout first, write after. Interleaving forces a recalculation on
      // every frame, which is the classic cause of scroll jank.
      const rect = outer.getBoundingClientRect();
      const scrollable = rect.height - window.innerHeight;

      if (scrollable <= 0) {
        setProgress(0);
        return;
      }

      setProgress(Math.max(0, Math.min(1, -rect.top / scrollable)));
    };

    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div
      ref={outerRef}
      className="relative"
      style={{ height: String(length * 100) + 'vh' }}
    >
      <div
        className="sticky top-0 h-screen overflow-hidden"
        style={{
         // Longer perspective means gentler foreshortening. 1600px keeps the
          // sense of depth while stopping distant text from shrinking to
          // illegibility on a projector.
          perspective: '1600px',
          perspectiveOrigin: '50% 50%',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            transformStyle: 'preserve-3d',
            // Moving the whole stage toward the viewer is equivalent to moving
            // a camera into the scene, and avoids transforming each child.
            transform: 'translateZ(' + String(progress * travel) + 'px)',
          }}
        >
          {children(progress)}
        </div>
      </div>
    </div>
  );
}

interface DepthLayerProps {
  /**
   * Distance from the camera at rest, in pixels. More negative is further
   * away. Objects become visible as the camera approaches them and rush past
   * once it goes beyond.
   */
  z: number;
  /** Horizontal offset, so layers are not all stacked centrally. */
  x?: number;
  /** Vertical offset. */
  y?: number;
  /** Current camera progress, passed down from the stage. */
  progress: number;
  /** How far the camera travels in total. Must match the stage. */
  travel?: number;
  children: ReactNode;
  className?: string;
}

/**
 * One object in the depth stage.
 *
 * Opacity is computed from distance to the camera, so things fade in as they
 * approach and out as they pass.
 *
 * ONE THING AT A TIME
 * -------------------
 * The visible band is narrow by design. If several layers are lit at once they
 * overlap and the section becomes unreadable — which is exactly what happens
 * with a generous fade window and closely spaced depths. Better to show one
 * card clearly than three faintly.
 *
 * The near fade is aggressive: an object starts disappearing while it is still
 * 500px ahead, so it is gone well before the next one arrives rather than
 * ghosting over it.
 *
 * @param props - depth, offsets, and content
 * @returns the positioned layer
 */
export function DepthLayer({
    z,
    x = 0,
    y = 0,
    progress,
    travel = 4200,
    children,
    className = '',
  }: DepthLayerProps) {
    // How far this object currently is from the camera. Positive means ahead.
    const distance = -z - progress * travel;
  
    // Fade in over a short, late window so a card is invisible until it is
    // genuinely the one being read.
    const farFade = Math.max(0, Math.min(1, (1500 - distance) / 450));
  
    // Fade out early and fast. An object 500px ahead is already going; by 150px
    // it is gone. This is what stops layers stacking on top of each other.
    const nearFade = Math.max(0, Math.min(1, (distance - 150) / 350));
  
    const opacity = farFade * nearFade;
  
    // No blur at all. It was costing legibility for very little effect, and the
    // depth is already carried by scale and opacity.
    return (
      <div
        className={'absolute left-1/2 top-1/2 ' + className}
        style={{
          transform:
            'translate3d(calc(-50% + ' + String(x) + 'px), calc(-50% + ' + String(y) + 'px), ' + String(z) + 'px)',
          opacity,
          pointerEvents: opacity > 0.6 ? 'auto' : 'none',
          willChange: 'transform, opacity',
        }}
      >
        {children}
      </div>
    );
  }