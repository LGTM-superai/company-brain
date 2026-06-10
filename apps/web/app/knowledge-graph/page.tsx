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
import { Badge } from "@/components/ui/badge";

export default async function KnowledgeGraphPage() {
  const data = await getDashboardData();

  const tagCount = data.knowledgeNodes.length;
  const edgeCount = data.knowledgeNodes.reduce((sum, n) => sum + n.links.length, 0) / 2;
  const sources = new Set(data.knowledgeNodes.map((n) => n.source));

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
          <h2 className="text-2xl font-bold text-foreground">Tag Network</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {tagCount} tags linked by co-occurrence across {sources.size > 1 ? "S3 + Notion" : sources.values().next().value ?? "no"} documents
            {" "}· {Math.round(edgeCount)} connections
          </p>
        </div>

        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Tag Graph</CardTitle>
                <CardDescription>
                  Tags linked when they co-occur on the same document. Hover to explore.
                </CardDescription>
              </div>
              <div className="flex gap-1.5">
                {sources.has("s3") && <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">S3</Badge>}
                {sources.has("notion") && <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-500/30">Notion</Badge>}
                {sources.has("both") && <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-500/30">Shared</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <KnowledgeGraph nodes={data.knowledgeNodes} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
