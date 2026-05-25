import { Suspense } from "react";
import News from "../../src/views/News";

export default function NewsPage() {
  return (
    <Suspense>
      <News />
    </Suspense>
  );
}
