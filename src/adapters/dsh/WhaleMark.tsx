export function WhaleMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="rg-whale-mark" width={size} height={size} viewBox="0 0 24 24" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="currentColor" d="M2 9h3V7h3V6h7v1h2v3h2V8h2V7h2v5h-2v2h-3v2h-3v2H7v-1H4v-2H2v-2H1v-3h1z" />
      <path fill="#a9bbff" d="M3 13h12v2h-2v1H7v-1H5v-1H3z" />
      <path fill="#f4f6ff" d="M5 9h2v2H5zM10 3h2v2h-2zm3-2h1v2h-1z" />
    </svg>
  );
}
