import { useEffect, useRef, useState } from "react";

const SETTLE_DELAY = 200;
const LABEL_HIDE_DELAY = 800;

/**
 * Track a scroll container's position every frame, plus a copy that only
 * updates once scrolling has rested for `SETTLE_DELAY`, so work like fetching
 * can wait until the user stops dragging.
 */
export function useSettledScroll() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [settledTop, setSettledTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!element) return;

    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));

    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  const onScroll = () => {
    if (!element) return;

    const top = element.scrollTop;

    setScrollTop(top);
    setScrolling(true);

    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettledTop(top), SETTLE_DELAY);

    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setScrolling(false), LABEL_HIDE_DELAY);
  };

  const scrollable = element ? element.scrollHeight - element.clientHeight : 0;
  const progress = scrollable > 0 ? Math.min(1, scrollTop / scrollable) : 0;

  return { ref: setElement, onScroll, scrollTop, settledTop, viewportHeight, scrolling, progress };
}
