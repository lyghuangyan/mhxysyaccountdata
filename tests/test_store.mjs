import assert from "node:assert/strict";
import test from "node:test";

await import(new URL("../mhxy_accounts/static/store.js", import.meta.url));

const api = globalThis.mhxyBrowserApi;

function call(path, body, method = "POST") {
  return api(path, { method, body: body ? JSON.stringify(body) : undefined });
}

test("browser ledger records snapshots and restores a backup", () => {
  globalThis.mhxyResetBrowserStore();
  assert.throws(() => call("/api/accounts", { label: "  ", server: "长安城" }), /称呼/);

  const account = call("/api/accounts", { label: "主号", server: "长安城", channel: "官方" });
  const character = call("/api/characters", { account_id: account.id, name: "剑客", school: "大唐官府", level: 69 });
  const first = call("/api/snapshots", {
    character_id: character.id,
    recorded_at: "2026-10-29T10:00:00+08:00",
    gold: 1000,
    jade: 10,
  });
  assert.equal(first.delta, null);
  const second = call("/api/snapshots", {
    character_id: character.id,
    recorded_at: "2026-10-30T10:00:00+08:00",
    gold: 1800,
    jade: 8,
  });
  assert.equal(second.delta.gold, 800);
  assert.equal(second.delta.jade, -2);

  const totals = api("/api/summary");
  assert.equal(totals.totals.gold, 1800);
  assert.equal(totals.totals.jade, 8);
  assert.equal(totals.recent[0].delta.gold, 800);

  const exported = api("/api/export");
  call(`/api/accounts/${account.id}`, null, "DELETE");
  assert.equal(api("/api/accounts").length, 0);
  const replaced = call("/api/import", { mode: "replace", data: exported });
  assert.equal(replaced.account_count, 1);
  assert.equal(replaced.totals.gold, 1800);

  const again = api("/api/summary");
  assert.equal(again.account_count, 1);
});
