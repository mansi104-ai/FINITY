import QueryPage from "../../src/views/QueryPage";

export default function BriefRoutePage({
  searchParams
}: {
  searchParams?: { query?: string; ticker?: string };
}) {
  return <QueryPage initialQuery={searchParams?.query} initialTicker={searchParams?.ticker} />;
}
