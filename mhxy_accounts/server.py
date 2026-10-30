"""Small local HTTP server for the account ledger."""

from __future__ import annotations

import json
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from mhxy_accounts.db import (
    NotFound,
    connect,
    create_account,
    create_character,
    create_snapshot,
    delete_account,
    delete_character,
    delete_snapshot,
    export_data,
    get_account,
    import_data,
    init_db,
    list_accounts,
    list_characters,
    list_snapshots,
    summary,
    update_account,
    update_character,
    update_snapshot,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/static/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/static/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
MAX_BODY = 1_000_000


def make_handler(db_path: Path):
    from http.server import BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def do_PATCH(self):
            self._handle("PATCH")

        def do_DELETE(self):
            self._handle("DELETE")

        def log_message(self, fmt, *args):
            if args and str(args[1]).startswith(("4", "5")):
                super().log_message(fmt, *args)

        def _handle(self, method: str) -> None:
            path = urlparse(self.path).path
            if method == "GET" and path in STATIC_FILES:
                self._serve_static(path)
                return
            if method == "GET" and path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
                return
            if not path.startswith("/api/"):
                self._send_json(404, {"error": "没有这个页面"})
                return
            conn = connect(db_path)
            try:
                status, payload = self._dispatch(conn, method, path)
                conn.commit()
                self._send_json(status, payload)
            except ValueError as exc:
                conn.rollback()
                self._send_json(400, {"error": str(exc)})
            except NotFound:
                conn.rollback()
                self._send_json(404, {"error": "没有找到这条记录"})
            except Exception:
                conn.rollback()
                traceback.print_exc()
                self._send_json(500, {"error": "服务器出错了"})
            finally:
                conn.close()

        def _dispatch(self, conn, method: str, path: str):
            parts = [part for part in path.split("/") if part]
            query = parse_qs(urlparse(self.path).query)
            if parts == ["api", "health"] and method == "GET":
                return 200, {"ok": True}
            if parts == ["api", "summary"] and method == "GET":
                return 200, summary(conn)
            if parts == ["api", "export"] and method == "GET":
                return 200, export_data(conn)
            if parts == ["api", "import"] and method == "POST":
                body = self._read_json()
                mode = body.get("mode", "replace")
                data = body.get("data", body)
                return 200, import_data(conn, data, mode=mode)
            if parts == ["api", "accounts"] and method == "GET":
                return 200, list_accounts(conn)
            if parts == ["api", "accounts"] and method == "POST":
                return 201, create_account(conn, self._read_json())
            if parts[:2] == ["api", "accounts"] and len(parts) == 3:
                account_id = _path_id(parts[2])
                if method == "GET":
                    return 200, get_account(conn, account_id)
                if method == "PATCH":
                    return 200, update_account(conn, account_id, self._read_json())
                if method == "DELETE":
                    delete_account(conn, account_id)
                    return 200, {"ok": True}
            if parts == ["api", "characters"] and method == "GET":
                account_id = query.get("account_id", [None])[0]
                if account_id is not None:
                    account_id = _path_id(account_id)
                return 200, list_characters(conn, account_id)
            if parts == ["api", "characters"] and method == "POST":
                return 201, create_character(conn, self._read_json())
            if parts[:2] == ["api", "characters"] and len(parts) == 3:
                character_id = _path_id(parts[2])
                if method == "PATCH":
                    return 200, update_character(conn, character_id, self._read_json())
                if method == "DELETE":
                    delete_character(conn, character_id)
                    return 200, {"ok": True}
            if parts == ["api", "snapshots"] and method == "GET":
                raw_id = query.get("character_id", [None])[0]
                if raw_id is None:
                    raise ValueError("请指定角色")
                return 200, list_snapshots(conn, _path_id(raw_id))
            if parts == ["api", "snapshots"] and method == "POST":
                return 201, create_snapshot(conn, self._read_json())
            if parts[:2] == ["api", "snapshots"] and len(parts) == 3:
                snapshot_id = _path_id(parts[2])
                if method == "PATCH":
                    return 200, update_snapshot(conn, snapshot_id, self._read_json())
                if method == "DELETE":
                    delete_snapshot(conn, snapshot_id)
                    return 200, {"ok": True}
            if parts[0] == "api" and len(parts) >= 2:
                return 405, {"error": "不支持这个操作"}
            return 404, {"error": "没有这个地址"}

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length", "0") or "0")
            if length < 0 or length > MAX_BODY:
                raise ValueError("数据太大")
            raw = self.rfile.read(length) if length else b""
            if not raw:
                return {}
            try:
                data = json.loads(raw.decode("utf-8-sig"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise ValueError("请求不是合法的 JSON") from None
            if not isinstance(data, dict):
                raise ValueError("请求格式不正确")
            return data

        def _serve_static(self, path: str) -> None:
            filename, content_type = STATIC_FILES[path]
            file_path = STATIC_DIR / filename
            if not file_path.is_file():
                self._send_json(404, {"error": "页面文件缺失"})
                return
            body = file_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_json(self, status: int, payload) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def _path_id(value: str) -> int:
    if not str(value).isdigit() or int(value) < 1:
        raise NotFound()
    return int(value)


def serve(db_path: Path, host: str, port: int) -> None:
    from http.server import ThreadingHTTPServer

    init_db(db_path)
    httpd = ThreadingHTTPServer((host, port), make_handler(db_path))
    print(f"账号数据记录已启动: http://{host}:{port}")
    print("数据只写在本机数据库里。按 Ctrl+C 停止。")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()
