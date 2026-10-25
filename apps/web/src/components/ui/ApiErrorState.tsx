"use client";

import { RotateCw } from "lucide-react";
import { Button, ErrorState } from "@/components/ui/primitives";
import { useVigil } from "@/lib/store";

/** Full-page error for a failed API read, with how to fix it and a retry. */
export function ApiErrorState({ title, error }: { title: string; error: string }) {
  const { refresh } = useVigil();
  const unreachable = error.startsWith("Cannot reach");
  return (
    <ErrorState
      title={title}
      detail={
        unreachable
          ? `${error}. Start it with \`pnpm dev\` from the repository root; this page reconnects on its own once it is up.`
          : error
      }
      action={
        <Button size="sm" icon={RotateCw} onClick={() => void refresh()}>
          Retry
        </Button>
      }
    />
  );
}
