import { getMode } from "./mode";
import { accountEmail } from "./emailkey";
import type { D1 } from "./worker";
// Three sign-in addresses made for the owner's own testing: the 6-digit code is always 123456. They are ordinary organizer accounts and nothing else about them is special.
// To switch this off, empty this list. The addresses belong to a real third-party domain, so NO mail of any kind is ever sent to them (pay.ts sendMail), the sign-in is counted
// against the daily write budget and a per-network limit (worker.ts), and the keys it makes are trimmed to the latest three.
export const TEST_LOGINS = new Set(["demo1@xyz.in", "demo2@xyz.in", "demo3@xyz.in"]);
export const TEST_LOGIN_CODE = "123456";
export const TEST_LOGINS_PER_IP_DAY = 30;
export const isTestLogin = (email: string): boolean => TEST_LOGINS.has(accountEmail(email ?? ""));
/** WP-17 (2026-10-29): the fixed-code sign-in exists ONLY while the whole service is in TEST mode (mode.ts). In LIVE these addresses are ordinary unknown addresses and 123456 is a wrong code. */
export const testLoginsOpen = async (env: { DB: D1 }): Promise<boolean> => (await getMode(env)) === "TEST";
