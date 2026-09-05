import { describe, it, expect } from "vitest";
import { buildHistoryWindow, titleFromPrompt, HISTORY_MAX_PAIRS, HISTORY_MAX_CHARS, TITLE_MAX_CHARS } from "@/lib/chat";
import type { Message, MessageRole, MessageStatus } from "@/types";

/**
 * The two rules the whole multi-turn feature rests on.
 *
 * `buildHistoryWindow` decides what the model is told about the conversation so
 * far. Get it wrong in the permissive direction and every following answer is
 * built on a reply that stopped mid-word; get it wrong in the strict direction
 * and the chat forgets things the user can still see on screen.
 */

let seq = 0;

function makeMessage(role: MessageRole, content: string, status: MessageStatus = "complete"): Message {
  seq += 1;
  return {
    id: `m-${seq.toString()}`,
    conversation_id: "conv-1",
    user_id: "user-1",
    role,
    content,
    status,
    model: role === "assistant" ? "some/model" : null,
    created_at: `2026-09-05T00:00:${seq.toString().padStart(2, "0")}Z`,
  };
}

/** `n` complete pairs, each turn tagged so order is assertable. */
function pairs(n: number, size = 1): Message[] {
  const out: Message[] = [];
  for (let i = 1; i <= n; i++) {
    out.push(makeMessage("user", `q${i.toString()}`.padEnd(size, "x")));
    out.push(makeMessage("assistant", `a${i.toString()}`.padEnd(size, "y")));
  }
  return out;
}

describe("buildHistoryWindow", () => {
  it("returns nothing for an empty transcript", () => {
    expect(buildHistoryWindow([])).toEqual({ turns: [], truncated: false });
  });

  it("replays complete pairs in order, oldest first", () => {
    const { turns, truncated } = buildHistoryWindow(pairs(2));

    expect(turns).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
    expect(truncated).toBe(false);
  });

  it("drops a user turn whose reply never landed", () => {
    // The shape of an in-flight or crashed turn: a question with nothing after it.
    const messages = [...pairs(1), makeMessage("user", "unanswered")];

    const { turns } = buildHistoryWindow(messages);

    expect(turns.map((t) => t.content)).toEqual(["q1", "a1"]);
  });

  it.each<MessageStatus>(["aborted", "error"])("drops the pair when the reply is %s", (status) => {
    const messages = [...pairs(1), makeMessage("user", "q2"), makeMessage("assistant", "partial…", status)];

    const { turns } = buildHistoryWindow(messages);

    // Both halves go, not just the assistant half — a dangling question is
    // answered worse than one that was never asked.
    expect(turns.map((t) => t.content)).toEqual(["q1", "a1"]);
    expect(turns.map((t) => t.content)).not.toContain("partial…");
  });

  it("never opens with an assistant turn, even when the transcript does", () => {
    // Not reachable through the route, but a stray leading assistant row must not
    // produce a message array some providers reject outright.
    const messages = [makeMessage("assistant", "orphan"), ...pairs(1)];

    const { turns } = buildHistoryWindow(messages);

    expect(turns[0].role).toBe("user");
    expect(turns.map((t) => t.content)).not.toContain("orphan");
  });

  it("strictly alternates user and assistant", () => {
    const messages = [
      ...pairs(1),
      makeMessage("user", "interrupted"),
      makeMessage("assistant", "cut", "aborted"),
      makeMessage("user", "q3"),
      makeMessage("assistant", "a3"),
    ];

    const { turns } = buildHistoryWindow(messages);

    turns.forEach((turn, i) => {
      expect(turn.role).toBe(i % 2 === 0 ? "user" : "assistant");
    });
  });

  it("keeps only the newest HISTORY_MAX_PAIRS pairs, without flagging truncation", () => {
    const { turns, truncated } = buildHistoryWindow(pairs(HISTORY_MAX_PAIRS + 3));

    expect(turns).toHaveLength(HISTORY_MAX_PAIRS * 2);
    // The oldest three pairs are gone; the newest survives.
    expect(turns[0].content).toBe("q4");
    expect(turns.at(-1)?.content).toBe(`a${(HISTORY_MAX_PAIRS + 3).toString()}`);
    // The pair cap is the normal state of a long conversation, not an anomaly
    // worth telling the user about.
    expect(truncated).toBe(false);
  });

  it("drops oldest-first to stay inside the character budget, and flags it", () => {
    // Four pairs, each ~2/5 of the budget: two fit, four do not.
    const size = Math.ceil(HISTORY_MAX_CHARS / 5);
    const { turns, truncated } = buildHistoryWindow(pairs(4, size));

    const chars = turns.reduce((sum, t) => sum + t.content.length, 0);
    expect(chars).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    expect(truncated).toBe(true);
    // What survives is the newest end of the conversation.
    expect(turns.at(-1)?.content.startsWith("a4")).toBe(true);
    expect(turns.map((t) => t.content).some((c) => c.startsWith("q1"))).toBe(false);
  });

  it("keeps a single oversized pair rather than sending no context at all", () => {
    const { turns, truncated } = buildHistoryWindow(pairs(1, HISTORY_MAX_CHARS * 2));

    // Amnesia about a question still visible on screen is worse than a long prompt.
    expect(turns).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it("ignores a user message that is not itself complete", () => {
    const messages = [makeMessage("user", "half typed", "error"), makeMessage("assistant", "a1")];

    expect(buildHistoryWindow(messages).turns).toEqual([]);
  });
});

describe("titleFromPrompt", () => {
  it("keeps a short prompt verbatim", () => {
    expect(titleFromPrompt("what oil does it take?")).toBe("what oil does it take?");
  });

  it("collapses whitespace and trims", () => {
    expect(titleFromPrompt("  what   oil\ndoes\tit take?  ")).toBe("what oil does it take?");
  });

  it("cuts a long prompt to the cap and marks it", () => {
    const title = titleFromPrompt("word ".repeat(40));

    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_CHARS);
    expect(title.endsWith("…")).toBe(true);
    // Cut on a word boundary, so the title reads as a phrase.
    expect(title).not.toMatch(/wor…$/);
  });

  it("cuts mid-word rather than throwing away most of the title", () => {
    // One very long token: honouring the only word boundary would leave almost nothing.
    const title = titleFromPrompt(`a ${"b".repeat(200)}`);

    expect(title.length).toBe(TITLE_MAX_CHARS);
    expect(title.endsWith("b…")).toBe(true);
  });

  it("never exceeds the column's own limit", () => {
    // `conversations_title_length` caps the column at 80; the derived title must
    // fit without the database having to say so.
    for (const prompt of ["x".repeat(500), "słowo ".repeat(50), "what oil?"]) {
      expect(titleFromPrompt(prompt).length).toBeLessThanOrEqual(TITLE_MAX_CHARS);
    }
  });
});
