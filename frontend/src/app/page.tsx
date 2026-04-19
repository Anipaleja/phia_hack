"use client";

import { FormEvent, MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SearchItem,
  SESSION_TOKEN_KEY,
  clearStoredToken,
  getAccessToken,
  login,
  searchOutfit,
  signup,
} from "@/lib/api";

function buildExampleImageUrl(label: string): string {
  const safeLabel = label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">
      <rect width="800" height="1000" fill="#e9e3d8"/>
      <rect x="44" y="44" width="712" height="912" rx="40" fill="#f7f3ec" stroke="#b8afa2" stroke-width="2"/>
      <text x="400" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="40" fill="#544d45">${safeLabel}</text>
      <text x="400" y="535" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#7a6f63">Source image unavailable</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  products?: SearchItem[];
  /** When true (assistant + products), show blurred teaser grid with sign-in CTA instead of plain text. */
  lockedPreview?: boolean;
};

type SavedChatSession = {
  id: string;
  createdAt: number;
  messages: ChatMessage[];
  basePrompt: string;
  awaitingFollowUp: boolean;
};

const STYLE_CHAT_FORM_ID = "style-chat-form";

const CHAT_HISTORY_KEY = "closer_chat_history_v1";
const MAX_SAVED_SESSIONS = 30;

const SIMULATED_AGENT_LATENCY_MS = 2200;

const EXAMPLE_PRODUCTS: SearchItem[] = [
  {
    id: "example-shirt-1",
    title: "Washed Oxford Shirt",
    price: 118,
    currency: "USD",
    imageUrl: buildExampleImageUrl("Washed Oxford Shirt"),
    productUrl: "#",
    store: "J.Crew",
    score: 0.91,
  },
  {
    id: "example-trousers-1",
    title: "Pleated Cotton Chinos",
    price: 135,
    currency: "USD",
    imageUrl: buildExampleImageUrl("Pleated Cotton Chinos"),
    productUrl: "#",
    store: "Brooks Brothers",
    score: 0.88,
  },
  {
    id: "example-shoes-1",
    title: "Leather Penny Loafers",
    price: 149,
    currency: "USD",
    imageUrl: buildExampleImageUrl("Leather Penny Loafers"),
    productUrl: "#",
    store: "G.H. Bass",
    score: 0.9,
  },
  {
    id: "example-layer-1",
    title: "Navy Unstructured Blazer",
    price: 160,
    currency: "USD",
    imageUrl: buildExampleImageUrl("Navy Unstructured Blazer"),
    productUrl: "#",
    store: "Polo Ralph Lauren",
    score: 0.87,
  },
];

/**
 * Local cutouts in /public/cutouts (PNG). Reorder home-01…06 or replace files to change art direction.
 * Placement: outer gutters + corners only so the hero column stays visually protected.
 */
const HOMEPAGE_CUTOUTS: {
  id: string;
  src: string;
  wrapClass: string;
  imgClass: string;
  driftMs: number;
}[] = [
  {
    id: "cutout-1",
    src: "/cutouts/home-01.png",
    wrapClass: "left-[max(0.25rem,1.5vw)] top-[6%] h-[8.5rem] lg:h-[10rem]",
    imgClass: "max-w-[min(36vw,16.5rem)] -rotate-[5deg]",
    driftMs: 7000,
  },
  {
    id: "cutout-2",
    src: "/cutouts/home-02.png",
    wrapClass: "right-[max(0.25rem,1.5vw)] top-[8%] h-[7.5rem] lg:h-[9rem]",
    imgClass: "max-w-[min(38vw,17.5rem)] rotate-[6deg]",
    driftMs: 8200,
  },
  {
    id: "cutout-3",
    src: "/cutouts/home-03.png",
    wrapClass: "left-[max(0.5rem,2vw)] bottom-[22%] h-[10.5rem] lg:bottom-[20%] lg:h-[12rem]",
    imgClass: "max-w-[min(44vw,20.5rem)] rotate-[4deg]",
    driftMs: 6500,
  },
  {
    id: "cutout-4",
    src: "/cutouts/home-04.png",
    wrapClass: "right-[max(0.5rem,2.5vw)] bottom-[26%] h-[11.5rem] lg:bottom-[24%] lg:h-[13rem]",
    imgClass: "max-w-[min(42vw,20rem)] -rotate-[4deg]",
    driftMs: 9000,
  },
  {
    id: "cutout-5",
    src: "/cutouts/home-05.png",
    wrapClass: "left-[max(0.15rem,1vw)] bottom-[8%] h-[8.5rem] lg:h-[9.75rem]",
    imgClass: "max-w-[min(48vw,22rem)] rotate-[3deg]",
    driftMs: 7600,
  },
  {
    id: "cutout-6",
    src: "/cutouts/home-06.png",
    wrapClass: "right-[max(0.15rem,1vw)] bottom-[9%] h-[7.5rem] lg:h-[8.75rem]",
    imgClass: "max-w-[min(50vw,23rem)] -rotate-[3deg]",
    driftMs: 6800,
  },
];

function FloatingCutout({
  src,
  wrapClass,
  imgClass,
  driftMs,
  delayMs,
}: {
  src: string;
  wrapClass: string;
  imgClass: string;
  driftMs: number;
  delayMs: number;
}) {
  return (
    <div
      className={`pointer-events-none absolute z-[1] hidden w-auto lg:block ${wrapClass}`}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative PNG cutouts */}
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          animation: `cutout-drift ${driftMs}ms ease-in-out infinite`,
          animationDelay: `${delayMs}ms`,
        }}
        className={`motion-cutout h-full w-auto select-none object-contain opacity-[0.92] drop-shadow-[0_14px_32px_rgba(24,23,21,0.09)] ${imgClass}`}
      />
    </div>
  );
}

function LockedRecommendationsPreview({
  products,
  onOpenLogin,
}: {
  products: SearchItem[];
  onOpenLogin: () => void;
}) {
  const preview = products.slice(0, 6);

  return (
    <div
      className="relative overflow-hidden rounded-[18px] border border-muted-border bg-[#f4efe6]"
      role="status"
      aria-label="Your outfit recommendations are ready. Sign in to view details."
    >
      <div className="grid grid-cols-3 gap-px bg-stone-300/80">
        {preview.map((item) => (
          <div key={item.id} className="relative aspect-[4/5] overflow-hidden bg-[#e9e3d8]">
            <div
              className="h-full w-full scale-110 bg-cover bg-center blur-md"
              style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
              aria-hidden
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-900/25 to-transparent" />
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-900/[0.12] p-4 backdrop-blur-[2px]">
        <div className="pointer-events-auto max-w-[min(100%,20rem)] rounded-2xl border border-stone-200/90 bg-[#fbf8f2]/95 px-6 py-5 text-center shadow-[0_18px_38px_rgba(24,23,21,0.12)]">
          <p className="font-editorial text-[1.15rem] leading-snug text-stone-900">Your picks are ready</p>
          <p className="mt-2 text-[0.88rem] leading-[1.55] text-stone-600">
            Sign in to load live outfit results and reveal pieces tailored to you.
          </p>
          <button
            type="button"
            onClick={onOpenLogin}
            className="mt-4 w-full rounded-full border border-stone-900 bg-stone-900 py-2.5 text-[10px] uppercase tracking-[0.14em] text-[#faf7f1] transition hover:bg-stone-800"
          >
            Log in
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onOpenLogin,
}: {
  message: ChatMessage;
  onOpenLogin?: () => void;
}) {
  const isLockedPreview =
    message.role === "assistant" && message.lockedPreview && message.products && message.products.length > 0;

  return (
    <div
      className={`max-w-3xl rounded-[22px] border px-6 py-5 transition-colors duration-200 ${
        message.role === "user"
          ? "ml-auto border-stone-400 bg-[#ece6db] text-stone-900"
          : "border-muted-border bg-card text-stone-800"
      }`}
    >
      {isLockedPreview ? (
        <LockedRecommendationsPreview
          products={message.products!}
          onOpenLogin={onOpenLogin ?? (() => {})}
        />
      ) : (
        <>
          <p className="text-[0.97rem] leading-[1.7]">{message.text}</p>

          {message.products && message.products.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                    {item.productUrl ? (
                      <a
                        href={item.productUrl}
                        className="inline-block pt-1 text-[10px] uppercase tracking-[0.14em] text-stone-900 transition-opacity duration-200 hover:opacity-70"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open product page
                      </a>
                    ) : (
                      <p className="pt-1 text-[10px] uppercase tracking-[0.14em] text-stone-500">
                        Live product link unavailable
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function loadChatHistory(): SavedChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistChatHistory(sessions: SavedChatSession[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sessions.slice(0, MAX_SAVED_SESSIONS)));
  } catch {
    // storage full or disabled
  }
}

function appendChatSession(session: SavedChatSession) {
  const prev = loadChatHistory();
  const withoutDup = prev.filter((s) => s.id !== session.id);
  persistChatHistory([session, ...withoutDup]);
}

function removeChatSessionFromStorage(id: string) {
  const next = loadChatHistory().filter((s) => s.id !== id);
  persistChatHistory(next);
}

function formatSessionWhen(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function firstUserPreview(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = first?.text?.trim() ?? "Chat";
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
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
  const [chatHistory, setChatHistory] = useState<SavedChatSession[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const landingComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const [landingComposerFocused, setLandingComposerFocused] = useState(false);

  const hasConversationStarted = messages.some((message) => message.role === "user");
  /** True after user focuses the landing field and types (fixed viewport center; avoids transform ancestors). */
  const isLandingComposerCentered = landingComposerFocused && input.trim().length > 0;

  useEffect(() => {
    // Hydrate auth state from sessionStorage after mount (avoids SSR/client mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time sync
    setToken(sessionStorage.getItem(SESSION_TOKEN_KEY));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time sync
    setChatHistory(loadChatHistory());
  }, []);

  useLayoutEffect(() => {
    if (!isLandingComposerCentered) return;
    const ta = landingComposerRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    try {
      ta.setSelectionRange(len, len);
    } catch {
      // selection not supported for this input type in some environments
    }
  }, [isLandingComposerCentered]);

  function goHome() {
    if (hasConversationStarted) {
      appendChatSession({
        id: sessionIdRef.current ?? crypto.randomUUID(),
        createdAt: Date.now(),
        messages: [...messages],
        basePrompt,
        awaitingFollowUp,
      });
      setChatHistory(loadChatHistory());
    }
    sessionIdRef.current = null;
    setMessages([]);
    setBasePrompt("");
    setAwaitingFollowUp(false);
    setInput("");
    setLoading(false);
    setLandingComposerFocused(false);
  }

  function restoreSession(session: SavedChatSession) {
    sessionIdRef.current = session.id;
    setMessages(session.messages);
    setBasePrompt(session.basePrompt);
    setAwaitingFollowUp(session.awaitingFollowUp);
    setInput("");
    setLoading(false);
    setLandingComposerFocused(false);
  }

  function handleDeleteSession(sessionId: string, event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    removeChatSessionFromStorage(sessionId);
    setChatHistory(loadChatHistory());
    if (sessionIdRef.current === sessionId) {
      sessionIdRef.current = null;
      setMessages([]);
      setBasePrompt("");
      setAwaitingFollowUp(false);
      setInput("");
      setLoading(false);
      setLandingComposerFocused(false);
    }
  }

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

  async function runSearchWithFollowUp(combinedPrompt: string) {

    setLoading(true);
    try {
      if (!getAccessToken()) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: "Please log in to view live product matches with real price, product image, and product link.",
          },
        ]);
        setAuthPanel("login");
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
          text: `Could not load live results (${message}). Please try a more specific prompt.`,
        },
      ]);
    }
    setLoading(false);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    if (!sessionIdRef.current) {
      sessionIdRef.current = crypto.randomUUID();
    }

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    const composedPrompt = basePrompt
      ? [basePrompt, trimmed].filter(Boolean).join("\nFollow-up: ")
      : trimmed;

    if (!basePrompt) {
      setBasePrompt(trimmed);
    }

    await runSearchWithFollowUp(composedPrompt);
  }

  const composer = (isLanding: boolean) => (
    <div className={`w-full ${isLanding ? "max-w-3xl" : "max-w-2xl"}`}>
      <div
        className={`rounded-full border border-stone-300/80 bg-[#faf7f1] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] focus-within:shadow-[0_14px_34px_rgba(24,23,21,0.12)] ${
          isLanding
            ? "px-5 py-4 shadow-[0_18px_38px_rgba(24,23,21,0.08)] sm:px-6 sm:py-4"
            : "p-3.5 shadow-[0_8px_18px_rgba(24,23,21,0.06)]"
        }`}
      >
        <div
          className={`flex w-full min-w-0 ${isLanding ? "items-center gap-3 sm:gap-4" : "flex-col gap-2"}`}
        >
          <textarea
            ref={isLanding ? landingComposerRef : undefined}
            form={STYLE_CHAT_FORM_ID}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onFocus={() => {
              if (isLanding) setLandingComposerFocused(true);
            }}
            onBlur={() => {
              if (isLanding) setLandingComposerFocused(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const formEl = document.getElementById(STYLE_CHAT_FORM_ID);
                if (formEl instanceof HTMLFormElement) formEl.requestSubmit();
              }
            }}
            placeholder="I want JFK Jr. style for spring in New York..."
            className={`w-full min-w-0 flex-1 resize-none bg-transparent text-[1rem] leading-[1.65] text-stone-900 outline-none placeholder:text-stone-500 ${
              isLanding
                ? "min-h-[4.25rem] py-1.5 pl-0.5 pr-1 sm:py-2"
                : "min-h-12 px-3 py-2"
            }`}
          />
          <div className={`flex shrink-0 ${isLanding ? "" : "justify-end pr-1 pt-0.5"}`}>
            <button
              type="submit"
              form={STYLE_CHAT_FORM_ID}
              disabled={loading || !input.trim()}
              onMouseDown={(event) => {
                if (isLanding) event.preventDefault();
              }}
              className="rounded-full border border-stone-900 px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-stone-900 transition-colors duration-200 hover:bg-stone-900 hover:text-[#f7f3ec] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-stone-900"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <main className="relative z-10 mx-auto flex h-[100dvh] min-h-0 w-full max-w-6xl flex-col px-6 py-4 sm:py-6">
      {/* Full-viewport sky above html bg; fades when chat starts */}
      <div
        className={`cloud-sky-backdrop fixed inset-0 z-[1] pointer-events-none transition-opacity duration-[720ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          hasConversationStarted ? "opacity-0" : "opacity-100"
        }`}
        aria-hidden
      />
      <header className="relative z-[2] mb-4 flex w-full shrink-0 items-center justify-between border-b border-muted-border/80 bg-transparent pb-4 backdrop-blur-[2px]">
        <div className="flex min-w-0 items-center gap-3">
          {hasConversationStarted ? (
            <button
              type="button"
              onClick={goHome}
              className="shrink-0 rounded-full border border-stone-400 bg-[#faf7f1]/90 px-4 py-2 text-[10px] uppercase tracking-[0.14em] text-stone-800 transition hover:border-stone-600 hover:bg-stone-200/50"
              aria-label="Close chat and return home"
            >
              Close
            </button>
          ) : null}
          <p className="min-w-0 truncate text-[10px] uppercase tracking-[0.18em] text-stone-500">
            {token ? "Signed in" : "Closer"}
          </p>
        </div>
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

      <form id={STYLE_CHAT_FORM_ID} onSubmit={onSubmit} className="relative z-[2] min-h-0 flex-1 overflow-hidden">
        <section
          className={`absolute inset-0 overflow-x-hidden overflow-y-hidden transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            hasConversationStarted ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
          aria-hidden={hasConversationStarted}
        >
          {HOMEPAGE_CUTOUTS.map((cutout, index) => (
            <FloatingCutout
              key={cutout.id}
              src={cutout.src}
              wrapClass={cutout.wrapClass}
              imgClass={cutout.imgClass}
              driftMs={cutout.driftMs}
              delayMs={index * 140}
            />
          ))}

          <div className="relative z-10 mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col items-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-3 text-center sm:pt-4">
            <p className="hero-enter-1 text-[10px] uppercase tracking-[0.24em] text-stone-500">
              Closer.ai
            </p>
            <h1 className="hero-enter-2 font-editorial mt-3 text-[2.35rem] leading-[1.03] text-stone-900 sm:mt-4 md:text-[3.6rem]">
              Turn a style icon into a wardrobe you can actually shop.
            </h1>
            <p className="hero-enter-3 mt-3 max-w-xl text-[0.98rem] leading-[1.65] text-stone-600 sm:mt-4">
              Name a muse or icon whose look you want, and we translate that style into real pieces you can buy, tuned to you.
            </p>
            {chatHistory.length > 0 && (
              <div className="mt-4 flex min-h-0 w-full max-w-3xl flex-1 flex-col text-left">
                <p className="shrink-0 text-[10px] uppercase tracking-[0.2em] text-stone-500">Previous chats</p>
                <ul className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain pr-1 [scrollbar-gutter:stable]">
                  {chatHistory.map((session) => (
                    <li key={session.id} className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => restoreSession(session)}
                        className="min-w-0 flex-1 rounded-2xl border border-stone-300/80 bg-[#faf7f1]/90 px-4 py-3 text-left transition hover:border-stone-500 hover:bg-[#f4efe6]"
                      >
                        <span className="line-clamp-1 block font-editorial text-[1.05rem] leading-snug text-stone-900">
                          {firstUserPreview(session.messages)}
                        </span>
                        <span className="mt-1 block text-[10px] uppercase tracking-[0.12em] text-stone-500">
                          {formatSessionWhen(session.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className="shrink-0 self-stretch rounded-2xl border border-stone-300/80 bg-[#faf7f1]/90 px-3 text-sm text-stone-500 transition hover:border-red-300/80 hover:bg-red-50/90 hover:text-red-800"
                        aria-label="Delete this chat"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Centered state is portaled to document.body so position is truly viewport-centered (no transform ancestors). */}
            {typeof document !== "undefined" &&
              isLandingComposerCentered &&
              createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6">
                  <div
                    className="landing-composer-backdrop-enter absolute inset-0 bg-stone-900/15"
                    aria-hidden
                    onMouseDown={(e) => {
                      e.preventDefault();
                      landingComposerRef.current?.blur();
                    }}
                  />
                  <div className="landing-composer-sheet-enter relative z-10 w-full max-w-3xl shrink-0">
                    {composer(true)}
                  </div>
                </div>,
                document.body
              )}
            {!isLandingComposerCentered && (
              <div className="relative mt-6 w-full shrink-0 sm:mt-7">
                <div className="relative z-10 mx-auto flex min-h-[6rem] w-full max-w-3xl items-end justify-center sm:min-h-[6.5rem]">
                  <div className="w-full">{composer(true)}</div>
                </div>
              </div>
            )}
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
                <MessageBubble
                  key={`${message.role}-${index}`}
                  message={message}
                  onOpenLogin={() => {
                    setAuthPanel("login");
                    setAuthError(null);
                    setAuthNotice(null);
                  }}
                />
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
