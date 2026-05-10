"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ExternalLink, Search } from "lucide-react";

import {
  type CollectionKind,
  collectionKind,
  KIND_LABEL,
} from "@/lib/collection-kind";
import type { OwnerCredit } from "@/lib/owner-credit";
import type { PetWithMetrics } from "@/lib/pets";

import { CollectionCover } from "@/components/collection-cover";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

type CollectionItem = {
  slug: string;
  title: string;
  description: string;
  ownerId: string | null;
  externalUrl: string | null;
  coverPetSlug: string | null;
  petCount: number;
  pets: PetWithMetrics[];
};

type SortKey = "size" | "title";

const KIND_FILTERS: { value: "all" | CollectionKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "franchise", label: "Franchises" },
  { value: "category", label: "Categories" },
  { value: "category-sub", label: "Themed" },
  { value: "other", label: "Curated" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "size", label: "Largest" },
  { value: "title", label: "A → Z" },
];

const PAGE_SIZE = 12;

export function CollectionsBrowser({
  collections,
  credits,
}: {
  collections: CollectionItem[];
  credits: Record<string, OwnerCredit>;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | CollectionKind>("all");
  const [sort, setSort] = useState<SortKey>("size");
  const [pageCount, setPageCount] = useState(1);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: collections.length };
    for (const c of collections) {
      const k = collectionKind(c.slug);
      map[k] = (map[k] ?? 0) + 1;
    }
    return map;
  }, [collections]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = collections.filter((c) => {
      if (kind !== "all" && collectionKind(c.slug) !== kind) return false;
      if (!q) return true;
      return (
        c.title.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q)
      );
    });
    list = [...list];
    list.sort((a, b) => {
      if (sort === "size") return b.petCount - a.petCount;
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [collections, query, kind, sort]);

  // Reset paginator whenever the filtered set changes — otherwise users
  // who scrolled deep into "Themed" then switched to "Franchises" would
  // see N pages of franchises pre-rendered without scrolling.
  useEffect(() => {
    setPageCount(1);
  }, [query, kind, sort]);

  const visibleSlice = useMemo(
    () => visible.slice(0, pageCount * PAGE_SIZE),
    [visible, pageCount],
  );
  const hasMore = visibleSlice.length < visible.length;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setPageCount((p) => p + 1);
      },
      { rootMargin: "600px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore]);

  // Stable handlers so the kind-filter chips and search input do not
  // hand fresh function refs to their children on every paginator
  // re-render. setQuery/setKind/setSort are already stable identity
  // from useState; we just close over them.
  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    [],
  );
  const handleSortChange = useCallback((v: SortKey | null) => {
    if (v) setSort(v);
  }, []);
  const handleKindClick = useCallback(
    (value: "all" | CollectionKind) => setKind(value),
    [],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <InputGroup className="h-11 flex-1 rounded-full bg-background/40">
            <InputGroupAddon align="inline-start">
              <Search className="size-4 text-muted-3" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={handleQueryChange}
              placeholder="Try 'pokemon' or 'cozy cat' or 'developer'"
              aria-label="Search collections"
              className="text-sm placeholder:text-muted-3"
            />
          </InputGroup>
          <Select value={sort} onValueChange={handleSortChange}>
            <SelectTrigger
              aria-label="Sort collections"
              className="w-full shrink-0 sm:w-auto sm:min-w-[180px]"
            >
              <span className="text-muted-3">Sort:</span>
              <span className="text-foreground">
                {SORT_OPTIONS.find((o) => o.value === sort)?.label}
              </span>
            </SelectTrigger>
            <SelectContent align="end">
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_FILTERS.map((f) => {
            const c = counts[f.value] ?? 0;
            const active = kind === f.value;
            return (
              <KindChip
                key={f.value}
                value={f.value}
                label={f.label}
                count={c}
                active={active}
                onClick={handleKindClick}
              />
            );
          })}
          <span className="ml-auto text-xs text-muted-3">
            Showing {visibleSlice.length} of {visible.length}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border-base bg-surface/60 p-10 text-center text-sm text-muted-2">
          No collections match those filters.
        </div>
      ) : (
        <div className="grid auto-rows-fr gap-5 md:grid-cols-2 lg:grid-cols-3">
          {visibleSlice.map((c) => {
            const owner = c.ownerId ? credits[c.ownerId] : null;
            return <CollectionCard key={c.slug} collection={c} owner={owner} />;
          })}
        </div>
      )}

      {hasMore ? (
        <div
          ref={sentinelRef}
          aria-hidden="true"
          className="flex h-24 items-center justify-center text-xs text-muted-3"
        >
          Loading more…
        </div>
      ) : visible.length > PAGE_SIZE ? (
        <p className="pt-2 text-center text-xs text-muted-3">
          End of results · {visible.length} collections
        </p>
      ) : null}
    </div>
  );
}

const KindChip = memo(function KindChip({
  value,
  label,
  count,
  active,
  onClick,
}: {
  value: "all" | CollectionKind;
  label: string;
  count: number;
  active: boolean;
  onClick: (value: "all" | CollectionKind) => void;
}) {
  const handleClick = useCallback(() => onClick(value), [onClick, value]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
        active
          ? "border-brand bg-brand text-on-inverse"
          : "border-border-base bg-transparent text-muted-2 hover:border-border-strong hover:text-foreground"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 text-[10px] font-mono tracking-wider ${
          active ? "bg-on-inverse/15" : "bg-surface text-muted-3"
        }`}
      >
        {count}
      </span>
    </button>
  );
});

const CollectionCard = memo(function CollectionCard({
  collection: c,
  owner,
}: {
  collection: CollectionItem;
  owner: OwnerCredit | null;
}) {
  const k = collectionKind(c.slug);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-3xl border border-border-base bg-surface/80">
      <Link href={`/collections/${c.slug}`} className="block">
        <CollectionCover
          pets={c.pets}
          coverSlug={c.coverPetSlug}
          max={5}
          scale={0.55}
        />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-brand-tint px-2 py-0.5 font-mono text-[9px] tracking-[0.18em] text-brand-deep uppercase dark:bg-brand-tint-dark dark:text-brand-light">
                {KIND_LABEL[k]}
              </span>
              <span className="font-mono text-[10px] tracking-[0.18em] text-muted-3 uppercase">
                {c.petCount} pets
              </span>
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              <Link href={`/collections/${c.slug}`}>{c.title}</Link>
            </h2>
          </div>
          {c.externalUrl ? (
            <Link
              href={c.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-base bg-surface px-2.5 text-[11px] font-medium text-muted-2 transition hover:border-border-strong"
            >
              <ExternalLink className="size-3" />
              Site
            </Link>
          ) : null}
        </div>
        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-2">
          {c.description}
        </p>
        {owner ? (
          <Link
            href={`/u/${owner.handle}`}
            className="mt-auto inline-flex pt-3 text-xs font-medium text-brand hover:underline"
          >
            by {owner.name}
          </Link>
        ) : null}
      </div>
    </article>
  );
});
