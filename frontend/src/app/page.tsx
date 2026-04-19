"use client";

import { ChangeEvent, FormEvent, MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { deriveRecommendationLayout, RecommendationExperience } from "@/components/recommendation-experience";
import { createPortal } from "react-dom";
import {
  CelebrityLookalikeResponse,
  LookalikeGender,
  SearchItem,
  SESSION_TOKEN_KEY,
  clearStoredToken,
  findCelebrityLookalike,
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
const MIN_LOADING_MS = 5000;
const LOOKALIKE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const LOOKALIKE_ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const FUNNY_LOADING_LINES = [
  "Asking a very opinionated mannequin for final approval...",
  "Steam-pressing pixels so this fit lands crisp...",
  "Cross-checking vibes against the laws of tailoring...",
  "Trying on 47 outfits in another tab. Brb...",
  "Making sure this doesn't look like your ex's Pinterest board...",
  "Summoning the style committee and muting their group chat...",
];

const PRESET_PROMPT_BUTTONS = [
  {
    label: "Old money date night",
    prompt: "Old money date-night look under $300 with one statement piece.",
  },
  {
    label: "Rihanna x Zendaya mix",
    prompt: "Mix Rihanna and Zendaya style for a clean night-out outfit.",
  },
  {
    label: "Office but cool",
    prompt: "Modern office outfit that still feels cool and not too corporate.",
  },
  {
    label: "Quiet luxury weekend",
    prompt: "Quiet luxury weekend capsule in neutral tones, minimal logos.",
  },
  {
    label: "Streetwear refresh",
    prompt: "Streetwear refresh with strong sneakers and layered textures.",
  },
];

function toConfidencePercent(value: number): string {
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  const bounded = Math.max(0, Math.min(1, Number.isFinite(normalized) ? normalized : 0));
  return `${Math.round(bounded * 100)}%`;
}

function getCelebrityInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((token) => token[0]?.toUpperCase() || "")
    .join("");
}

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
    wrapClass: "left-[52%] top-[11%] hidden h-[6.25rem] lg:block xl:h-[7rem] 2xl:h-[7.5rem]",
    imgClass: "max-w-[min(36vw,16.5rem)] -rotate-[5deg]",
    driftMs: 7000,
  },
  {
    id: "cutout-2",
    src: "/cutouts/home-02.png",
    wrapClass: "left-[58%] top-[22%] hidden h-[6rem] lg:block xl:h-[6.75rem] 2xl:h-[7.25rem]",
    imgClass: "max-w-[min(38vw,17.5rem)] rotate-[6deg]",
    driftMs: 8200,
  },
  {
    id: "cutout-3",
    src: "/cutouts/home-03.png",
    wrapClass: "left-[50.5%] top-[38%] hidden h-[7.25rem] lg:block xl:h-[8.5rem] 2xl:h-[9rem]",
    imgClass: "max-w-[min(44vw,20.5rem)] rotate-[4deg]",
    driftMs: 6500,
  },
  {
    id: "cutout-4",
    src: "/cutouts/home-04.png",
    wrapClass: "left-[57.5%] top-[48%] hidden h-[7rem] lg:block xl:h-[8.25rem] 2xl:h-[8.75rem]",
    imgClass: "max-w-[min(42vw,20rem)] -rotate-[4deg]",
    driftMs: 9000,
  },
  {
    id: "cutout-5",
    src: "/cutouts/home-05.png",
    wrapClass: "left-[52%] top-[63%] hidden h-[5.5rem] lg:block xl:h-[6.5rem] 2xl:h-[7rem]",
    imgClass: "max-w-[min(48vw,22rem)] rotate-[3deg]",
    driftMs: 7600,
  },
  {
    id: "cutout-6",
    src: "/cutouts/home-06.png",
    wrapClass: "left-[58%] top-[73%] hidden h-[5rem] lg:block xl:h-[5.75rem] 2xl:h-[6.25rem]",
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
      className="relative overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#ece9e2]"
      role="status"
      aria-label="Your outfit recommendations are ready. Sign in to view details."
    >
      <div className="grid grid-cols-3 gap-px bg-[rgba(37,35,33,0.12)]">
        {preview.map((item) => (
          <div key={item.id} className="relative aspect-[4/5] overflow-hidden bg-[#ddd8d0]">
            <div
              className="h-full w-full scale-110 bg-cover bg-center blur-md"
              style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
              aria-hidden
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-stone-900/25 to-transparent" />
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-900/[0.08] p-4 backdrop-blur-[2px]">
        <div className="pointer-events-auto max-w-[min(100%,20rem)] border border-[rgba(37,35,33,0.15)] bg-[#f4f1ea]/95 px-6 py-5 text-left">
          <p className="font-editorial text-[1.08rem] leading-[1.05] tracking-[-0.02em] text-stone-900">
            Your picks are ready
          </p>
          <p className="mt-2 text-[0.82rem] leading-[1.55] text-stone-600">
            Sign in to load live outfit results and reveal pieces tailored to you.
          </p>
          <button
            type="button"
            onClick={onOpenLogin}
            className="mt-4 w-full border border-stone-900/85 bg-stone-900 py-2.5 text-[10px] uppercase tracking-[0.16em] text-[#f3efe8] transition hover:bg-stone-800"
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
  isSignedIn,
}: {
  message: ChatMessage;
  onOpenLogin?: () => void;
  isSignedIn?: boolean;
}) {
  const isLockedPreview =
    message.role === "assistant" &&
    message.lockedPreview &&
    message.products &&
    message.products.length > 0 &&
    !isSignedIn;

  return (
    <div
      className={`max-w-3xl border px-5 py-4 transition-colors duration-200 sm:px-6 ${
        message.role === "user"
          ? "ml-auto border-[rgba(37,35,33,0.18)] bg-[#e7e3db] text-stone-900"
          : "border-[rgba(37,35,33,0.12)] bg-[#f3f0ea] text-stone-800"
      }`}
    >
      {isLockedPreview ? (
        <LockedRecommendationsPreview products={message.products!} onOpenLogin={onOpenLogin ?? (() => {})} />
      ) : (
        <>
          {message.text ? <p className="text-[0.97rem] leading-[1.7]">{message.text}</p> : null}

          {message.products && message.products.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {message.products.map((item) => (
                <article
                  key={item.id}
                  className="group overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#f3f0ea] transition-colors duration-200 hover:bg-[#efebe4]"
                >
                  <div
                    className="aspect-[4/5] bg-[#ddd8d0] bg-cover bg-center transition-transform duration-300 group-hover:scale-[1.01]"
                    style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
                    aria-label={item.title}
                  />
                  <div className="space-y-2 p-4">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">{item.store}</p>
                    <h3 className="font-editorial text-[1.28rem] leading-[1.08] tracking-[-0.02em] text-stone-900">
                      {item.title}
                    </h3>
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
  const [activeTopTab, setActiveTopTab] = useState<"stylist" | "lookalike">("stylist");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [basePrompt, setBasePrompt] = useState("");
  const [awaitingFollowUp, setAwaitingFollowUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingLine, setLoadingLine] = useState(FUNNY_LOADING_LINES[0]);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authFullName, setAuthFullName] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authPanel, setAuthPanel] = useState<"none" | "login" | "register">("none");
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [lookalikeGender, setLookalikeGender] = useState<LookalikeGender | null>(null);
  const [lookalikeImageDataUrl, setLookalikeImageDataUrl] = useState<string | null>(null);
  const [lookalikeImageName, setLookalikeImageName] = useState("");
  const [lookalikeResult, setLookalikeResult] = useState<CelebrityLookalikeResponse | null>(null);
  const [lookalikeError, setLookalikeError] = useState<string | null>(null);
  const [lookalikeLoading, setLookalikeLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<SavedChatSession[]>([]);
  const sessionIdRef = useRef<string | null>(null);
  const landingComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const lookalikeFileRef = useRef<HTMLInputElement | null>(null);
  const followUpThreadScrollRef = useRef<HTMLDivElement | null>(null);
  const [landingComposerFocused, setLandingComposerFocused] = useState(false);
  const [clientMounted, setClientMounted] = useState(false);
  const loadingTickerRef = useRef<number | null>(null);

  const hasConversationStarted = messages.some((message) => message.role === "user");
  /** Center composer only for the very first prompt on landing (never on follow-ups). */
  const isLandingComposerCentered =
    !hasConversationStarted && landingComposerFocused && input.trim().length > 0;

  const recLayout = useMemo(() => deriveRecommendationLayout(messages), [messages]);
  const isFollowUpThread = recLayout.followUpQueries.length > 0;

  useEffect(() => {
    // Hydrate auth state from sessionStorage after mount (avoids SSR/client mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time sync
    setToken(sessionStorage.getItem(SESSION_TOKEN_KEY));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time sync
    setChatHistory(loadChatHistory());
  }, []);

  useEffect(() => {
    setClientMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (loadingTickerRef.current !== null) {
        window.clearInterval(loadingTickerRef.current);
      }
    };
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

  useEffect(() => {
    if (!isFollowUpThread) return;
    const el = followUpThreadScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [isFollowUpThread, messages, loading]);

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
    if (loadingTickerRef.current !== null) {
      window.clearInterval(loadingTickerRef.current);
      loadingTickerRef.current = null;
    }
    setLandingComposerFocused(false);
  }

  function startLoadingTicker() {
    if (loadingTickerRef.current !== null) {
      window.clearInterval(loadingTickerRef.current);
      loadingTickerRef.current = null;
    }

    const shuffled = [...FUNNY_LOADING_LINES].sort(() => Math.random() - 0.5);
    let idx = 0;
    setLoadingLine(shuffled[idx]);

    loadingTickerRef.current = window.setInterval(() => {
      idx = (idx + 1) % shuffled.length;
      setLoadingLine(shuffled[idx]);
    }, 1150);
  }

  async function ensureMinimumLoadingTime(startedAtMs: number) {
    const elapsed = Date.now() - startedAtMs;
    if (elapsed >= MIN_LOADING_MS) {
      return;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, MIN_LOADING_MS - elapsed);
    });
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
    const email = authEmail.trim();
    if (!email) {
      setAuthError("Email is required.");
      return;
    }
    if (!authPassword) {
      setAuthError("Password is required.");
      return;
    }
    setAuthBusy(true);
    try {
      await login(email, authPassword);
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
    const email = authEmail.trim();
    if (!email) {
      setAuthError("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError("Enter a valid email address.");
      return;
    }
    if (authPassword.length < 8) {
      setAuthError("Password must be at least 8 characters.");
      return;
    }
    setAuthBusy(true);
    try {
      const { message } = await signup(email, authPassword, authFullName);
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

  function applyPresetPrompt(prompt: string) {
    if (loading) {
      return;
    }

    setInput(prompt);
    if (!hasConversationStarted) {
      setLandingComposerFocused(true);
      window.requestAnimationFrame(() => {
        const ta = landingComposerRef.current;
        if (!ta) return;
        ta.focus();
        const len = ta.value.length;
        try {
          ta.setSelectionRange(len, len);
        } catch {
          // selection not supported for this input type in some environments
        }
      });
    }
  }

  async function handleLookalikeImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setLookalikeError(null);

    if (!lookalikeGender) {
      setLookalikeError("Select gender first.");
      event.target.value = "";
      return;
    }

    if (!LOOKALIKE_ALLOWED_MIME_TYPES.has(file.type)) {
      setLookalikeError("Use a JPEG, PNG, or WEBP image.");
      event.target.value = "";
      return;
    }

    if (file.size > LOOKALIKE_MAX_IMAGE_BYTES) {
      setLookalikeError("Image must be 5MB or smaller.");
      event.target.value = "";
      return;
    }

    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          resolve(result);
        };
        reader.onerror = () => reject(new Error("Could not read image file."));
        reader.readAsDataURL(file);
      });

      if (!dataUrl) {
        throw new Error("Could not read image file.");
      }

      setLookalikeImageDataUrl(dataUrl);
      setLookalikeImageName(file.name);
      setLookalikeResult(null);
      setLookalikeError(null);
    } catch (error) {
      setLookalikeError(error instanceof Error ? error.message : "Failed to read image.");
    }
  }

  async function runLookalikeMatch() {
    if (!lookalikeImageDataUrl || lookalikeLoading) {
      return;
    }

    if (!lookalikeGender) {
      setLookalikeError("Select gender first.");
      return;
    }

    setLookalikeLoading(true);
    setLookalikeError(null);

    try {
      const result = await findCelebrityLookalike(lookalikeImageDataUrl, lookalikeGender);
      setLookalikeResult(result);
    } catch (error) {
      setLookalikeResult(null);
      setLookalikeError(error instanceof Error ? error.message : "Could not analyze image right now.");
    } finally {
      setLookalikeLoading(false);
    }
  }

  function handleLookalikeGenderSelect(gender: LookalikeGender) {
    if (lookalikeGender === gender) {
      return;
    }

    setLookalikeGender(gender);
    setLookalikeResult(null);
    setLookalikeError(null);
  }

  async function runSearchWithFollowUp(combinedPrompt: string) {
    const startedAtMs = Date.now();
    setLoading(true);
    startLoadingTicker();
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
        return;
      }

      const response = await searchOutfit(combinedPrompt, {
        budgetTier: "all",
        includeHistory: true,
      });
      const explanation =
        response.summary?.trim() ||
        "Here’s a set of pieces aligned with your prompt—review images and titles before buying.";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: explanation,
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
    } finally {
      await ensureMinimumLoadingTime(startedAtMs);
      if (loadingTickerRef.current !== null) {
        window.clearInterval(loadingTickerRef.current);
        loadingTickerRef.current = null;
      }
      setLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    setLandingComposerFocused(false);

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

  const composer = (variant: "landing" | "surface") => {
    const isLanding = variant === "landing";
    return (
      <div className={`w-full ${isLanding ? "max-w-[48rem]" : ""}`}>
        <div
          className={`bg-[#f1eee8] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            isLanding
              ? "border border-[rgba(37,35,33,0.16)] px-4 py-3.5 sm:px-5 sm:py-4"
              : "border border-[rgba(37,35,33,0.14)] bg-[#f3f0ea] px-4 py-2.5 focus-within:border-[rgba(37,35,33,0.28)] sm:px-5 sm:py-3"
          }`}
        >
          <div
            className={`flex w-full min-w-0 ${isLanding ? "items-end gap-2.5 sm:gap-3.5" : "items-end gap-2.5 sm:gap-3.5"}`}
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
              placeholder="Describe the style direction, occasion, budget, or constraints you want us to use."
              className={`w-full min-w-0 flex-1 resize-none bg-transparent text-[0.98rem] leading-[1.65] text-stone-900 outline-none placeholder:text-stone-500 ${
                isLanding
                  ? "min-h-[4.1rem] py-1 pl-0.5 pr-1 sm:py-1.5"
                  : "min-h-[2.65rem] max-h-36 px-1 py-1 [field-sizing:content] sm:min-h-[2.9rem] sm:px-0.5"
              }`}
            />
            <div className={`flex shrink-0 ${isLanding ? "" : "pb-0.5"}`}>
              <button
                type="submit"
                form={STYLE_CHAT_FORM_ID}
                disabled={loading || !input.trim()}
                onMouseDown={(event) => {
                  if (isLanding) event.preventDefault();
                }}
                className={
                  isLanding
                    ? "border border-stone-900/85 bg-stone-900 px-4 py-2.5 text-[10px] uppercase tracking-[0.16em] text-[#f1eee8] transition-colors duration-200 hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-45"
                    : "border border-[rgba(37,35,33,0.14)] bg-[#ece8e0] px-3.5 py-2 text-[10px] uppercase tracking-[0.14em] text-stone-600 transition hover:border-[rgba(37,35,33,0.28)] hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                }
              >
                Send
              </button>
            </div>
          </div>

          <div className={`mt-3 flex flex-wrap gap-2 ${isLanding ? "sm:mt-3.5" : "sm:mt-3"}`}>
            {PRESET_PROMPT_BUTTONS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={loading}
                onClick={() => applyPresetPrompt(preset.prompt)}
                onMouseDown={(event) => {
                  if (isLanding) event.preventDefault();
                }}
                className={
                  isLanding
                    ? "border border-[rgba(37,35,33,0.18)] bg-[#ece8e0] px-3 py-1.5 text-[10px] uppercase tracking-[0.13em] text-stone-700 transition hover:border-[rgba(37,35,33,0.3)] hover:bg-[#e7e2da] disabled:cursor-not-allowed disabled:opacity-45"
                    : "border border-[rgba(37,35,33,0.14)] bg-[#efebe3] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-stone-600 transition hover:border-[rgba(37,35,33,0.26)] hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
                }
                aria-label={`Use preset prompt: ${preset.label}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="relative z-10 mx-auto flex h-[100dvh] min-h-0 w-full max-w-[92rem] flex-col px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      {/* Full-viewport sky — softens when results open so the same world continues */}
      <div
        className={`cloud-sky-backdrop fixed inset-0 z-[1] pointer-events-none transition-opacity duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          hasConversationStarted ? "opacity-[0.18]" : "opacity-100"
        }`}
        aria-hidden
      />
      <header
        className={`relative z-[2] flex w-full shrink-0 items-center justify-between transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          hasConversationStarted
            ? "mb-1 border-b border-transparent pb-3"
            : "mb-6 border-b border-[rgba(37,35,33,0.12)] bg-transparent pb-3"
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {hasConversationStarted ? (
            <button
              type="button"
              onClick={goHome}
              className="shrink-0 border border-[rgba(37,35,33,0.14)] px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-stone-700 transition hover:border-[rgba(37,35,33,0.28)]"
              aria-label="Back to home"
            >
              Back
            </button>
          ) : null}
          {!hasConversationStarted ? (
            <p className="min-w-0 truncate text-[10px] uppercase tracking-[0.22em] text-stone-500">
              {token ? "Signed in" : "Closer"}
            </p>
          ) : (
            <p className="min-w-0 truncate text-[10px] uppercase tracking-[0.24em] text-stone-400">Closer</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTopTab("stylist")}
            className={`border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] transition ${
              activeTopTab === "stylist"
                ? "border-[rgba(37,35,33,0.26)] bg-[#ece8e0] text-stone-800"
                : "border-[rgba(37,35,33,0.12)] bg-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            Stylist
          </button>
          <button
            type="button"
            onClick={() => setActiveTopTab("lookalike")}
            className={`border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] transition ${
              activeTopTab === "lookalike"
                ? "border-[rgba(37,35,33,0.26)] bg-[#ece8e0] text-stone-800"
                : "border-[rgba(37,35,33,0.12)] bg-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            Lookalike
          </button>

          {token ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="border border-transparent px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-stone-500 transition hover:text-stone-800"
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
                className="border border-transparent px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-stone-600 transition hover:text-stone-900"
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
                className="border border-[rgba(37,35,33,0.16)] bg-[#ece8e0] px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-stone-800 transition hover:border-[rgba(37,35,33,0.28)]"
              >
                Register
              </button>
            </>
          )}
        </div>
      </header>

      {authPanel !== "none" && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/20 p-4 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-label={authPanel === "login" ? "Log in" : "Register"}
          onClick={() => setAuthPanel("none")}
        >
          <div
            className="w-full max-w-md border border-[rgba(37,35,33,0.14)] bg-[#f1eee8] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-editorial text-[1.35rem] leading-none tracking-[-0.02em] text-stone-900">
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
                  <p className="border border-[rgba(37,35,33,0.12)] bg-[#ece8e0] px-3 py-2 text-sm text-stone-700">
                    {authNotice}
                  </p>
                )}
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1eb] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1eb] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                {authError && <p className="text-sm text-red-800/90">{authError}</p>}
                <button
                  type="submit"
                  disabled={authBusy || !authEmail.trim() || !authPassword}
                  className="mt-1 border border-stone-900 bg-stone-900 py-2.5 text-[10px] uppercase tracking-[0.16em] text-[#f4f1eb] disabled:opacity-45"
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
                  className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1eb] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1eb] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Password (min 8 characters)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1eb] px-3 py-2.5 text-sm text-stone-900 outline-none"
                />
                {authError && <p className="text-sm text-red-800/90">{authError}</p>}
                <p className="text-xs text-stone-500">
                  After registering, you may need to confirm email before logging in. Then use Log in.
                </p>
                <button
                  type="submit"
                  disabled={authBusy || !authEmail.trim() || !authPassword || authPassword.length < 8}
                  className="mt-1 border border-stone-900 bg-stone-900 py-2.5 text-[10px] uppercase tracking-[0.16em] text-[#f4f1eb] disabled:opacity-45"
                >
                  {authBusy ? "…" : "Create account"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {activeTopTab === "lookalike" ? (
        <section className="relative z-[2] flex min-h-0 flex-1 flex-col overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#f1eee8]">
          <div className="mx-auto w-full max-w-4xl overflow-y-auto px-5 py-8 sm:px-8 sm:py-10">
            <p className="text-[10px] uppercase tracking-[0.24em] text-stone-500">Celebrity lookalike</p>
            <h1 className="mt-3 font-editorial text-[2.15rem] leading-[0.95] tracking-[-0.03em] text-stone-900 sm:text-[2.8rem]">
              Who do I look like most?
            </h1>
            <p className="mt-4 max-w-2xl text-[0.94rem] leading-[1.65] text-stone-600">
              Upload a clear selfie and we will match you to the closest celebrity icon from our roster.
            </p>

            <div className="mt-7 grid gap-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
              <div className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1ea] p-4 sm:p-5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-stone-500">Select gender first</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {([
                    { value: "female", label: "Female" },
                    { value: "male", label: "Male" },
                  ] as Array<{ value: LookalikeGender; label: string }>).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleLookalikeGenderSelect(option.value)}
                      className={`border px-3 py-2 text-[10px] uppercase tracking-[0.16em] transition ${
                        lookalikeGender === option.value
                          ? "border-[rgba(37,35,33,0.28)] bg-[#e8e3db] text-stone-900"
                          : "border-[rgba(37,35,33,0.14)] bg-[#efebe3] text-stone-600 hover:border-[rgba(37,35,33,0.24)] hover:text-stone-800"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <input
                  ref={lookalikeFileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleLookalikeImageChange}
                />
                <button
                  type="button"
                  onClick={() => lookalikeFileRef.current?.click()}
                  disabled={lookalikeLoading || !lookalikeGender}
                  className="border border-[rgba(37,35,33,0.2)] bg-[#ece8e0] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-stone-800 transition hover:border-[rgba(37,35,33,0.32)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Upload selfie
                </button>

                <p className="mt-3 text-[0.78rem] text-stone-500">JPG, PNG, WEBP up to 5MB</p>
                {!lookalikeGender ? (
                  <p className="mt-1 text-[0.78rem] text-stone-500">Pick a gender to enable upload and matching.</p>
                ) : null}

                {lookalikeImageDataUrl ? (
                  <div className="mt-4 overflow-hidden border border-[rgba(37,35,33,0.12)] bg-[#e6e0d6]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local preview of user-selected image */}
                    <img src={lookalikeImageDataUrl} alt="Lookalike upload preview" className="h-80 w-full object-cover" />
                  </div>
                ) : (
                  <div className="mt-4 flex h-80 items-center justify-center border border-[rgba(37,35,33,0.12)] bg-[#e6e0d6] px-6 text-center text-[0.86rem] text-stone-500">
                    Add your photo to start matching.
                  </div>
                )}

                <p className="mt-3 line-clamp-1 text-[0.78rem] text-stone-500">{lookalikeImageName || "No file selected"}</p>

                <button
                  type="button"
                  onClick={runLookalikeMatch}
                  disabled={!lookalikeImageDataUrl || lookalikeLoading || !lookalikeGender}
                  className="mt-4 w-full border border-stone-900 bg-stone-900 px-4 py-2.5 text-[10px] uppercase tracking-[0.18em] text-[#f4f1eb] transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {lookalikeLoading ? "Matching..." : "Find my match"}
                </button>

                {lookalikeError ? <p className="mt-3 text-[0.82rem] text-red-800/90">{lookalikeError}</p> : null}
              </div>

              <div className="border border-[rgba(37,35,33,0.14)] bg-[#f4f1ea] p-4 sm:p-5">
                {lookalikeResult ? (
                  <>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500">Closest icon</p>
                    <h2 className="mt-2 font-editorial text-[2rem] leading-[0.95] tracking-[-0.03em] text-stone-900 sm:text-[2.35rem]">
                      {lookalikeResult.closestCelebrity}
                    </h2>
                    <p className="mt-2 text-[0.9rem] text-stone-600">
                      Match confidence: {toConfidencePercent(lookalikeResult.confidence)}
                    </p>
                    <p className="mt-1 text-[0.78rem] text-stone-500">Model: {lookalikeResult.provider}</p>

                    <div className="mt-6 grid gap-2.5">
                      {lookalikeResult.topMatches.map((match) => (
                        <article
                          key={`${match.celebrity}-${match.confidence}`}
                          className="flex items-center gap-3 border border-[rgba(37,35,33,0.12)] bg-[#ede9e1] p-3"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(37,35,33,0.18)] bg-[#e3ddd3] text-[0.72rem] font-medium uppercase tracking-[0.06em] text-stone-800">
                            {getCelebrityInitials(match.celebrity)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-editorial text-[1.18rem] leading-[1.02] tracking-[-0.02em] text-stone-900">
                              {match.celebrity}
                            </p>
                            <p className="text-[0.78rem] text-stone-500">{toConfidencePercent(match.confidence)} match</p>
                          </div>
                        </article>
                      ))}
                    </div>

                    <p className="mt-6 text-[0.78rem] leading-[1.5] text-stone-500">{lookalikeResult.note}</p>
                  </>
                ) : (
                  <div className="flex h-full min-h-[22rem] items-center justify-center border border-[rgba(37,35,33,0.1)] bg-[#ebe7df] px-8 text-center text-[0.9rem] leading-[1.6] text-stone-500">
                    Your closest celebrity match and icon cards will appear here once your image is analyzed.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : (
      <form
        id={STYLE_CHAT_FORM_ID}
        onSubmit={onSubmit}
        className="relative z-[2] flex min-h-0 flex-1 flex-col overflow-hidden"
      >
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

          <div className="relative z-10 mx-auto flex h-full min-h-0 w-full max-w-[82rem] flex-col px-1 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-2 sm:pt-3">
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.82fr)] lg:gap-12 xl:gap-16">
              <div className="flex min-h-0 flex-col items-start text-left">
                <p className="hero-enter-1 text-[10px] uppercase tracking-[0.3em] text-stone-500">
                  Closer.ai
                </p>
                <h1 className="hero-enter-2 font-editorial mt-5 max-w-[9.5ch] text-[3.15rem] leading-[0.94] tracking-[-0.045em] text-stone-900 sm:text-[4.3rem] lg:text-[5.35rem] xl:text-[6rem]">
                  Turn a style icon into a wardrobe worth wearing.
                </h1>
                <p className="hero-enter-3 mt-5 max-w-[31rem] text-[0.9rem] leading-[1.6] text-stone-600 sm:text-[0.94rem]">
                  Name the person, era, or cultural reference. We translate the signal into real pieces you
                  can shop without flattening the point of view.
                </p>
              </div>

              {chatHistory.length > 0 && !isLandingComposerCentered ? (
                <div className="flex min-h-0 flex-col border-t border-[rgba(37,35,33,0.12)] pt-4 text-left lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                  <p className="shrink-0 text-[10px] uppercase tracking-[0.22em] text-stone-500">Previous chats</p>
                  <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-y-contain pr-1 [scrollbar-gutter:stable]">
                  {chatHistory.map((session) => (
                    <li key={session.id} className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => restoreSession(session)}
                        className="min-w-0 flex-1 border border-[rgba(37,35,33,0.11)] bg-[#f2eee7]/78 px-3.5 py-3 text-left transition hover:border-[rgba(37,35,33,0.24)] hover:bg-[#ece8e0]"
                      >
                        <span className="line-clamp-1 block font-editorial text-[1rem] leading-[1.04] tracking-[-0.02em] text-stone-900">
                          {firstUserPreview(session.messages)}
                        </span>
                        <span className="mt-1.5 block text-[10px] uppercase tracking-[0.16em] text-stone-500">
                          {formatSessionWhen(session.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteSession(session.id, e)}
                        className="shrink-0 self-stretch border border-[rgba(37,35,33,0.11)] bg-[#f2eee7]/78 px-3 text-sm text-stone-500 transition hover:border-red-300/60 hover:bg-[#efe5e3] hover:text-red-800"
                        aria-label="Delete this chat"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  </ul>
                </div>
              ) : (
                <div className="hidden lg:block" aria-hidden />
              )}
            </div>
            {/* Centered state is portaled to document.body so position is truly viewport-centered (no transform ancestors). */}
            {clientMounted &&
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
                  <div className="relative z-10 w-full max-w-[48rem] shrink-0 translate-y-10 sm:translate-y-14 md:translate-y-16">
                    <div className="landing-composer-sheet-enter w-full">{composer("landing")}</div>
                  </div>
                </div>,
                document.body
              )}
            {!isLandingComposerCentered && (
              <div className="relative mt-8 w-full shrink-0 sm:mt-10">
                <div className="relative z-10 mx-auto flex min-h-[6rem] w-full max-w-[82rem] items-end justify-start sm:min-h-[6.5rem]">
                  <div className="w-full max-w-[48rem]">{composer("landing")}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section
          className={`absolute inset-0 flex min-h-0 flex-col transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            hasConversationStarted ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1.5 opacity-0"
          }`}
          aria-hidden={!hasConversationStarted}
        >
          {isFollowUpThread ? (
            <>
              <div ref={followUpThreadScrollRef} className="min-h-0 flex-1 overflow-y-auto pb-44 pr-1 pt-2">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
                  {messages.map((message, index) => (
                    <MessageBubble
                      key={`${message.role}-${index}`}
                      message={message}
                      isSignedIn={Boolean(token)}
                      onOpenLogin={() => {
                        setAuthPanel("login");
                        setAuthError(null);
                        setAuthNotice(null);
                      }}
                    />
                  ))}
                  {loading && (
                    <div className="max-w-3xl border border-[rgba(37,35,33,0.12)] bg-[#f3f0ea] px-6 py-4 text-[0.9rem] text-stone-600">
                      {loadingLine}
                    </div>
                  )}
                </div>
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,#f1eee8_68%,transparent)] px-6 pb-8 pt-5">
                <div className="mx-auto w-full max-w-4xl">{composer("surface")}</div>
              </div>
            </>
          ) : (
            <RecommendationExperience
              primaryQuery={recLayout.primaryQuery}
              followUpQueries={recLayout.followUpQueries}
              explanationBlocks={recLayout.explanationBlocks}
              sections={recLayout.sections}
              lockedPreview={recLayout.lockedPreview}
              lockedProducts={recLayout.lockedProducts}
              loading={loading}
              loadingMessage={loadingLine}
              isSignedIn={Boolean(token)}
              onOpenLogin={() => {
                setAuthPanel("login");
                setAuthError(null);
                setAuthNotice(null);
              }}
              onHome={goHome}
              composerSlot={composer("surface")}
            />
          )}
        </section>
      </form>
      )}
    </main>
  );
}
