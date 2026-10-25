"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Suspense } from "react";
import { isActive, NAV } from "@/lib/routes";
import { useVigil } from "@/lib/store";

type Props = {
  collapsed: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
};

/** The route is read under Suspense so the shell can prerender without it. */
export function SidebarNav(props: Props) {
  return (
    <Suspense fallback={<SidebarNavInner {...props} pathname={null} />}>
      <SidebarNavWithPath {...props} />
    </Suspense>
  );
}

function SidebarNavWithPath(props: Props) {
  return <SidebarNavInner {...props} pathname={usePathname()} />;
}

function SidebarNavInner({ collapsed, onToggle, onNavigate, pathname }: Props & { pathname: string | null }) {
  const { alerts } = useVigil();
  const attention = alerts.filter((a) => a.status !== "resolved").length;

  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className={`flex h-16 items-center gap-2.5 px-5 ${collapsed ? "justify-center px-0" : ""}`}>
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
          <Activity aria-hidden className="size-4.5" />
        </span>
        {!collapsed && (
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-wide text-fg">VIGIL</span>
            <span className="block text-[11px] text-fg-3">Reassessment support</span>
          </span>
        )}
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                const base = `flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm transition-colors duration-150 ${
                  collapsed ? "justify-center" : ""
                }`;
                const active = isActive(item.href, pathname);
                const count = item.badge === "attention" ? attention : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`${base} ${
                        active ? "bg-raised text-fg" : "text-fg-2 hover:bg-raised/60 hover:text-fg"
                      }`}
                    >
                      <Icon aria-hidden className={`size-4 shrink-0 ${active ? "text-accent" : ""}`} />
                      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="flex-1">{item.label}</span>}
                      {count > 0 && (
                        <span
                          className={`tabular rounded-full bg-st-due/15 px-1.5 text-[11px] font-semibold text-st-due ${
                            collapsed ? "absolute ml-6 -mt-5" : ""
                          }`}
                        >
                          {count}
                          <span className="sr-only"> open review requests</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {onToggle && (
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-sm text-fg-3 hover:bg-raised hover:text-fg ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="size-4" />
            ) : (
              <>
                <PanelLeftClose aria-hidden className="size-4" />
                Collapse
              </>
            )}
          </button>
        </div>
      )}
    </nav>
  );
}
