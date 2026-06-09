import type { ExaSearchResult } from "@company-brain/shared";

export function ExaResults({ results }: { results: ExaSearchResult[] }) {
  return (
    <section>
      <h3>Exa search results</h3>
      {results.map((result) => (
        <article key={result.url}>
          <strong>{result.title}</strong>
          <p>{result.summary}</p>
          <small>{result.url}</small>
        </article>
      ))}
    </section>
  );
}
