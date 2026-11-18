import { useId } from "react";

export function CoruscantLogo({ className }: { className?: string }) {
  const raw = useId();
  const maskId = `coruscant-orbit-${raw.replace(/[^A-Za-z0-9_-]/g, "")}`;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="24"
          height="24"
        >
          <rect width="24" height="24" fill="#fff" />
          <g transform="rotate(-20 12 12)">
            <path
              d="M22.5 12A10.5 3.6 0 0 1 1.5 12"
              fill="none"
              stroke="#000"
              strokeWidth="4"
            />
          </g>
        </mask>
      </defs>
      <circle cx="12" cy="12" r="5.5" fill="currentColor" mask={`url(#${maskId})`} />
      <g
        transform="rotate(-20 12 12)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      >
        <path d="M1.5 12A10.5 3.6 0 0 1 22.5 12" />
        <path d="M22.5 12A10.5 3.6 0 0 1 1.5 12" />
      </g>
    </svg>
  );
}
