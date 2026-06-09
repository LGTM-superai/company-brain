import { KnowledgeGraph } from "../../components/knowledge-graph";
import { AppShell } from "../../components/shell";
import { getDashboardData } from "../../lib/data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const sourceLabels: Record<string, string> = {
  internal: "Internal",
  slack: "Slack",
  github: "GitHub",
  exa: "Exa",
  notion: "Notion",
  s3: "S3 Storage",
};

const sourceBadgeStyles: Record<string, string> = {
  internal: "bg-primary/15 text-primary border-primary/30",
  slack: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  github: "bg-neutral-500/15 text-neutral-300 border-neutral-400/30",
  exa: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  notion: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  s3: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export default async function KnowledgeGraphPage() {
  const data = await getDashboardData();

  const grouped = data.knowledgeNodes.reduce(
    (acc, node) => {
      const key = node.source;
      if (!acc[key]) acc[key] = [];
      acc[key].push(node);
      return acc;
    },
    {} as Record<string, typeof data.knowledgeNodes>,
  );

  const sourceOrder = ["internal", "slack", "github", "exa", "notion", "s3"];
  const sortedSources = Object.keys(grouped).sort(
    (a, b) =>
      (sourceOrder.indexOf(a) === -1 ? 99 : sourceOrder.indexOf(a)) -
      (sourceOrder.indexOf(b) === -1 ? 99 : sourceOrder.indexOf(b)),
  );

  return (
    <AppShell activePath="/knowledge-graph">
      {data.error ? (
        <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
          {data.error} Run <code className="font-mono">bun run seed</code> after
          setting MONGODB_URL.
        </div>
      ) : null}

      <div className="p-6 overflow-y-auto flex-grow">
        <div className="mb-6">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-1">
            Knowledge Graph
          </p>
          <h2 className="text-2xl font-bold text-foreground">Source Map</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data.knowledgeNodes.length} indexed nodes across{" "}
            {sortedSources.length} sources
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.6fr] gap-6 items-start">
          <Card className="overflow-hidden">
            <CardContent className="p-3">
              <KnowledgeGraph nodes={data.knowledgeNodes} />
            </CardContent>
          </Card>

          <Card className="h-[740px] flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Indexed Objects</CardTitle>
              <CardDescription>
                All knowledge nodes grouped by data source
              </CardDescription>
            </CardHeader>
            <Separator />
            <ScrollArea className="flex-1">
              <CardContent className="pt-4">
                <div className="space-y-5">
                  {sortedSources.map((source, idx) => (
                    <section key={source}>
                      {idx > 0 && <Separator className="mb-4" />}
                      <div className="flex items-center gap-2 mb-3">
                        <Badge
                          variant="outline"
                          className={
                            sourceBadgeStyles[source] ?? sourceBadgeStyles.internal
                          }
                        >
                          {sourceLabels[source] ?? source}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {grouped[source].length}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {grouped[source].map((node) => (
                          <div
                            className="rounded-lg border border-border/60 bg-muted/30 p-2.5 transition-colors hover:bg-muted/60 cursor-pointer"
                            key={node.nodeId}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-sm font-medium text-foreground leading-tight">
                                {node.label}
                              </span>
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 shrink-0"
                              >
                                {node.type}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {node.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </CardContent>
            </ScrollArea>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
