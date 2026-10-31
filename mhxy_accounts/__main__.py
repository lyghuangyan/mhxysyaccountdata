"""Run the local account ledger."""

from __future__ import annotations

import argparse
from pathlib import Path

from mhxy_accounts.server import serve


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="梦幻西游手游账号数据记录")
    parser.add_argument("--db", default="data/mhxy.db", help="SQLite 数据库路径")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址，默认只对本机开放")
    parser.add_argument("--port", type=int, default=8765, help="端口，默认 8765")
    args = parser.parse_args(argv)
    serve(Path(args.db), args.host, args.port)


if __name__ == "__main__":
    main()
