import QueryPage from "../../src/views/QueryPage";

export default function BriefRoutePage({
  searchParams
}: {
  searchParams?: { ticker?: string };
}) {
  return <QueryPage initialTicker={searchParams?.ticker} />;
}
