const paths = {
  overview: "M1 1h4v4H1zm6 0h4v4H7zM1 7h4v4H1zm6 0h4v4H7z",
  resumes: "M2 1h6v1h1v1h1v8H2zm1 1v8h6V4H7V2zm1 4h4v1H4zm0 2h4v1H4z",
  jobs: "M2 2h2V1h4v1h2v2h1v4h-1v2H8v1H4v-1H2V8H1V4h1zm2 1H3v2h2V3zm3 0v2h2V3zm-2 2v2h2V5zM3 7v2h2V7zm4 0v2h2V7z",
  boss: "M4 1h4v1h1v2h2v7H1V4h2V2h1zm0 2v1h4V3zm-2 2v2h3V6h2v1h3V5zm0 3v2h8V8H7v1H5V8z",
  pending: "M1 2h10v8H1zm1 2v5h8V4H9v1H8v1H7v1H5V6H4V5H3V4zm1-1v1h1v1h1v1h2V5h1V4h1V3z",
  history: "M2 1h8v10H2zm1 1v8h6V2zm1 2h4v1H4zm0 2h4v1H4zm0 2h3v1H4z",
  refresh: "M3 2h5v1h2V1h1v5H6V5h3V4H8V3H3v1H2v2H1V4h1V3h1zm8 4v2h-1v1H9v1H4V9H2v2H1V6h5v1H3v1h1v1h5V8h1V6z",
};

export type PixelIconName = keyof typeof paths;

export function PixelIcon({ name }: { name: PixelIconName }) {
  return (
    <svg className="rg-pixel-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d={paths[name]} />
    </svg>
  );
}
