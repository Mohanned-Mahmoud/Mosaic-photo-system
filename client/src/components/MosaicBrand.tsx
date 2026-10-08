import type { SVGProps } from "react";

export function ApertureMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true" {...props}>
      <path d="M40 7 58 17.4v20.8L40 48.6 22 38.2V17.4L40 7Z" stroke="currentColor" strokeWidth="3" />
      <path d="m58 17.4 18 10.4v20.8L58 59V38.2l18-10.4M22 17.4 4 27.8v20.8L22 59V38.2L4 27.8M40 48.6V69.4L22 59m18-10.4 18 10.8M40 7v20.8l18 10.4M40 27.8 22 38.2" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M40 27.8 58 38.2 40 48.6 22 38.2l18-10.4Z" fill="currentColor" fillOpacity=".22" />
    </svg>
  );
}

export function MosaicWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`mosaic-wordmark${compact ? " mosaic-wordmark--compact" : ""}`}>
      <ApertureMark className="mosaic-wordmark__mark" />
      <span className="mosaic-wordmark__text">MOSAIC</span>
    </span>
  );
}
