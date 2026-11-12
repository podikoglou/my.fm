import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

function initials(name: string): string {
  const split = name.split(" ");

  if (split.length > 1) {
    // TODO: maybe clamp this to 2-3 elements
    return split
      .map((s) => s[0])
      .join("")
      .toUpperCase();
  }

  // assumption: name.length >= 1 (based on validation schema)
  return (name[0] + (name[1] || "")).toUpperCase();
}

export function UserAvatar({
  avatarUrl,
  name,
  className,
  fallbackClassName,
}: {
  avatarUrl: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Avatar className={cn("h-24 w-24", className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="User" />}

      <AvatarFallback className={cn("text-3xl", fallbackClassName)}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
