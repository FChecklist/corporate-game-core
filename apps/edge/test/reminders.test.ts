// B11 (gap plan 2026-10-29): a game that is still a draft, or published but not paid, gets a reminder 24 hours, 2 hours and 30 minutes before it starts. Each one once.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { remindUnpaid, REMIND_STEPS, remindStepFor, unpaidReminderMail } from "../src/worker";
import { HOUR, MIN, T, W, create, mails, one, organizer, publish, reset, restore, startIn, uid } from "./param-harness";

beforeEach(() => reset());
afterEach(restore);

const subjects = (to: string) => mails(to).map((m: any) => String(m.subject));
const reminders = (to: string) => subjects(to).filter((s) => /starts in/i.test(s));

describe("which reminder is due (pure)", () => {
  test("30 minutes, 2 hours and 24 hours before the start; nothing earlier", () => {
    expect(REMIND_STEPS.map((s) => s.ms)).toEqual([30 * MIN, 2 * HOUR, 24 * HOUR]);
    expect(remindStepFor(25 * HOUR)).toBeNull(); expect(remindStepFor(24 * HOUR)?.key).toBe("r24"); expect(remindStepFor(3 * HOUR)?.key).toBe("r24");
    expect(remindStepFor(2 * HOUR)?.key).toBe("r2"); expect(remindStepFor(31 * MIN)?.key).toBe("r2"); expect(remindStepFor(30 * MIN)?.key).toBe("r30"); expect(remindStepFor(1)?.key).toBe("r30");
  });
  test("the mail says when the game starts, whether it is a draft, and where to go; no 'private'", () => {
    const d = unpaidReminderMail({ id: "G1", when: "1 Oct, 8:00 pm", label: "2 hours", draft: true, origin: "https://bingo.test" });
    expect(d.subject).toMatch(/G1.*starts in 2 hours/); expect(d.text).toMatch(/still a draft/); expect(d.text).toContain("https://bingo.test/zc.html?e=G1");
    const p = unpaidReminderMail({ id: "G2", when: "1 Oct, 8:00 pm", label: "30 minutes", draft: false, origin: "https://bingo.test" });
    expect(p.subject).toMatch(/G2.*starts in 30 minutes/); expect(p.text).toContain("https://bingo.test/pay.html?e=G2"); expect(p.text).not.toMatch(/draft/i);
    expect(d.text + p.text).not.toMatch(/\bprivate\b/i);
  });
});

describe("the reminders (database)", () => {
  test("a published, unpaid game: one mail at 24 h, one at 2 h, one at 30 min, never twice, nothing before 24 h", async () => {
    const o = await organizer("boss@acme.com"); const id = uid("RM");
    expect((await create(o.key, id, { startRound: startIn(30 * HOUR) })).status).toBe(200);
    expect((await publish(o.key, id)).status).toBe(200);
    await remindUnpaid(W.env as any, T); expect(reminders("boss@acme.com")).toEqual([]); // 30 hours to go
    await remindUnpaid(W.env as any, T + 7 * HOUR); expect(reminders("boss@acme.com").length).toBe(1); // 23 hours to go
    await remindUnpaid(W.env as any, T + 7 * HOUR + 5 * MIN); await remindUnpaid(W.env as any, T + 10 * HOUR); expect(reminders("boss@acme.com").length).toBe(1); // not again
    await remindUnpaid(W.env as any, T + 28.5 * HOUR); expect(reminders("boss@acme.com").length).toBe(2); // 1.5 hours to go
    await remindUnpaid(W.env as any, T + 28.6 * HOUR); expect(reminders("boss@acme.com").length).toBe(2);
    await remindUnpaid(W.env as any, T + 29.7 * HOUR); expect(reminders("boss@acme.com").length).toBe(3); // 18 minutes to go
    await remindUnpaid(W.env as any, T + 29.8 * HOUR); expect(reminders("boss@acme.com").length).toBe(3);
    await remindUnpaid(W.env as any, T + 31 * HOUR); expect(reminders("boss@acme.com").length).toBe(3); // after the start nothing more
    const s = reminders("boss@acme.com"); expect(s[0]).toMatch(/24 hours/); expect(s[1]).toMatch(/2 hours/); expect(s[2]).toMatch(/30 minutes/);
  });
  test("a draft that was never published is reminded too (to the organizer's address) and says it is a draft", async () => {
    const o = await organizer("draftie@acme.com"); const id = uid("RM");
    expect((await create(o.key, id, { startRound: startIn(3 * HOUR) })).status).toBe(200);
    await remindUnpaid(W.env as any, T + 20 * MIN);
    const m = mails("draftie@acme.com").filter((x: any) => /starts in/i.test(String(x.subject)));
    expect(m.length).toBe(1); expect(String(m[0].body ?? m[0].text ?? JSON.stringify(m[0]))).toMatch(/draft/i);
  });
  test("a game created only 20 minutes before it starts gets just the 30-minute mail (not three at once)", async () => {
    const o = await organizer("late@acme.com"); const id = uid("RM");
    expect((await create(o.key, id, { startRound: startIn(20 * MIN) })).status).toBe(200); expect((await publish(o.key, id, { email: "late@acme.com", phone: "98765 43210" })).status).toBe(200); // the reminder goes to the e-mail given at publishing
    await remindUnpaid(W.env as any, T + 16 * MIN); await remindUnpaid(W.env as any, T + 17 * MIN);
    const s = reminders("late@acme.com"); expect(s.length).toBe(1); expect(s[0]).toMatch(/30 minutes/);
  });
  test("a paid game, a cancelled game and a game that already started get nothing", async () => {
    const a = await organizer("paid@acme.com"), b = await organizer("cancel@acme.com"), c = await organizer("gone@acme.com");
    const ia = uid("RM"), ib = uid("RM"), ic = uid("RM");
    for (const [o, id] of [[a, ia], [b, ib], [c, ic]] as const) { expect((await create(o.key, id, { startRound: startIn(3 * HOUR) })).status).toBe(200); await publish(o.key, id, { email: o.email, phone: "98765 43210" }); }
    W.raw.prepare("UPDATE engagement SET pack=100 WHERE id=?").run(ia);
    W.raw.prepare("UPDATE engagement SET cancelled_ms=? WHERE id=?").run(T, ib);
    await remindUnpaid(W.env as any, T + 2.7 * HOUR);
    expect(reminders("paid@acme.com")).toEqual([]); expect(reminders("cancel@acme.com")).toEqual([]);
    const before = reminders("gone@acme.com").length; expect(before).toBeGreaterThan(0); // an ordinary unpaid game in the same minute is reminded: the tick works
    await remindUnpaid(W.env as any, T + 4 * HOUR); expect(reminders("gone@acme.com").length).toBe(before); // 3 hours have gone: it started an hour ago, nothing more
    expect(one("SELECT COUNT(*) c FROM outbox WHERE subject LIKE '%starts in%' AND to_addr IN ('paid@acme.com','cancel@acme.com')").c).toBe(0);
  });
});
