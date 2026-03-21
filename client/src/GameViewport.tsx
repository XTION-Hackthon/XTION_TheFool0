import { useEffect, useRef, useState } from 'react';

type DestroyableGame = {
  destroy: (removeCanvas: boolean, noReturn?: boolean) => void;
};

export function GameViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<DestroyableGame | null>(null);
  const [loadingGame, setLoadingGame] = useState(true);

  useEffect(() => {
    let active = true;

    if (!containerRef.current || gameRef.current) {
      return;
    }

    void (async () => {
      const { createGame } = await import('./game');
      if (!active || !containerRef.current) {
        return;
      }

      gameRef.current = createGame(containerRef.current);
      setLoadingGame(false);
    })();

    return () => {
      active = false;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loadingGame && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.35)',
            color: '#cbd5e1',
            fontSize: 14,
            fontFamily: 'Arial, sans-serif',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          正在加载场景资源…
        </div>
      )}
    </>
  );
}

export default GameViewport;
