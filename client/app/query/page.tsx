import { redirect } from "next/navigation";

export default function QueryRoutePage({
  searchParams
}: {
  searchParams?: { query?: string; ticker?: string };
}) {
  const params = new URLSearchParams();
  if (searchParams?.query) {
    params.set("query", searchParams.query);
  }
  if (searchParams?.ticker) {
    params.set("ticker", searchParams.ticker);
  }
  redirect(`/brief${params.toString() ? `?${params.toString()}` : ""}`);
}
