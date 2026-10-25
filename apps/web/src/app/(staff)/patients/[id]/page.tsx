import { Suspense } from "react";
import { PatientDetailView } from "@/components/patients/PatientDetailView";
import { Skeleton } from "@/components/ui/primitives";

export default function PatientPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <PatientDetailView />
    </Suspense>
  );
}
