import confetti from 'canvas-confetti';

const CHRISTMAS_PALETTE = ['#D4AF37', '#F3D878', '#7A1C2E', '#B42A43', '#165B43', '#FAF6EE'];

export function triggerGiftRevealConfetti(): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  try {
    void confetti({
      particleCount: 90,
      spread: 78,
      startVelocity: 42,
      origin: { y: 0.62 },
      colors: CHRISTMAS_PALETTE,
      disableForReducedMotion: true,
      zIndex: 60,
    });

    window.setTimeout(() => {
      void confetti({
        particleCount: 45,
        angle: 60,
        spread: 58,
        origin: { x: 0.12, y: 0.68 },
        colors: CHRISTMAS_PALETTE,
        disableForReducedMotion: true,
        zIndex: 60,
      });
      void confetti({
        particleCount: 45,
        angle: 120,
        spread: 58,
        origin: { x: 0.88, y: 0.68 },
        colors: CHRISTMAS_PALETTE,
        disableForReducedMotion: true,
        zIndex: 60,
      });
    }, 220);
  } catch {
    // Ignore canvas/confetti failures in headless or restricted environments
  }
}
