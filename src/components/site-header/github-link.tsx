import { GithubIcon } from "@/components/brand/github-icon";
import type { HeaderNavItem } from "@/components/site-header/types";

type GithubLinkProps = {
  item: HeaderNavItem;
};

export function GithubLink({ item }: GithubLinkProps) {
  return (
    <a
      href={item.href}
      target="_blank"
      rel="noreferrer"
      aria-label={item.ariaLabel}
      className="hidden size-10 place-items-center rounded-full text-muted-2 transition hover:bg-surface-muted hover:text-foreground xl:grid"
    >
      <GithubIcon className="size-5" />
    </a>
  );
}
