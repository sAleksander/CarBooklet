-- AI chat: conversations and messages, with car-ownership checks on both tables.
--
-- Until now the AI chat was single-turn and stored nothing. Multi-turn history
-- has to live somewhere the server can rebuild it from, and the Worker binds no
-- KV, D1 or Durable Object — so it lives here. That makes the transcript a first
-- class piece of user data, and it inherits the same threat model as entries.
--
-- `conversations` hangs off `cars` exactly the way the entry tables do, and
-- `messages` hangs off `conversations`. Both carry `user_id` denormalised rather
-- than joined, because every policy below is evaluated per row and a join in a
-- policy is a join on every read.
--
-- ## Both doors, closed at the floor
--
-- 20260825000000 and 20260826000000 are the write-ups for this exact class of
-- hole, learned twice on the entry tables:
--
--   INSERT — a user inserts a row carrying *their own* user_id but pointing at
--            someone else's parent. RLS then hides that row from the parent's
--            owner, so the victim cannot detect the pollution through any query
--            the app makes. That asymmetry is why it is closed here and not only
--            in the route.
--   UPDATE — the same row, reached the other way: insert onto your own parent,
--            then UPDATE the foreign key to point at someone else's. The row
--            that lands is byte-identical to the one the INSERT policy refuses.
--
-- So `conversations` checks `cars` and `messages` checks `conversations`, in
-- INSERT `WITH CHECK` and in *both* UPDATE expressions. SELECT and DELETE gate on
-- `auth.uid() = user_id` alone: a row you cannot see is a row you cannot read or
-- remove, and the parent check adds nothing there.
--
-- Moving a conversation between two of your *own* cars stays permitted, as does
-- moving a message between two of your own conversations — the predicate only
-- requires that the target belong to the caller. No application path does either.
--
-- ## Why the app inserts assistant messages as the user
--
-- There is no service-role client under `src/`, by rule (integration/fixtures/env.ts):
-- every write runs as the signed-in user under RLS. The assistant's reply is
-- therefore inserted by the user's own client, carrying the user's own `user_id`,
-- with `role = 'assistant'` as the only marker of who authored it. The INSERT
-- policy must permit that, and does. `role` is not a trust boundary and is not
-- treated as one anywhere: it selects a label and a bubble style, nothing more.
--
-- ## Why `messages` has no `updated_at`
--
-- Messages are append-only. The one mutable field would be `status`, and the
-- route writes it once at insert time from a server-side buffer — never later.
-- A column and a trigger that nothing updates are dead weight that reads as an
-- invitation to edit history, so both are omitted. `conversations` keeps
-- `updated_at` because the thread list is ordered by activity.
--
-- ## The first indexes in this migration set
--
-- Nothing here has needed one before: every prior query is keyed on a primary key
-- or filtered to a handful of rows per user. These two are different — they are on
-- the path of every chat page load, and both grow without bound as a user talks.
--
--   messages (conversation_id, created_at)      — rebuilding one transcript in order
--   conversations (car_id, updated_at DESC)     — listing a car's threads, newest first
--
-- Forward-only and safe on existing data: both tables are new, so nothing already
-- stored can be invalidated by this. Rollback is dropping them.

-- ─── conversations ────────────────────────────────────────────────────────────

CREATE TABLE public.conversations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id     UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL,
  locale     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT conversations_title_length CHECK (char_length(title) BETWEEN 1 AND 80),
  CONSTRAINT conversations_locale_known CHECK (locale IN ('en', 'pl'))
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = conversations.car_id
        AND cars.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = conversations.car_id
        AND cars.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cars
      WHERE cars.id = conversations.car_id
        AND cars.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own conversations"
  ON public.conversations FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX conversations_car_id_updated_at_idx
  ON public.conversations (car_id, updated_at DESC);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── messages ─────────────────────────────────────────────────────────────────

CREATE TABLE public.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'complete',
  model           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_role_known    CHECK (role IN ('user', 'assistant')),
  CONSTRAINT messages_content_filled CHECK (char_length(content) > 0),
  CONSTRAINT messages_status_known  CHECK (status IN ('complete', 'aborted', 'error'))
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own messages"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX messages_conversation_id_created_at_idx
  ON public.messages (conversation_id, created_at);
