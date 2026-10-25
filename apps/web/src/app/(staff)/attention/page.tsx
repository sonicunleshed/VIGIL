import { Suspense } from "react";
import { AttentionView } from "@/components/attention/AttentionView";
import { Skeleton } from "@/components/ui/primitives";

export default function AttentionPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <AttentionView />
    </Suspense>
  );
}
