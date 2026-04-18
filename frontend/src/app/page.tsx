"use client";

import { FormEvent, useState } from "react";
import { SearchItem, searchProducts } from "@/lib/api";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  products?: SearchItem[];
};

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "Describe the style vision you want, and I will ask one quick follow-up before showing products.",
    },
  ]);
  const [basePrompt, setBasePrompt] = useState("");
  const [awaitingFollowUp, setAwaitingFollowUp] = useState(false);
  const [loading, setLoading] = useState(false);
  async function runSearchWithFollowUp(followUpAnswer: string) {
    const combinedPrompt = `${basePrompt}\nFollow-up: ${followUpAnswer}`;

    setLoading(true);
    try {
      const response = await searchProducts({
        query: combinedPrompt,
        limit: 4,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Great. Here are pieces aligned with your vision.",
          products: response.items,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Backend not reachable yet. Keep chatting here and I will display products once `/api/search` is live.",
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
          text: "Do you want this more casual or sharper? You can also add constraints like budget directly.",
        },
      ]);
      return;
    }

    setAwaitingFollowUp(false);
    await runSearchWithFollowUp(trimmed);
  }

  return (
    <main className="mx-auto flex h-screen w-full max-w-5xl flex-col px-6 py-8">
      <header className="mb-10 border-b border-muted-border pb-7">
        <p className="text-[10px] uppercase tracking-[0.2em] text-stone-500">Closer.ai</p>
        <h1 className="font-editorial mt-4 max-w-2xl text-[2.55rem] leading-[1.05] text-stone-900 md:text-[3.05rem]">
          Style direction, translated into pieces you can buy now.
        </h1>
        <p className="mt-4 max-w-2xl text-[0.95rem] leading-[1.65] text-stone-600">
          A calm, editorial interface for discovering a wardrobe that matches your reference.
        </p>
      </header>

      <section className="flex-1 space-y-7 overflow-y-auto pb-10 pr-1">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
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
        ))}

        {loading && <p className="px-1 text-[0.9rem] text-stone-600">Finding products...</p>}
      </section>

      <form onSubmit={onSubmit} className="border-t border-muted-border pt-6">
        <div className="rounded-[24px] border border-muted-border bg-[#faf7f1] p-4 transition-shadow duration-200 focus-within:shadow-[0_0_0_1px_rgba(24,23,21,0.22)]">
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
            className="min-h-16 w-full resize-none bg-transparent text-[0.97rem] leading-[1.7] text-stone-900 outline-none placeholder:text-stone-500"
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-stone-500">One message at a time</p>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-full border border-stone-900 px-5 py-2 text-[10px] uppercase tracking-[0.14em] text-stone-900 transition-colors duration-200 hover:bg-stone-900 hover:text-[#f7f3ec] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-stone-900"
            >
              Send
            </button>
          </div>
        </div>
      </form>
    </main>
  );
}
