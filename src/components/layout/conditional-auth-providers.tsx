"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { stripLocalePrefix } from "@/lib/locale-routing";

import { useAuthIntent } from "@/components/auth/auth-intent";

type FullAuthProvidersComponent = React.ComponentType<{
  children: React.ReactNode;
}>;

function isEagerAuthPath(pathname: string | null): boolean {
  const path = stripLocalePrefix(pathname ?? "/");
  return (
    path === "/submit" ||
    path === "/my-feedback" ||
    path.startsWith("/my-feedback/") ||
    path.startsWith("/u/")
  );
}

export function ConditionalAuthProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const { authActive } = useAuthIntent();
  const pathname = usePathname();
  const eagerAuthPath = isEagerAuthPath(pathname);
  const [FullAuthProviders, setFullAuthProviders] =
    useState<FullAuthProvidersComponent | null>(null);

  useEffect(() => {
    if (eagerAuthPath || !authActive || FullAuthProviders) return;
    let cancelled = false;
    void import("@/components/auth/auth-providers").then((mod) => {
      if (!cancelled) setFullAuthProviders(() => mod.FullAuthProviders);
    });
    return () => {
      cancelled = true;
    };
  }, [FullAuthProviders, authActive, eagerAuthPath]);

  if (eagerAuthPath || !authActive) return children;
  if (!FullAuthProviders) return null;
  return <FullAuthProviders>{children}</FullAuthProviders>;
}
