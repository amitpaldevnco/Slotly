/**
 * Account linking, tested against a real database.
 *
 * The requirement: a social login and a password account that share an email
 * address must resolve to ONE user. These tests run against real rows because
 * the guarantee depends on the `users.email` UNIQUE constraint and on which row
 * an UPDATE lands on — neither of which a mock would exercise.
 *
 * The OAuth handshake itself is deliberately not tested here. Verifying a Google
 * ID token or exchanging a GitHub code is Google's and GitHub's code, reached
 * over the network; what belongs to this application is what it does *after* a
 * provider has handed it a verified email, which is exactly what
 * `resolveSocialAccount` is.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import dotenv from "dotenv";
import { resolveSocialAccount } from "../services/accountLinking.js";
import { query } from "../config/dbConfig.js";

dotenv.config({ quiet: true });

const RUN_ID = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const EMAIL = `slotly_test_link_${RUN_ID}@test.invalid`;

/** How many rows exist for the fixture email — the number the whole file is about. */
async function rowsForEmail() {
  const result = await query("SELECT * FROM users WHERE email = $1", [EMAIL]);
  return result.rows;
}

async function cleanup() {
  await query("DELETE FROM users WHERE email = $1", [EMAIL]);
}

beforeAll(async () => {
  await query("SELECT 1"); // fail early and clearly if the database is unreachable
});

beforeEach(cleanup);
afterAll(cleanup);

describe("a brand new social account", () => {
  it("creates one user with the provider id attached", async () => {
    const { user, isNewUser, linked } = await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-1",
      email: EMAIL,
      name: "New Person",
      avatarUrl: "https://example.test/a.png",
    });

    expect(isNewUser).toBe(true);
    expect(linked).toBe(false);
    expect(user.google_id).toBe("google-sub-1");
    expect(user.email).toBe(EMAIL);
    // role stays NULL, which is how the app knows to send them to profile setup.
    expect(user.role).toBeNull();
    expect(await rowsForEmail()).toHaveLength(1);
  });

  it("returns the same user on every subsequent sign-in", async () => {
    const first = await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-1",
      email: EMAIL,
      name: "New Person",
    });
    const second = await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-1",
      email: EMAIL,
      name: "New Person",
    });

    expect(second.user.id).toBe(first.user.id);
    expect(second.isNewUser).toBe(false);
    expect(await rowsForEmail()).toHaveLength(1);
  });
});

describe("a password account signing in with Google for the first time", () => {
  /**
   * This is the case that was broken: the handler looked up `google_id`, found
   * nothing, and inserted — which collided with the UNIQUE index on `email` and
   * surfaced as "Google authentication failed".
   */
  beforeEach(async () => {
    await query(
      `INSERT INTO users (email, name, password_hash, role, timezone)
       VALUES ($1, 'Existing Person', 'bcrypt-hash-placeholder', 'client', 'Asia/Kolkata')`,
      [EMAIL]
    );
  });

  it("attaches Google to the existing account instead of failing", async () => {
    const before = (await rowsForEmail())[0];

    const { user, isNewUser, linked } = await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-2",
      email: EMAIL,
      name: "Google Display Name",
    });

    expect(user.id).toBe(before.id);
    expect(isNewUser).toBe(false);
    expect(linked).toBe(true);
    expect(user.google_id).toBe("google-sub-2");
    expect(await rowsForEmail()).toHaveLength(1);
  });

  it("keeps the password working, so both sign-in methods reach one account", async () => {
    await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-2",
      email: EMAIL,
    });

    const [row] = await rowsForEmail();
    expect(row.password_hash).toBe("bcrypt-hash-placeholder");
    expect(row.google_id).toBe("google-sub-2");
  });

  it("does not overwrite the profile the user already set", async () => {
    // Signing in is not a request to have your display name replaced with
    // whatever Google currently holds.
    await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-2",
      email: EMAIL,
      name: "Google Display Name",
      avatarUrl: "https://example.test/google.png",
    });

    const [row] = await rowsForEmail();
    expect(row.name).toBe("Existing Person");
    expect(row.avatar_url).toBeNull();
  });

  it("preserves the role and timezone, so the user stays where they were", async () => {
    await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-2",
      email: EMAIL,
    });

    const [row] = await rowsForEmail();
    expect(row.role).toBe("client");
    expect(row.timezone).toBe("Asia/Kolkata");
  });
});

describe("the two social providers on one address", () => {
  it("links GitHub onto an account that already has Google", async () => {
    const google = await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-3",
      email: EMAIL,
      name: "Person",
    });

    const github = await resolveSocialAccount({
      provider: "github",
      providerUserId: "12345",
      email: EMAIL,
      name: "Person",
    });

    expect(github.user.id).toBe(google.user.id);
    expect(github.linked).toBe(true);
    expect(github.user.google_id).toBe("google-sub-3");
    expect(github.user.github_id).toBe("12345");
    expect(await rowsForEmail()).toHaveLength(1);
  });

  it("links Google onto an account that already has GitHub", async () => {
    // The mirror image, so the test above cannot pass through a one-way fluke.
    const github = await resolveSocialAccount({
      provider: "github",
      providerUserId: "12345",
      email: EMAIL,
    });
    const google = await resolveSocialAccount({
      provider: "google",
      providerUserId: "google-sub-3",
      email: EMAIL,
    });

    expect(google.user.id).toBe(github.user.id);
    expect(await rowsForEmail()).toHaveLength(1);
  });

  it("coerces a numeric provider id to text, matching the column type", async () => {
    // GitHub's `id` arrives as a number. The column is VARCHAR, so a mismatch
    // here would mean the second sign-in fails to find the first.
    const first = await resolveSocialAccount({ provider: "github", providerUserId: 12345, email: EMAIL });
    const second = await resolveSocialAccount({ provider: "github", providerUserId: "12345", email: EMAIL });

    expect(second.user.id).toBe(first.user.id);
    expect(second.isNewUser).toBe(false);
  });
});

describe("guards", () => {
  it("rejects an unknown provider rather than building SQL from it", async () => {
    // The id column is interpolated into the query, so an unrecognised provider
    // has to stop here — it must never reach the database.
    await expect(
      resolveSocialAccount({ provider: "myspace", providerUserId: "1", email: EMAIL })
    ).rejects.toThrow(/Unknown social provider/);
  });

  it("refuses to resolve without an email", async () => {
    await expect(
      resolveSocialAccount({ provider: "google", providerUserId: "google-sub-9", email: "" })
    ).rejects.toThrow(/email/);
  });

  it("refuses to resolve without a provider user id", async () => {
    await expect(
      resolveSocialAccount({ provider: "google", providerUserId: null, email: EMAIL })
    ).rejects.toThrow(/provider user id/);
  });
});
