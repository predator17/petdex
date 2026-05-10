"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { useAuth, useClerk } from "@clerk/nextjs";
import { track } from "@vercel/analytics";
import { Heart } from "lucide-react";

type LikeButtonProps = {
  slug: string;
  initialCount: number;
};

export function LikeButton({ slug, initialCount }: LikeButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [liked, setLiked] = useState(false);
  const [likeStateLoading, setLikeStateLoading] = useState(false);
  const [pending, start] = useTransition();
  const { isLoaded, isSignedIn } = useAuth();
  const clerk = useClerk();
  const loadVersionRef = useRef(0);
  const mutationVersionRef = useRef(0);

  useEffect(() => {
    const loadVersion = loadVersionRef.current + 1;
    loadVersionRef.current = loadVersion;

    if (!isLoaded) {
      setLikeStateLoading(true);
      return;
    }

    if (!isLoaded || !isSignedIn) {
      setLiked(false);
      setCount(initialCount);
      setLikeStateLoading(false);
      return;
    }

    const mutationVersion = mutationVersionRef.current;
    const controller = new AbortController();
    setLikeStateLoading(true);

    void fetch(`/api/pets/${slug}/like`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { liked: boolean; count: number } | null) => {
        if (!data) return;
        if (loadVersionRef.current !== loadVersion) return;
        if (mutationVersionRef.current !== mutationVersion) return;
        setLiked(data.liked);
        setCount(data.count);
      })
      .catch((error: unknown) => {
        if (loadVersionRef.current !== loadVersion) return;
        if ((error as Error).name !== "AbortError") {
          setLiked(false);
          setCount(initialCount);
        }
      })
      .finally(() => {
        if (loadVersionRef.current === loadVersion) {
          setLikeStateLoading(false);
        }
      });

    return () => controller.abort();
  }, [initialCount, isLoaded, isSignedIn, slug]);

  function handleClick() {
    if (!isLoaded || !isSignedIn) {
      clerk.openSignIn({});
      return;
    }
    if (pending || likeStateLoading) return;

    // Optimistic update
    const nextLiked = !liked;
    const mutationVersion = mutationVersionRef.current + 1;
    mutationVersionRef.current = mutationVersion;
    setLiked(nextLiked);
    setCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    start(async () => {
      try {
        const res = await fetch(`/api/pets/${slug}/like`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ liked: nextLiked }),
        });
        if (!res.ok) throw new Error("like failed");
        const data = (await res.json()) as { liked: boolean; count: number };
        if (mutationVersionRef.current !== mutationVersion) return;
        setLiked(data.liked);
        setCount(data.count);
        if (data.liked) {
          track("pet_liked", { slug });
        }
      } catch {
        if (mutationVersionRef.current !== mutationVersion) return;
        // Revert
        setLiked(!nextLiked);
        setCount((c) => Math.max(0, c + (nextLiked ? -1 : 1)));
      }
    });
  }

  const disabled = pending || !isLoaded || (isSignedIn && likeStateLoading);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={liked}
      aria-busy={disabled || undefined}
      disabled={disabled}
      className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition disabled:opacity-60 ${
        liked
          ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "border-black/10 bg-surface text-muted-2 hover:border-rose-300 hover:text-rose-700"
      } dark:bg-rose-950/40 dark:text-rose-300 dark:hover:border-rose-700`}
    >
      <Heart
        className={`size-4 transition ${liked ? "fill-rose-500 text-rose-500" : ""}`}
      />
      <span className="font-mono text-xs tracking-[0.08em]">{count}</span>
    </button>
  );
}
