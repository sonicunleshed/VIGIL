import { CommandCenterPreview } from "@/components/CommandCenterPreview";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold">VIGIL nurse command center</h1>
      <p className="mt-1 text-sm text-muted">
        Phase 0 preview: seeded synthetic patients from the API with live updates. Detectors and
        review workflow arrive in later phases.
      </p>
      <CommandCenterPreview />
    </main>
  );
}
