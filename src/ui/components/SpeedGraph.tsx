interface SpeedGraphProps {
  history: number[]; // Array of speeds in bytes/sec
  maxSpeed: number; // Max speed for scaling
}

export function SpeedGraph({ history, maxSpeed }: SpeedGraphProps) {
  if (history.length < 2) return null;

  const width = 100;
  const height = 30;
  const max = Math.max(maxSpeed, ...history, 1);
  
  const points = history.map((val, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - (val / max) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg 
      width="100%" 
      height="100%" 
      viewBox={`0 0 ${width} ${height}`} 
      preserveAspectRatio="none"
      style={{
        marginTop: "0.5rem",
        borderBottom: "1px solid var(--border-color)",
        minHeight: "40px",
        display: "block"
      }}
      aria-hidden="true"
    >
      <polyline 
        points={points} 
        fill="none" 
        stroke="var(--primary-color)" 
        stroke-width="2" 
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
