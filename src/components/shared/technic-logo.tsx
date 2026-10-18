import Image from "next/image";
import { cn } from "@/lib/utils";

export interface TechnicLogoProps {
  className?: string;
  /** Height of the logo image in px. */
  size?: number;
  /** Show the TECHNOLOGY subtitle under the wordmark row. */
  showSubtitle?: boolean;
  theme?: "dark" | "light" | "auto";
}

/**
 * Technic Technologies logo — the provided brand asset (angular "TT" mark in
 * green and red beside the TECHNOLOGIES / TECHNOLOGY wordmark). Used in the
 * sidebar, login screen and document headers; the PDF pipeline reads the
 * same PNG from /logo-pdf.png.
 */
export function TechnicLogo({
  className,
  size = 36,
  showSubtitle = false,
  theme = "auto",
}: TechnicLogoProps) {
  const wordColor =
    theme === "dark"
      ? "text-white"
      : theme === "light"
        ? "text-[#123524]"
        : "text-[#123524] dark:text-white";

  const subtitleColor =
    theme === "dark"
      ? "text-red-400"
      : theme === "light"
        ? "text-[#E31E2D]"
        : "text-[#E31E2D] dark:text-red-400";

  return (
    <span className={cn("inline-flex select-none items-center gap-2.5", className)}>
      <Image
        src="/logo.png"
        alt="Technic Technologies"
        width={size * 3}
        height={size}
        priority
        className="h-auto object-contain"
        style={{ height: `${size}px`, width: "auto" }}
      />
      {showSubtitle ? (
        <span className={cn("text-[10px] font-bold uppercase tracking-[0.22em]", subtitleColor)}>
          Technology
        </span>
      ) : null}
    </span>
  );
}
