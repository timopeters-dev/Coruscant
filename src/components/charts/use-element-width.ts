"use client";

import * as React from "react";

/**
 * Measures an element's content width via a callback ref and ResizeObserver,
 * falling back to `fallback` during SSR or before the element mounts.
 * Using a callback ref ensures observation starts even if the element mounts
 * conditionally after an empty state.
 */
export function useElementWidth(
  fallback = 640,
): [React.RefCallback<HTMLElement>, number] {
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const [width, setWidth] = React.useState(fallback);

  const refCallback = React.useCallback((node: HTMLElement | null) => {
    setElement(node);
  }, []);

  React.useEffect(() => {
    if (!element) return;

    const update = () => {
      const next = Math.round(element.getBoundingClientRect().width);
      if (next > 0) {
        setWidth(next);
      }
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      update();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [refCallback, width];
}
