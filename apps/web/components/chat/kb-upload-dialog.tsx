"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, FileText, CheckCircle, Loader2 } from "lucide-react";

type UploadState = "idle" | "uploading" | "success" | "error";

export function KBUploadDialog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [domain, setDomain] = useState("engineering");
  const [sensitivity, setSensitivity] = useState("internal");
  const [tags, setTags] = useState("");
  const [summary, setSummary] = useState("");
  const [owner, setOwner] = useState("");
  const [team, setTeam] = useState("");

  const reset = () => {
    setState("idle");
    setError("");
    setFile(null);
    setTitle("");
    setDomain("engineering");
    setSensitivity("internal");
    setTags("");
    setSummary("");
    setOwner("");
    setTeam("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setState("uploading");
    setError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("title", title);
    formData.append("domain", domain);
    formData.append("sensitivity", sensitivity);
    formData.append("tags", tags);
    formData.append("summary", summary);
    if (owner) formData.append("owner", owner);
    if (team) formData.append("team", team);

    try {
      const res = await fetch("/api/kb/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Upload failed");
      }

      setState("success");
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 1500);
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-accent cursor-pointer"
          title="Upload to Knowledge Base"
        >
          <Upload className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">Upload to Knowledge Base</DialogTitle>
        </DialogHeader>

        {state === "success" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle className="h-10 w-10 text-green-500" />
            <p className="text-sm text-foreground">Document uploaded successfully</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">File</label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background cursor-pointer hover:border-primary transition-colors flex-grow">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground truncate">
                    {file ? file.name : "Choose file..."}
                  </span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".md,.txt,.pdf,.doc,.docx"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) {
                        setFile(f);
                        if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Document title"
                className="bg-background"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Domain</label>
                <select
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="engineering">Engineering</option>
                  <option value="product">Product</option>
                  <option value="business">Business</option>
                  <option value="people">People</option>
                  <option value="general">General</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Sensitivity</label>
                <select
                  value={sensitivity}
                  onChange={(e) => setSensitivity(e.target.value)}
                  className="w-full h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                >
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Owner</label>
                <Input
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                  placeholder="e.g. carlos"
                  className="bg-background"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Team</label>
                <Input
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="e.g. engineering"
                  className="bg-background"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tags (comma-separated)</label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g. architecture, backend, api"
                className="bg-background"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Summary</label>
              <Input
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief description of the document"
                className="bg-background"
              />
            </div>

            {error && (
              <p className="text-xs text-red-500">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={!file || !title || state === "uploading"}
            >
              {state === "uploading" ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Uploading...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" /> Upload Document</>
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
