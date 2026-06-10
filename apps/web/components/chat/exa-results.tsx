import type { ExaSearchResult } from "@company-brain/shared";

export function ExaResults({ results }: { results: ExaSearchResult[] }) {
  return (
    <div className="space-y-3 border border-outline-variant/30 rounded-lg p-4 bg-surface-container/50">
      <div className="flex justify-between items-center">
        <span className="text-sm font-medium text-on-surface">Search Results</span>
        <span className="text-xs text-on-surface-variant">{results.length} results</span>
      </div>
      {results.map((result) => (
        <article
          key={result.url}
          className="border border-outline-variant/20 rounded-lg p-3 bg-surface-container-low"
        >
          <strong className="text-sm text-on-surface">{result.title}</strong>
          <p className="text-xs text-on-surface-variant mt-1">{result.summary}</p>
          <small className="text-xs text-outline mt-1 block">{result.url}</small>
        </article>
      ))}
    </div>
  );
}
