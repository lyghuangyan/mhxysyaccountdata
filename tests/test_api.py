"""HTTP tests for the local account ledger."""

from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from http.server import ThreadingHTTPServer

from mhxy_accounts.db import init_db
from mhxy_accounts.server import make_handler


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "test.db"
        init_db(self.db)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.db))
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.httpd.server_address
        self.base = f"http://{host}:{port}"

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=3)
        self.tmp.cleanup()

    def request(self, method, path, body=None, expect=200):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req) as res:
                raw = res.read()
                status = res.status
                payload = json.loads(raw.decode()) if raw else None
        except urllib.error.HTTPError as exc:
            status = exc.code
            raw = exc.read()
            payload = json.loads(raw.decode()) if raw else None
        self.assertEqual(status, expect, payload)
        return payload

    def test_page_and_health(self):
        with urllib.request.urlopen(self.base + "/") as res:
            html = res.read().decode()
        self.assertIn("不要填写登录账号或密码", html)
        with urllib.request.urlopen(self.base + "/static/app.js") as res:
            script = res.read().decode()
        self.assertIn("记一笔", script)
        self.assertIn('getAttribute("id")', script)
        self.assertEqual(self.request("GET", "/api/health"), {"ok": True})

    def test_rejects_blank_account_and_password_is_not_a_field(self):
        payload = self.request("POST", "/api/accounts", {"label": "  ", "server": "长安城"}, expect=400)
        self.assertIn("称呼", payload["error"])

    def test_account_character_snapshot_flow(self):
        account = self.request("POST", "/api/accounts", {
            "label": "主号",
            "server": "长安城",
            "channel": "官方",
            "notes": "自己的号",
        }, expect=201)
        self.assertEqual(account["label"], "主号")
        updated = self.request("PATCH", f"/api/accounts/{account['id']}", {"status": "停用"})
        self.assertEqual(updated["status"], "停用")

        character = self.request("POST", "/api/characters", {
            "account_id": account["id"],
            "name": "剑客",
            "school": "大唐官府",
            "level": 69,
            "appearance": "剑侠客",
        }, expect=201)
        first = self.request("POST", "/api/snapshots", {
            "character_id": character["id"],
            "recorded_at": "2026-10-29T10:00:00+08:00",
            "gold": 1000,
            "silver": 50,
            "jade": 10,
            "char_score": 100,
            "equip_score": 200,
            "pet_score": 300,
        }, expect=201)
        self.assertIsNone(first["delta"])
        second = self.request("POST", "/api/snapshots", {
            "character_id": character["id"],
            "recorded_at": "2026-10-30",
            "gold": 1800,
            "jade": 8,
        }, expect=201)
        self.assertEqual(second["delta"]["gold"], 800)
        self.assertEqual(second["delta"]["jade"], -2)
        self.assertEqual(second["silver"], 0)

        listed = self.request("GET", f"/api/snapshots?character_id={character['id']}")
        self.assertEqual(listed[0]["id"], second["id"])
        self.assertEqual(listed[0]["delta"]["gold"], 800)

        totals = self.request("GET", "/api/summary")
        self.assertEqual(totals["account_count"], 1)
        self.assertEqual(totals["character_count"], 1)
        self.assertEqual(totals["totals"]["gold"], 1800)
        self.assertEqual(totals["totals"]["jade"], 8)
        self.assertEqual(totals["recent"][0]["delta"]["gold"], 800)

        patched = self.request("PATCH", f"/api/snapshots/{second['id']}", {"gold": 2000})
        self.assertEqual(patched["gold"], 2000)
        self.assertEqual(patched["delta"]["gold"], 1000)

        self.request("DELETE", f"/api/accounts/{account['id']}")
        self.assertEqual(self.request("GET", "/api/accounts"), [])
        self.assertEqual(self.request("GET", "/api/characters"), [])
        self.request("GET", f"/api/snapshots?character_id={character['id']}", expect=400)

    def test_validation_and_missing(self):
        self.request("POST", "/api/snapshots", {"character_id": 1, "gold": -1}, expect=400)
        self.request("GET", "/api/accounts/99", expect=404)
        self.request("POST", "/api/accounts", {"label": "甲", "server": "紫禁城", "status": "封禁"}, expect=400)
        self.request("POST", "/api/import", {"version": 2, "accounts": [], "characters": [], "snapshots": []}, expect=400)

    def test_export_import_replace_and_merge(self):
        account = self.request("POST", "/api/accounts", {"label": "主号", "server": "长安城"}, expect=201)
        character = self.request("POST", "/api/characters", {"account_id": account["id"], "name": "骨精灵"}, expect=201)
        self.request("POST", "/api/snapshots", {
            "character_id": character["id"],
            "recorded_at": "2026-10-30T08:00:00+08:00",
            "gold": 5,
        }, expect=201)
        exported = self.request("GET", "/api/export")
        exported["accounts"][0]["notes"] = "从备份回来"
        self.request("POST", "/api/accounts", {"label": "小号", "server": "傲来"}, expect=201)
        replaced = self.request("POST", "/api/import", {"mode": "replace", "data": exported})
        self.assertEqual(replaced["account_count"], 1)
        accounts = self.request("GET", "/api/accounts")
        self.assertEqual(accounts[0]["notes"], "从备份回来")
        created = self.request("POST", "/api/accounts", {"label": "新号", "server": "建邺"}, expect=201)
        self.assertGreater(created["id"], exported["accounts"][0]["id"])

        extra = {
            "version": 1,
            "accounts": [{
                "id": 9, "label": "主号", "server": "长安城", "channel": "iOS", "status": "正常", "notes": "合并备注",
            }],
            "characters": [{
                "id": 9, "account_id": 9, "name": "骨精灵", "school": "盘丝洞", "level": 70,
                "appearance": "骨精灵", "notes": "",
            }, {
                "id": 10, "account_id": 9, "name": "龙太子", "school": "龙宫", "level": 69,
                "appearance": "龙太子", "notes": "",
            }],
            "snapshots": [{
                "id": 9, "character_id": 9, "recorded_at": "2026-10-30T00:00:00Z",
                "gold": 5, "silver": 0, "jade": 0, "char_score": 0, "equip_score": 0, "pet_score": 0, "notes": "",
            }, {
                "id": 11, "character_id": 10, "recorded_at": "2026-10-30T09:00:00+08:00",
                "gold": 20, "silver": 0, "jade": 1, "char_score": 0, "equip_score": 0, "pet_score": 0, "notes": "",
            }],
        }
        merged = self.request("POST", "/api/import", {"mode": "merge", "data": extra})
        self.assertEqual(merged["account_count"], 2)
        self.assertEqual(merged["character_count"], 2)
        again = self.request("POST", "/api/import", {"mode": "merge", "data": extra})
        self.assertEqual(again["character_count"], 2)
        snapshots = self.request("GET", "/api/snapshots?character_id=1")
        self.assertEqual(len(snapshots), 1)


if __name__ == "__main__":
    unittest.main()
