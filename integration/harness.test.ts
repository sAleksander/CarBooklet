import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getCars } from "@/lib/services/cars";
import { withTwoUsers, type TwoUsers } from "./fixtures/users";
import { seedCar } from "./fixtures/seed";
import type { Car } from "@/types";

/**
 * The harness proving itself, before any risk depends on it.
 *
 * Every isolation assertion in this suite has the shape "B cannot see A's row".
 * That sentence is satisfied just as well by a broken fixture that sees nothing
 * at all — an unauthenticated client, a JWT that never got attached, a database
 * with no rows in it. So each check here is a *pair*: the foreign row is absent
 * AND the own row is present. Only the pair distinguishes "RLS is working" from
 * "nothing is working".
 */
describe("integration harness", () => {
  let users: TwoUsers;
  let carA: Car;
  let carB: Car;

  beforeAll(async () => {
    users = await withTwoUsers();
    carA = await seedCar(users.userA.client, users.userA.id);
    carB = await seedCar(users.userB.client, users.userB.id);
  });

  afterAll(async () => {
    await users.dispose();
  });

  it("creates two distinct users", () => {
    expect(users.userA.id).not.toBe(users.userB.id);
    expect(users.userA.email).not.toBe(users.userB.email);
  });

  it("gives each client its own identity", async () => {
    const [a, b] = await Promise.all([users.userA.client.auth.getUser(), users.userB.client.auth.getUser()]);
    expect(a.data.user?.id).toBe(users.userA.id);
    expect(b.data.user?.id).toBe(users.userB.id);
  });

  it("seeds each car against its own owner", () => {
    expect(carA.user_id).toBe(users.userA.id);
    expect(carB.user_id).toBe(users.userB.id);
  });

  it("lets RLS decide what getCars returns, per user", async () => {
    const [seenByA, seenByB] = await Promise.all([getCars(users.userA.client), getCars(users.userB.client)]);

    const idsSeenByA = seenByA.map((car) => car.id);
    const idsSeenByB = seenByB.map((car) => car.id);

    // The pair. Absence alone would also hold for a client that can read nothing.
    expect(idsSeenByA).toContain(carA.id);
    expect(idsSeenByA).not.toContain(carB.id);
    expect(idsSeenByB).toContain(carB.id);
    expect(idsSeenByB).not.toContain(carA.id);
  });

  it("still sees both rows through the admin client", async () => {
    // Ground truth: both cars exist. This is what stops the test above from
    // being satisfiable by a database that simply lost the rows — and it is the
    // only role the service-role client plays anywhere in this suite.
    const res = await users.admin.from("cars").select("id").in("id", [carA.id, carB.id]);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2);
  });
});
