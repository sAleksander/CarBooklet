/**
 * The multi-turn chat contract, as pure functions.
 *
 * Three things live here because three parties have to agree on them exactly:
 * the API route that writes the stream, the client hook that reads it, and the
 * tests that pin both. Anything that needs Supabase or React belongs elsewhere.
 */

import type { Message, MessageRole, MessageStatus } from "@/types";

/**
 * One SSE frame, as it appears after `data: ` on the wire.
 *
 * Frame order on a healthy turn is `meta`, then `text` per delta, then `done`,
 * then the literal terminator line `data: [DONE]`. `meta` comes first even when
 * the model fails on its first token, because a client that started a new thread
 * has no other way to learn the id it should reload into.
 *
 * `error` and `done` are separate frames on purpose. The old protocol sent
 * `{"error":…}` followed by a bare `[DONE]`, which left the client unable to
 * tell a truncated answer from a finished one — the distinction persistence
 * turns from cosmetic into load-bearing.
 */
export type ChatFrame =
  | { meta: { conversation_id: string } }
  | { text: string }
  | { error: string }
  | { done: MessageStatus };

/** The literal that terminates the stream, after the `done` frame. */
export const DONE_TERMINATOR = "[DONE]";

/** One replayed turn, in the shape the OpenAI SDK's `messages` array wants. */
export interface ChatTurn {
  role: MessageRole;
  content: string;
}

/**
 * How many complete user→assistant pairs get replayed as context.
 *
 * Eight is a product choice, not a technical ceiling. At a measured ~410 tokens
 * per turn, eight pairs sit near 3.5k tokens — about 5% of the smallest window in
 * the free router's pool, so overflow is not what this number is defending
 * against. What it defends against is the request cost: the account is capped at
 * requests per day, and every turn resends the whole window.
 */
export const HISTORY_MAX_PAIRS = 8;

/**
 * The character budget for the replayed window, checked after the pair cap.
 *
 * Counted in characters rather than tokens deliberately. The router reports its
 * tokenizer as `"Router"` — there is no vocabulary to count against — so any
 * client-side token number would be a guess dressed up as a measurement.
 *
 * 12,000 characters is roughly 4k tokens *for Polish*, which is the tighter of
 * the two locales this app ships: Polish measures 2.86 chars/token against
 * English's 4.18, so the same text is ~45% more tokens. Budgeting at `chars/3`
 * keeps the English case comfortably inside the same bound rather than needing
 * its own.
 */
export const HISTORY_MAX_CHARS = 12_000;

export interface HistoryWindow {
  turns: ChatTurn[];
  /** Whether any otherwise-eligible pair was dropped to stay inside the budget. */
  truncated: boolean;
}

interface Pair {
  user: string;
  assistant: string;
}

/**
 * Build the context window replayed to the model, oldest turn first.
 *
 * Pairs, never individual messages. A user question whose answer never landed —
 * aborted, errored, or still in flight — is dropped *along with* its partial
 * reply, so the returned array strictly alternates user, assistant, user … and
 * never opens with an assistant turn. Some providers reject a non-alternating
 * sequence outright, and every provider answers a dangling question worse than
 * one that was never asked.
 *
 * The two budgets apply in order: keep at most the newest `HISTORY_MAX_PAIRS`
 * pairs, then drop from the oldest end until the total fits `HISTORY_MAX_CHARS`.
 * Only the second one sets `truncated` — the pair cap is the normal state of a
 * long conversation, while hitting the character budget means something unusual
 * (a pasted log, a very long answer) and is worth telling the user about.
 *
 * A single pair that exceeds the whole budget by itself is still returned: the
 * alternative is sending no context at all for a question the user can see on
 * screen, which reads as amnesia rather than as a limit.
 */
export function buildHistoryWindow(messages: Message[]): HistoryWindow {
  const pairs: Pair[] = [];

  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    if (current.role !== "user" || current.status !== "complete") continue;

    // `.at()` rather than `messages[i + 1]`, because the project does not enable
    // `noUncheckedIndexedAccess` — index access is typed as present, so the
    // out-of-range read at the end of the transcript would type as a `Message`
    // that is actually `undefined` at runtime.
    const next = messages.at(i + 1);
    // The reply has to be the very next message. Anything else means the pair
    // was interrupted — two user messages in a row is what an aborted turn
    // looks like from here.
    if (next?.role !== "assistant" || next.status !== "complete") continue;

    pairs.push({ user: current.content, assistant: next.content });
    i++; // consumed the assistant half
  }

  const capped = pairs.slice(-HISTORY_MAX_PAIRS);

  // Drop from the oldest end until the budget is met, but never return nothing
  // when there was something: one oversized pair beats no context at all.
  let kept = capped;
  let truncated = false;
  while (kept.length > 1 && totalChars(kept) > HISTORY_MAX_CHARS) {
    kept = kept.slice(1);
    truncated = true;
  }

  const turns: ChatTurn[] = [];
  for (const pair of kept) {
    turns.push({ role: "user", content: pair.user });
    turns.push({ role: "assistant", content: pair.assistant });
  }

  return { turns, truncated };
}

function totalChars(pairs: Pair[]): number {
  return pairs.reduce((sum, pair) => sum + pair.user.length + pair.assistant.length, 0);
}

/** The longest a derived title may be, matching `conversations_title_length`. */
export const TITLE_MAX_CHARS = 60;

/**
 * Name a thread after the question that started it.
 *
 * Deliberately not a model call. A title is worth about as much as the first
 * eight words of the question, and asking the model for one would spend a second
 * request from a daily cap measured in tens — on the very turn the user is
 * waiting for their actual answer.
 *
 * Cuts on a word boundary when there is a reasonable one, so a truncated title
 * reads as a phrase rather than as a severed word. The prompt is already
 * non-empty by the time it gets here (the route's zod schema refuses an empty
 * one), and a prompt of nothing but whitespace cannot reach this either.
 */
export function titleFromPrompt(prompt: string): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TITLE_MAX_CHARS) return collapsed;

  // One character short of the cap, so the ellipsis fits inside it.
  const cut = collapsed.slice(0, TITLE_MAX_CHARS - 1);
  const lastSpace = cut.lastIndexOf(" ");

  // Only honour a word boundary in the last third: a break at character 4 of 59
  // throws away more than the ragged edge was worth.
  const body = lastSpace > TITLE_MAX_CHARS / 3 ? cut.slice(0, lastSpace) : cut;

  return `${body.trimEnd()}…`;
}
