import type { Metadata } from "next";
import { CheckinView } from "@/components/checkin/CheckinView";

export const metadata: Metadata = {
  title: "Waiting room check-in",
  robots: { index: false, follow: false },
};

/** Patient-facing: outside the (staff) group, so no staff store, stream or navigation. */
export default function CheckinPage() {
  return <CheckinView />;
}
