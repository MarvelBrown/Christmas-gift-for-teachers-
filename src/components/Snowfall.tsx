import { useMemo } from 'react';

interface Flake {
  id: number;
  leftPct: number;
  sizePx: number;
  durationSec: number;
  delaySec: number;
  opacity: number;
}

export function Snowfall() {
  const flakes = useMemo<Flake[]>(() => {
    return Array.from({ length: 34 }, (_, i) => ({
      id: i,
      leftPct: ((i * 29 + 7) % 98) + 1,
      sizePx: 3 + (i % 4) * 1.5,
      durationSec: 10 + (i % 7) * 2.4,
      delaySec: -((i * 1.7) % 14),
      opacity: 0.28 + (i % 5) * 0.11,
    }));
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-10 overflow-hidden"
    >
      {flakes.map((f) => (
        <span
          key={f.id}
          className="animate-snowfall absolute -top-4 rounded-full bg-[#FAF6EE]"
          style={{
            left: `${f.leftPct}%`,
            width: `${f.sizePx}px`,
            height: `${f.sizePx}px`,
            opacity: f.opacity,
            animationDuration: `${f.durationSec}s`,
            animationDelay: `${f.delaySec}s`,
          }}
        />
      ))}
    </div>
  );
}
