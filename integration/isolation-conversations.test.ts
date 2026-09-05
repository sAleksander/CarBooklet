import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  listConversations,
  getConversationById,
  createConversation,
  deleteConversation,
  getMessages,
  appendMessage,
} from "@/lib/services/conversations";
import { deleteCar } from "@/lib/services/cars";
import { withTwoUsers, type TwoUsers } from "./fixtures/users";
import { seedCar, seedConversation, seedMessage, marker } from "./fixtures/seed";
import type { Car } from "@/types";

/**
 * R3, chat half: every read, insert, update and delete that User B attempts
 * against User A's conversations or messages fails — adjudicated by real RLS.
 *
 * ## Why this file exists beyond the cars/entries pair
 *
 * `20260905000000_ai_conversations.sql` is the third table pair in this codebase
 * to carry the two-door ownership predicate, and the first where the app
 * legitimately writes rows it did not author: there is no service-role client
 * under `src/`, so the *assistant's* reply is inserted by the signed-in user's
 * own client with `role = 'assistant'`. That makes "an authenticated user may
 * insert an assistant message" a policy the product depends on rather than a
 * hole — and the positive control below is what keeps the two apart.
 *
 * ## Why each case is asserted twice
 *
 * The service functions carry `.eq("user_id", userId)` of their own as defense in
 * depth, which short-circuits *ahead* of RLS: a test that only went through them
 * would pass even with every policy dropped. So each cross-user case is asserted
 * once through the service (the contract the app depends on) and once through a
 * raw PostgREST call carrying B's JWT (the policy itself). The raw half is the
 * only half still reaching the policy — do not delete one because the other
 * "covers" it. Same reasoning, at more length, in `isolation-cars.test.ts`.
 *
 * ## Why destructive cases read back rather than expect a throw
 *
 * Under an RLS `USING` clause an UPDATE or DELETE against an invisible row
 * matches zero rows, which is not an error at the SQL level. How that reaches the
 * caller depends on the service's tail — `deleteConversation` reports `false`,
 * a raw call reports `data: []` and `error: null`. The load-bearing assertion is
 * therefore always a read-back as A: the row is still there, unchanged.
 */
describe("R3 · cross-user isolation · conversations and messages", () => {
  let users: TwoUsers;
  let carA: Car;
  let carB: Car;

  beforeAll(async () => {
    // Per-file, not per-test: `config.toml` caps sign-ins at 30 / 5 min.
    users = await withTwoUsers();
  });

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    await users?.dispose();
  });

  beforeEach(async () => {
    carA = await seedCar(users.userA.client, users.userA.id);
    carB = await seedCar(users.userB.client, users.userB.id);
  });

  /** A's thread with one question and one answer already in it. */
  async function seedThreadA() {
    const conversation = await seedConversation(users.userA.client, {
      userId: users.userA.id,
      carId: carA.id,
    });
    const question = await seedMessage(users.userA.client, {
      userId: users.userA.id,
      conversationId: conversation.id,
    });
    const answer = await seedMessage(
      users.userA.client,
      { userId: users.userA.id, conversationId: conversation.id },
      { role: "assistant", content: marker("answer"), model: "some/model" },
    );
    return { conversation, question, answer };
  }

  describe("read", () => {
    it("omits A's thread from B's list for B's own car, and still returns B's own", async () => {
      await seedThreadA();
      const ownedByB = await seedConversation(users.userB.client, {
        userId: users.userB.id,
        carId: carB.id,
      });

      const seenByB = (await listConversations(users.userB.client, carB.id, users.userB.id)).map((c) => c.id);

      // The pair. Absence alone would also hold for a client that reads nothing.
      expect(seenByB).toContain(ownedByB.id);
      expect(seenByB).toHaveLength(1);
    });

    it("returns an empty list when B asks for A's car by id", async () => {
      await seedThreadA();

      expect(await listConversations(users.userB.client, carA.id, users.userB.id)).toEqual([]);
    });

    it("returns null when B fetches A's conversation by id", async () => {
      const { conversation } = await seedThreadA();

      expect(await getConversationById(users.userB.client, conversation.id, users.userB.id)).toBeNull();
    });

    it("returns null even when B supplies A's user id", async () => {
      const { conversation } = await seedThreadA();

      // The service's own `.eq("user_id")` filter cannot help here — B is asking
      // for exactly the row that filter would allow. Only RLS refuses.
      expect(await getConversationById(users.userB.client, conversation.id, users.userA.id)).toBeNull();
    });

    it("hides A's conversation from a raw select carrying B's JWT", async () => {
      const { conversation } = await seedThreadA();

      const raw = await users.userB.client.from("conversations").select("*").eq("id", conversation.id);

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
    });

    it("returns no messages when B reads A's thread", async () => {
      const { conversation } = await seedThreadA();

      expect(await getMessages(users.userB.client, conversation.id, users.userB.id)).toEqual([]);
      expect(await getMessages(users.userB.client, conversation.id, users.userA.id)).toEqual([]);
    });

    it("hides A's messages from a raw select carrying B's JWT", async () => {
      const { conversation } = await seedThreadA();

      const raw = await users.userB.client.from("messages").select("*").eq("conversation_id", conversation.id);

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(0);
    });

    it("lets A read their own thread in order — the positive control", async () => {
      const { conversation, question, answer } = await seedThreadA();

      const messages = await getMessages(users.userA.client, conversation.id, users.userA.id);

      expect(messages.map((m) => m.id)).toEqual([question.id, answer.id]);
      expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    });
  });

  describe("insert", () => {
    it("refuses a conversation B creates onto A's car, carrying B's own user_id", async () => {
      // The INSERT door: the row is B's by `user_id`, so a policy checking only
      // row ownership would accept it. RLS then hides it from A, who owns the
      // car it points at and cannot see what was attached to it.
      await expect(
        createConversation(users.userB.client, {
          user_id: users.userB.id,
          car_id: carA.id,
          title: marker("intruder"),
          locale: "en",
        }),
      ).rejects.toMatchObject({ code: "42501" });

      const raw = await users.userB.client
        .from("conversations")
        .insert({ user_id: users.userB.id, car_id: carA.id, title: marker("intruder-raw"), locale: "en" });

      expect(raw.error?.code).toBe("42501");
    });

    it("refuses a conversation B creates while impersonating A", async () => {
      const raw = await users.userB.client
        .from("conversations")
        .insert({ user_id: users.userA.id, car_id: carA.id, title: marker("impersonate"), locale: "en" });

      expect(raw.error?.code).toBe("42501");
    });

    it("refuses a message B appends to A's thread, carrying B's own user_id", async () => {
      const { conversation } = await seedThreadA();

      await expect(
        appendMessage(users.userB.client, {
          conversation_id: conversation.id,
          user_id: users.userB.id,
          role: "user",
          content: marker("intruder"),
        }),
      ).rejects.toMatchObject({ code: "42501" });

      const raw = await users.userB.client.from("messages").insert({
        conversation_id: conversation.id,
        user_id: users.userB.id,
        role: "user",
        content: marker("intruder-raw"),
        status: "complete",
      });

      expect(raw.error?.code).toBe("42501");

      // A's thread is unchanged — the two rows it started with.
      const messages = await getMessages(users.userA.client, conversation.id, users.userA.id);
      expect(messages).toHaveLength(2);
    });

    it("lets A append an assistant message to their own thread — the positive control", async () => {
      // The app has no service identity: the AI's reply is written by the signed-in
      // user's own client. If this ever starts failing, chat stops persisting
      // answers, and the isolation cases above would not notice.
      const { conversation } = await seedThreadA();

      const reply = await appendMessage(users.userA.client, {
        conversation_id: conversation.id,
        user_id: users.userA.id,
        role: "assistant",
        content: marker("reply"),
        status: "complete",
        model: "some/model",
      });

      expect(reply.role).toBe("assistant");
      expect(reply.status).toBe("complete");
    });
  });

  describe("update", () => {
    it("refuses B moving their own conversation onto A's car", async () => {
      // The second door. B inserts onto their own car (allowed, by design) and
      // then repoints `car_id` at A's. The row that would land is byte-identical
      // to the one the INSERT policy refuses.
      const ownedByB = await seedConversation(users.userB.client, {
        userId: users.userB.id,
        carId: carB.id,
      });

      const raw = await users.userB.client
        .from("conversations")
        .update({ car_id: carA.id })
        .eq("id", ownedByB.id)
        .select("id");

      // Either the policy names the refusal, or the row is simply not matched.
      // What matters is the read-back: the conversation still points at B's car.
      expect(raw.data ?? []).toHaveLength(0);

      const after = await getConversationById(users.userB.client, ownedByB.id, users.userB.id);
      expect(after?.car_id).toBe(carB.id);
    });

    it("refuses B moving their own message into A's thread", async () => {
      const { conversation: threadA } = await seedThreadA();
      const threadB = await seedConversation(users.userB.client, {
        userId: users.userB.id,
        carId: carB.id,
      });
      const ownedByB = await seedMessage(users.userB.client, {
        userId: users.userB.id,
        conversationId: threadB.id,
      });

      const raw = await users.userB.client
        .from("messages")
        .update({ conversation_id: threadA.id })
        .eq("id", ownedByB.id)
        .select("id");

      expect(raw.data ?? []).toHaveLength(0);

      // A's transcript did not gain a message it cannot account for.
      const messagesA = await getMessages(users.userA.client, threadA.id, users.userA.id);
      expect(messagesA).toHaveLength(2);
      expect(messagesA.map((m) => m.id)).not.toContain(ownedByB.id);
    });

    it("refuses B editing the title of A's conversation", async () => {
      const { conversation } = await seedThreadA();

      const raw = await users.userB.client
        .from("conversations")
        .update({ title: "renamed by B" })
        .eq("id", conversation.id)
        .select("id");

      expect(raw.data ?? []).toHaveLength(0);

      const after = await getConversationById(users.userA.client, conversation.id, users.userA.id);
      expect(after?.title).toBe(conversation.title);
    });

    it("refuses B rewriting the content of A's message", async () => {
      const { conversation, answer } = await seedThreadA();

      const raw = await users.userB.client
        .from("messages")
        .update({ content: "rewritten by B" })
        .eq("id", answer.id)
        .select("id");

      expect(raw.data ?? []).toHaveLength(0);

      const messages = await getMessages(users.userA.client, conversation.id, users.userA.id);
      expect(messages.map((m) => m.content)).toContain(answer.content);
      expect(messages.map((m) => m.content)).not.toContain("rewritten by B");
    });

    it("lets A move their own conversation between their own cars", async () => {
      // The predicate requires only that the *target* belong to the caller, so
      // this stays permitted. Asserted so a future tightening is a deliberate
      // choice rather than a silent side effect.
      const secondCarA = await seedCar(users.userA.client, users.userA.id);
      const { conversation } = await seedThreadA();

      const raw = await users.userA.client
        .from("conversations")
        .update({ car_id: secondCarA.id })
        .eq("id", conversation.id)
        .select("id");

      expect(raw.error).toBeNull();
      expect(raw.data).toHaveLength(1);
    });
  });

  describe("delete", () => {
    it("reports false and leaves the row when B deletes A's conversation", async () => {
      const { conversation } = await seedThreadA();

      expect(await deleteConversation(users.userB.client, conversation.id, users.userB.id)).toBe(false);

      const raw = await users.userB.client.from("conversations").delete().eq("id", conversation.id).select("id");
      expect(raw.data ?? []).toHaveLength(0);

      // Ground truth through the owner's own client, never the admin one.
      expect(await getConversationById(users.userA.client, conversation.id, users.userA.id)).not.toBeNull();
    });

    it("leaves A's messages when B tries to delete them", async () => {
      const { conversation } = await seedThreadA();

      const raw = await users.userB.client
        .from("messages")
        .delete()
        .eq("conversation_id", conversation.id)
        .select("id");
      expect(raw.data ?? []).toHaveLength(0);

      expect(await getMessages(users.userA.client, conversation.id, users.userA.id)).toHaveLength(2);
    });

    it("reports true and takes the messages with it when A deletes their own thread", async () => {
      const { conversation } = await seedThreadA();

      expect(await deleteConversation(users.userA.client, conversation.id, users.userA.id)).toBe(true);

      expect(await getConversationById(users.userA.client, conversation.id, users.userA.id)).toBeNull();
      // `messages.conversation_id` is ON DELETE CASCADE.
      expect(await getMessages(users.userA.client, conversation.id, users.userA.id)).toEqual([]);
    });
  });

  describe("car delete blast radius", () => {
    it("takes the car's threads and their messages, and leaves the other car's alone", async () => {
      const secondCarA = await seedCar(users.userA.client, users.userA.id);
      const { conversation, question } = await seedThreadA();
      const survivor = await seedConversation(users.userA.client, {
        userId: users.userA.id,
        carId: secondCarA.id,
      });
      await seedMessage(users.userA.client, { userId: users.userA.id, conversationId: survivor.id });

      expect(await deleteCar(users.userA.client, carA.id, users.userA.id)).toBe(true);

      // Gone with the car.
      expect(await getConversationById(users.userA.client, conversation.id, users.userA.id)).toBeNull();
      const orphanedMessages = await users.userA.client.from("messages").select("id").eq("id", question.id);
      expect(orphanedMessages.data).toHaveLength(0);

      // The other car's history is untouched — the failure this case exists for.
      expect(await getConversationById(users.userA.client, survivor.id, users.userA.id)).not.toBeNull();
      expect(await getMessages(users.userA.client, survivor.id, users.userA.id)).toHaveLength(1);
    });
  });
});
