import Image from "next/image";

/** Brand assets in /public/brand, cut from the VIGIL brand sheet. Sizes are the source pixels. */
const LOGO = { width: 922, height: 230 };

/** Eye + wordmark. The dark-theme file has a white wordmark; the right one shows per theme. */
export function BrandLogo({ width = 180, className = "" }: { width?: number; className?: string }) {
  const height = Math.round((width * LOGO.height) / LOGO.width);
  return (
    <span className={`block ${className}`} style={{ width, height }}>
      <Image src="/brand/vigil-logo.png" alt="VIGIL" width={width} height={height} loading="eager" className="dark:hidden" />
      <Image
        src="/brand/vigil-logo-dark.png"
        alt="VIGIL"
        width={width}
        height={height}
        loading="eager"
        className="hidden dark:block"
      />
    </span>
  );
}

/** The eye alone (square source), for tight spaces such as the collapsed sidebar. */
export function BrandMark({ size = 36 }: { size?: number }) {
  return <Image src="/brand/vigil-mark.png" alt="VIGIL" width={size} height={size} loading="eager" />;
}

export function Slogan({ className = "" }: { className?: string }) {
  return (
    <p className={`leading-snug uppercase ${className}`}>
      <span className="block text-[11px] font-semibold tracking-[0.24em] text-fg">Staying vigilant</span>
      <span className="block whitespace-nowrap text-[11px] tracking-[0.06em] text-fg-3">When every moment matters.</span>
    </p>
  );
}

/** Logo stacked over the slogan, as on the brand sheet. */
export function BrandLockup({ width = 180 }: { width?: number }) {
  return (
    <div className="space-y-2">
      <BrandLogo width={width} />
      <Slogan />
    </div>
  );
}
