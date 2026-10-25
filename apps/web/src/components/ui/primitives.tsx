import type { LucideIcon } from "lucide-react";
import { CircleAlert, Inbox } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
} & Record<`aria-${string}`, string>) {
  return (
    <Tag className={`rounded-2xl border border-card-line bg-surface shadow-[var(--card-shadow)] ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  id,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-fg">
          {title}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-fg-3">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  icon?: LucideIcon;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const variants = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover border-transparent font-semibold",
    secondary: "bg-raised text-fg border-line hover:border-fg-3",
    ghost: "bg-transparent text-fg-2 border-transparent hover:bg-raised hover:text-fg",
  };
  const sizes = { sm: "h-8 px-2.5 text-xs gap-1.5", md: "h-10 px-3.5 text-sm gap-2" };
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-lg border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {Icon ? <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} /> : null}
      {children}
    </button>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <Icon aria-hidden className="size-6 text-fg-3" />
      <p className="text-sm font-medium text-fg-2">{title}</p>
      {children ? <div className="max-w-sm text-xs text-fg-3">{children}</div> : null}
    </div>
  );
}

export function ErrorState({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-xl border border-st-urgent/40 bg-st-urgent/5 p-5"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-st-urgent">
        <CircleAlert aria-hidden className="size-4" />
        {title}
      </p>
      {detail ? <p className="text-xs text-fg-2">{detail}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-raised ${className}`} />;
}
