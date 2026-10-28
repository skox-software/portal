import Image from "next/image";
import lockupDark from "@/public/brand/lockup-dark.png";
import lockupLight from "@/public/brand/lockup-light.png";

/**
 * The UnBusy lockup (mark and wordmark), cropped from
 * docs/brand/final/03 and 07 in skox-software/skox. "dark" is the paper
 * version for ink surfaces. The dot stays blue on both.
 */
export function Logo({ variant = "light", className }: { variant?: "light" | "dark"; className?: string }) {
  return <Image src={variant === "dark" ? lockupDark : lockupLight} alt="UnBusy" className={className} priority />;
}
