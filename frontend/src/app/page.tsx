"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  SearchItem,
  SESSION_TOKEN_KEY,
  clearStoredToken,
  getAccessToken,
  login,
  searchOutfit,
  signup,
} from "@/lib/api";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  products?: SearchItem[];
};

const SIMULATED_AGENT_LATENCY_MS = 2200;

const EXAMPLE_PRODUCTS: SearchItem[] = [
  {
    id: "example-shirt-1",
    title: "Washed Oxford Shirt",
    price: 118,
    currency: "USD",
    imageUrl:
      "https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=900&q=80",
    productUrl: "#",
    store: "J.Crew",
    score: 0.91,
  },
  {
    id: "example-trousers-1",
    title: "Pleated Cotton Chinos",
    price: 135,
    currency: "USD",
    imageUrl:
      "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80",
    productUrl: "#",
    store: "Brooks Brothers",
    score: 0.88,
  },
  {
    id: "example-shoes-1",
    title: "Leather Penny Loafers",
    price: 149,
    currency: "USD",
    imageUrl:
      "https://images.unsplash.com/photo-1614252369475-531eba835eb1?auto=format&fit=crop&w=900&q=80",
    productUrl: "#",
    store: "G.H. Bass",
    score: 0.9,
  },
  {
    id: "example-layer-1",
    title: "Navy Unstructured Blazer",
    price: 160,
    currency: "USD",
    imageUrl:
      "https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?auto=format&fit=crop&w=900&q=80",
    productUrl: "#",
    store: "Polo Ralph Lauren",
    score: 0.87,
  },
];

/**
 * Local cutouts in /public/cutouts (PNG). Reorder home-01…06 or replace files to change art direction.
 * Placement: outer gutters + corners only so the hero column stays visually protected.
 */
const HOMEPAGE_CUTOUTS: { id: string; src: string; className: string }[] = [
  {
    id: "cutout-1",
    src: "/cutouts/home-01.png",
    className:
      "left-[max(0.25rem,1.5vw)] top-[6%] h-[4.75rem] w-auto max-w-[min(22vw,9.5rem)] -rotate-[5deg] lg:h-[5.5rem]",
  },
  {
    id: "cutout-2",
    src: "/cutouts/home-02.png",
    className:
      "right-[max(0.25rem,1.5vw)] top-[8%] h-[4.25rem] w-auto max-w-[min(24vw,10rem)] rotate-[6deg] lg:h-[5rem]",
  },
  {
    id: "cutout-3",
    src: "/cutouts/home-03.png",
    className:
      "left-[max(0.5rem,2vw)] bottom-[22%] h-[6rem] w-auto max-w-[min(28vw,12rem)] rotate-[4deg] lg:bottom-[20%] lg:h-[6.75rem]",
  },
  {
    id: "cutout-4",
    src: "/cutouts/home-04.png",
    className:
      "right-[max(0.5rem,2.5vw)] bottom-[26%] h-[6.5rem] w-auto max-w-[min(26vw,11.5rem)] -rotate-[4deg] lg:bottom-[24%] lg:h-[7.25rem]",
  },
  {
    id: "cutout-5",
    src: "/cutouts/home-05.png",
    className:
      "left-[max(0.15rem,1vw)] bottom-[8%] h-[4.75rem] w-auto max-w-[min(32vw,13rem)] rotate-[3deg] lg:h-[5.25rem]",
  },
  {
    id: "cutout-6",
    src: "/cutouts/home-06.png",
    className:
      "right-[max(0.15rem,1vw)] bottom-[9%] h-[4.25rem] w-auto max-w-[min(34vw,14rem)] -rotate-[3deg] lg:h-[4.75rem]",
  },
];

function FloatingCutout({ src, className }: { src: string; className: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- decorative PNG cutouts from known CDN
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className={`pointer-events-none absolute z-[1] hidden select-none object-contain opacity-[0.92] drop-shadow-[0_14px_32px_rgba(24,23,21,0.09)] transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block ${className}`}
    />
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div
      className={`max-w-3xl rounded-[22px] border px-6 py-5 transition-colors duration-200 ${
        message.role === "user"
          ? "ml-auto border-stone-400 bg-[#ece6db] text-stone-900"
          : "border-muted-border bg-card text-stone-800"
      }`}
    >
      <p className="text-[0.97rem] leading-[1.7]">{message.text}</p>

      {message.products && message.products.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {message.products.map((item) => (
            <article
              key={item.id}
              className="group overflow-hidden rounded-[18px] border border-muted-border bg-[#faf7f1] transition-colors duration-200 hover:bg-[#f7f2e9]"
            >
              <div
                className="aspect-[4/5] bg-[#e9e3d8] bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.01]"
                style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
                aria-label={item.title}
              />
              <div className="space-y-2 p-4">
                <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{item.store}</p>
                <h3 className="font-editorial text-[1.36rem] leading-[1.2] text-stone-900">{item.title}</h3>
                <p className="text-[0.92rem] leading-[1.55] text-stone-700">
                  {item.currency} {item.price}
                </p>
                <p className="text-[0.86rem] leading-[1.5] text-stone-600">
                  {item.reason ??
                    "Works for this direction thanks to its clean silhouette and understated color balance."}
                </p>
                <a
                  href={item.productUrl}
                  className="inline-block pt-1 text-[10px] uppercase tracking-[0.14em] text-stone-900 transition-opacity duration-200 hover:opacity-70"
                  target="_blank"
                  rel="noreferrer"
                >
                  View piece
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [basePrompt, setBasePrompt] = useState("");
  const [awaitingFollowUp, setAwaitingFollowUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFullName, setAuthFullName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authPanel, setAuthPanel] = useState<"none" | "login" | "register">("none");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Hydrate auth state from sessionStorage after mount (avoids SSR/client mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time sync
    setToken(sessionStorage.getItem(SESSION_TOKEN_KEY));
  }, []);

  const hasConversationStarted = messages.some((message) => message.role === "user");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      await login(authEmail.trim(), authPassword);
      setToken(getAccessToken());
      setAuthPassword("");
      setAuthNotice(null);
      setAuthPanel("none");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign in failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const { message } = await signup(authEmail.trim(), authPassword, authFullName);
      setAuthNotice(message);
      setAuthPanel("login");
      setAuthError(null);
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Registration failed");
    } finally {
      setAuthBusy(false);
    }
  }

  function handleSignOut() {
    clearStoredToken();
    setToken(null);
  }

  async function runSearchWithFollowUp(followUpAnswer: string) {
    const combinedPrompt = `${basePrompt}\nFollow-up: ${followUpAnswer}`;

    setLoading(true);
    try {
      if (!getAccessToken()) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "Sign in with your Closer account (Log in, top right) to load live outfit results from the backend.",
          },
        ]);
        setLoading(false);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, SIMULATED_AGENT_LATENCY_MS));
      const response = await searchOutfit(combinedPrompt, {
        budgetTier: "all",
        includeHistory: true,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I prioritized pieces that preserve the East Coast tailored ease, then balanced them for versatility and price coherence.",
        },
        {
          role: "assistant",
          text: "Here are the strongest matches.",
          products: response.items,
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Could not load live results (${message}). Showing a curated preview instead.`,
        },
        {
          role: "assistant",
          text: "Preview",
          products: EXAMPLE_PRODUCTS,
        },
      ]);
    }
    setLoading(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");

    if (!awaitingFollowUp) {
      setBasePrompt(trimmed);
      setAwaitingFollowUp(true);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Do you want this more casual or sharper? You can include constraints like budget directly here.",
        },
      ]);
      return;
    }

    setAwaitingFollowUp(false);
    await runSearchWithFollowUp(trimmed);
  }

  const composer = (isLanding: boolean) => (
    <div className={`w-full ${isLanding ? "max-w-3xl" : "max-w-2xl"}`}>
      <div
        className={`rounded-full border border-stone-300/80 bg-[#faf7f1] p-3.5 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:shadow-[0_14px_34px_rgba(24,23,21,0.12)] ${
          isLanding ? "shadow-[0_18px_38px_rgba(24,23,21,0.08)]" : "shadow-[0_8px_18px_rgba(24,23,21,0.06)]"
        }`}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="I want JFK Jr. style for spring in New York..."
          className="min-h-12 w-full resize-none bg-transparent px-3 text-[1rem] leading-[1.65] text-stone-900 outline-none placeholder:text-stone-500"
        />
        <div className="mt-2 flex justify-end pr-1">
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="rounded-full border border-stone-900 px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-stone-900 transition-colors duration-200 hover:bg-stone-900 hover:text-[#f7f3ec] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-stone-900"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <main className="relative z-10 mx-auto flex h-[100dvh] w-full max-w-6xl flex-col px-6 py-8">
      {/* Full-viewport sky above html bg; fades when chat starts */}
      <div
        className={`cloud-sky-backdrop fixed inset-0 z-[1] pointer-events-none transition-opacity duration-[720ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          hasConversationStarted ? "opacity-0" : "opacity-100"
        }`}
        aria-hidden
      />
      <header className="relative z-[2] mb-4 flex w-full shrink-0 items-center justify-between border-b border-muted-border/80 bg-transparent pb-4 backdrop-blur-[2px]">
        <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">
          {token ? "Signed in" : "Closer"}
        </p>
        <div className="flex items-center gap-2">
          {token ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-full border border-stone-400 px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-stone-700 transition hover:bg-stone-200/60"
            >
              Sign out
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setAuthPanel("login");
                  setAuthError(null);
                  setAuthNotice(null);
                }}
                className="rounded-full border border-stone-300 bg-[#faf7f1]/80 px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-stone-800 transition hover:border-stone-500"
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthPanel("register");
                  setAuthError(null);
                  setAuthNotice(null);
                }}
                className="rounded-full border border-stone-900 bg-stone-900 px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-[#faf7f1] transition hover:bg-stone-800"
              >
                Register
              </button>
            </>
          )}
        </div>
      </header>

      {authPanel !== "none" && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/25 p-4 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-label={authPanel === "login" ? "Log in" : "Register"}
          onClick={() => setAuthPanel("none")}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-muted-border bg-[#fbf8f2] p-6 shadow-[0_20px_50px_rgba(24,23,21,0.12)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-editorial text-xl text-stone-900">
                {authPanel === "login" ? "Log in" : "Create account"}
              </h2>
              <button
                type="button"
                onClick={() => setAuthPanel("none")}
                className="text-sm text-stone-500 transition hover:text-stone-800"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {authPanel === "login" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-3">
                {authNotice && (
                  <p className="rounded-lg border border-stone-200 bg-stone-100/80 px-3 py-2 text-sm text-stone-700">
                    {authNotice}
                  </p>
                )}
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="rounded-xl border border-stone-300 bg-[#faf7f1] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="rounded-xl border border-stone-300 bg-[#faf7f1] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                {authError && <p className="text-sm text-red-800/90">{authError}</p>}
                <button
                  type="submit"
                  disabled={authBusy || !authEmail.trim() || !authPassword}
                  className="mt-1 rounded-full border border-stone-900 bg-stone-900 py-2.5 text-[10px] uppercase tracking-[0.14em] text-[#faf7f1] disabled:opacity-45"
                >
                  {authBusy ? "…" : "Continue"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-3">
                <input
                  type="text"
                  autoComplete="name"
                  placeholder="Full name (optional)"
                  value={authFullName}
                  onChange={(e) => setAuthFullName(e.target.value)}
                  className="rounded-xl border border-stone-300 bg-[#faf7f1] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="rounded-xl border border-stone-300 bg-[#faf7f1] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Password (min 8 characters)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="rounded-xl border border-stone-300 bg-[#faf7f1] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                {authError && <p className="text-sm text-red-800/90">{authError}</p>}
                <p className="text-xs text-stone-500">
                  After registering, you may need to confirm email before logging in. Then use Log in.
                </p>
                <button
                  type="submit"
                  disabled={authBusy || !authEmail.trim() || !authPassword || authPassword.length < 8}
                  className="mt-1 rounded-full border border-stone-900 bg-stone-900 py-2.5 text-[10px] uppercase tracking-[0.14em] text-[#faf7f1] disabled:opacity-45"
                >
                  {authBusy ? "…" : "Create account"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <form id="style-chat-form" onSubmit={onSubmit} className="relative z-[2] min-h-0 flex-1 overflow-hidden">
        <section
          className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            hasConversationStarted ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100"
          }`}
          aria-hidden={hasConversationStarted}
        >
          {HOMEPAGE_CUTOUTS.map((cutout) => (
            <FloatingCutout key={cutout.id} src={cutout.src} className={cutout.className} />
          ))}

          <div className="relative z-10 mx-auto flex h-full max-w-3xl flex-col items-center justify-center px-2 text-center">
            <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Closer.ai</p>
            <h1 className="font-editorial mt-6 text-[2.9rem] leading-[1.03] text-stone-900 md:text-[3.6rem]">
              Style direction, translated into pieces you can buy now.
            </h1>
            <p className="mt-5 max-w-xl text-[0.98rem] leading-[1.65] text-stone-600">
              Calm, curated recommendations for the look you want to build.
            </p>
            <div className="mt-10 w-full">{composer(true)}</div>
          </div>
        </section>

        <section
          className={`absolute inset-0 flex min-h-0 flex-col transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            hasConversationStarted ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto pb-44 pr-1 pt-2">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
              {messages.map((message, index) => (
                <MessageBubble key={`${message.role}-${index}`} message={message} />
              ))}
              {loading && (
                <div className="max-w-3xl rounded-[22px] border border-muted-border bg-card px-6 py-4 text-[0.9rem] text-stone-600">
                  Thinking through your direction...
                </div>
              )}
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 border-t border-muted-border/80 bg-[linear-gradient(to_top,#f7f3ec_68%,transparent)] px-6 pb-8 pt-5">
            <div className="mx-auto w-full max-w-4xl">{composer(false)}</div>
          </div>
        </section>
      </form>
    </main>
  );
}
