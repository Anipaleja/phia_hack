"use client";

/**
 * Full product visible (object-contain) without flat letterboxing: a blurred,
 * scaled copy of the same image fills the tile behind the sharp layer.
 */
export function ProductTileImage({
  src,
  alt,
  foregroundClassName = "transition-transform duration-300 group-hover:scale-[1.01]",
}: {
  src: string;
  alt: string;
  foregroundClassName?: string;
}) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-[#ddd8d0]">
      {/* eslint-disable-next-line @next/next/no-img-element -- retailer URLs */}
      <img
        src={src}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-125 object-cover object-center blur-2xl opacity-[0.58]"
        loading="lazy"
      />
      {/* eslint-disable-next-line @next/next/no-img-element -- retailer URLs */}
      <img
        src={src}
        alt={alt}
        className={`relative z-[1] h-full w-full object-contain object-center ${foregroundClassName}`}
        loading="lazy"
      />
    </div>
  );
}
