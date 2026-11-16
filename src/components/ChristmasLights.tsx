export function ChristmasLights() {
  const bulbs = Array.from({ length: 18 }, (_, i) => {
    const colors = ['#F3D878', '#B8334A', '#FAF6EE', '#D4AF37'];
    return {
      id: i,
      color: colors[i % colors.length],
      delay: `${(i % 4) * 0.65}s`,
    };
  });

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative w-full overflow-hidden border-b border-[#D4AF37]/15 bg-[#071510]/80 py-2"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4">
        {bulbs.map((bulb) => (
          <div key={bulb.id} className="flex flex-col items-center">
            <span className="h-1.5 w-1.5 rounded-t-sm bg-[#2D4A3E]" />
            <span
              className="animate-twinkle h-2.5 w-2 rounded-full"
              style={{
                backgroundColor: bulb.color,
                boxShadow: `0 0 10px ${bulb.color}`,
                animationDelay: bulb.delay,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
