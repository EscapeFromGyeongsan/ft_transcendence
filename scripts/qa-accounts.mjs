import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env")) loadEnvFile(".env");

// Test accounts from roadmap 6장: qa-p1~p4 play matches, qa-outsider belongs
// to no match or friendship. Created through the real register API.
const nicknames = ["qa-p1", "qa-p2", "qa-p3", "qa-p4", "qa-outsider"];

async function main() {
  const password = process.env.QA_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("Set QA_PASSWORD (8+ characters) in .env. Keep it private.");
  }
  const baseUrl =
    process.env.QA_API_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
  for (const nickname of nicknames) {
    const email = `${nickname}@qa.example.com`;
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, nickname }),
    });
    if (response.status === 201) {
      console.log(`created  ${email}`);
    } else if (response.status === 409) {
      console.log(`exists   ${email}`);
    } else {
      const body = await response.text();
      throw new Error(`${email}: HTTP ${response.status} ${body}`);
    }
  }
}

await main();
