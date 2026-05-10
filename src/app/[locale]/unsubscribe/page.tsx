import { findByToken } from "@/lib/email-preferences";
import { buildLocaleAlternates } from "@/lib/locale-routing";

import { SiteHeader } from "@/components/site-header";

import { UnsubscribeForm } from "./unsubscribe-form";

export const metadata = {
  title: "Unsubscribe | Petdex",
  description: "Manage your Petdex email preferences.",
  alternates: buildLocaleAlternates("/unsubscribe"),
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ token?: string }>;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { token } = await searchParams;
  const pref = token ? await findByToken(token) : null;

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <SiteHeader />
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-8 pb-12 md:px-8 md:pb-16">
        <header>
          <p className="font-mono text-xs tracking-[0.22em] text-brand uppercase">
            Email · Preferences
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Unsubscribe
          </h1>
        </header>

        {pref ? (
          <UnsubscribeForm
            token={pref.unsubscribeToken}
            email={pref.email}
            initiallyUnsubscribed={pref.unsubscribedMarketing}
          />
        ) : (
          <div className="space-y-3 rounded-2xl border border-border-base bg-surface/76 p-6 backdrop-blur">
            <p className="text-base font-semibold">Link looks invalid.</p>
            <p className="text-sm leading-6 text-muted-2">
              We couldn't find that unsubscribe token. It might be expired or
              malformed. If you keep getting newsletters you don't want, reply
              to the last email and we'll remove you manually.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
