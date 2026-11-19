import { Badge } from "./ui/badge";

const LABEL_HEIGHT = 24;

/** The month pill that follows the scrollbar thumb while the list is scrolling. */
export function ScrollMonthLabel({
  label,
  progress,
  viewportHeight,
  visible,
}: {
  label: string;
  progress: number;
  viewportHeight: number;
  visible: boolean;
}) {
  return (
    <Badge
      aria-hidden
      variant="outline"
      className="pointer-events-none absolute right-3 z-20 rounded-full bg-card px-2.5 transition-opacity duration-150 motion-reduce:transition-none"
      style={{
        top: progress * Math.max(0, viewportHeight - LABEL_HEIGHT),
        opacity: visible ? 1 : 0,
      }}
    >
      {label}
    </Badge>
  );
}
