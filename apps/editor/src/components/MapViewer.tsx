import { useEffect, useRef, useState } from 'react';
import { EditorViewport } from '../editor-viewport.js';

export interface MapViewerProps {
  readonly t: (key: string) => string;
}

type ViewerState = 'loading' | 'ready' | 'unavailable';

/**
 * Thin React wrapper mounting the imperative `EditorViewport` class in a
 * ref (design's "Editor framework" decision: no react-three-fiber). Left
 * untested per this repo's convention -- the pure camera-framing math it
 * delegates to lives in viewer-camera.ts and is unit tested there.
 */
export function MapViewer({ t }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<ViewerState>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // `/@fs/` (and thus the fixture map) only exists under `vite dev` -- a
    // production build has no dev server to serve the (git-ignored,
    // never-shipped) fixture from. Same caveat as apps/desktop/src/main.ts.
    if (!import.meta.env.DEV) {
      setState('unavailable');
      return;
    }

    const viewport = new EditorViewport(container);
    let cancelled = false;
    viewport
      .loadFixtureMap(__MZ_FIXTURES_DIR__)
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch((error) => {
        console.error('Failed to load the map-viewer fixture map:', error);
        if (!cancelled) setState('unavailable');
      });

    return () => {
      cancelled = true;
      viewport.dispose();
    };
  }, []);

  return (
    <div className="map-viewer">
      {state !== 'ready' && (
        <p className="map-viewer-status">
          {state === 'loading' ? t('viewer.loading') : t('viewer.unavailable')}
        </p>
      )}
      <div ref={containerRef} className="map-viewer-canvas" />
    </div>
  );
}
