import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function FailureCard({
  tool,
  error,
  recovery,
}: {
  tool: string;
  error: string;
  recovery: string;
}) {
  return (
    <Card className="bg-card border-l-4 border-l-red-500 border-border">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">{tool}</span>
          <span className="text-[10px] uppercase tracking-wider text-red-400 font-semibold">
            failed
          </span>
        </div>
        <p className="text-xs text-muted-foreground pl-6">{error}</p>
        <div className="flex items-center gap-2 pl-6 pt-1">
          <RefreshCw className="h-3 w-3 text-green-500 flex-shrink-0" />
          <p className="text-xs text-green-600 dark:text-green-400">{recovery}</p>
        </div>
      </CardContent>
    </Card>
  );
}
