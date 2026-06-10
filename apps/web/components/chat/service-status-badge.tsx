import { cn } from "@/lib/utils";

const statusConfig = {
  healthy: { dot: "bg-green-500", text: "text-green-700 dark:text-green-400", bg: "bg-green-500/10" },
  degraded: { dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-400", bg: "bg-yellow-500/10" },
  down: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", bg: "bg-red-500/10" },
} as const;

export function ServiceStatusBadge({
  service,
  status,
}: {
  service: string;
  status: "healthy" | "degraded" | "down";
}) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        config.bg,
        config.text,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", config.dot)} />
      {service}
    </span>
  );
}
