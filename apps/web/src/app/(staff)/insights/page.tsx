import { Suspense } from "react";
import { InsightsView } from "@/components/insights/InsightsView";
import { Skeleton } from "@/components/ui/primitives";

export default function InsightsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <InsightsView />
    </Suspense>
  );
}
