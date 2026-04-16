import QueryPage from "../../src/views/QueryPage";

export default function QueryRoutePage({
  searchParams
}: {
  searchParams?: { query?: string; ticker?: string };
}) {
  return <QueryPage initialQuery={searchParams?.query} initialTicker={searchParams?.ticker} />;
}
