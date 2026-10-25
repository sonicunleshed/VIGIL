import { AppShell } from "@/components/layout/AppShell";
import { VigilProvider } from "@/lib/store";

/** Staff screens share one live store and the app shell. Patient pages (/checkin) use neither. */
export default function StaffLayout({ children }: LayoutProps<"/">) {
  return (
    <VigilProvider>
      <AppShell>{children}</AppShell>
    </VigilProvider>
  );
}
