"""SQLite storage for accounts, characters, and asset snapshots."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SHANGHAI = ZoneInfo("Asia/Shanghai")
STATUSES = ("正常", "停用", "异常")
MONEY_FIELDS = ("gold", "silver", "jade", "char_score", "equip_score", "pet_score")
MAX_INT = 10**15

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    server TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '正常',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    school TEXT NOT NULL DEFAULT '',
    level INTEGER NOT NULL DEFAULT 1,
    appearance TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    recorded_at TEXT NOT NULL,
    gold INTEGER NOT NULL DEFAULT 0,
    silver INTEGER NOT NULL DEFAULT 0,
    jade INTEGER NOT NULL DEFAULT 0,
    char_score INTEGER NOT NULL DEFAULT 0,
    equip_score INTEGER NOT NULL DEFAULT 0,
    pet_score INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_characters_account ON characters(account_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_character ON snapshots(character_id, recorded_at);
"""


class NotFound(Exception):
    """Raised when a row id does not exist."""


def connect(db_path: Path | str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path | str) -> None:
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as conn:
        conn.executescript(SCHEMA)
        conn.commit()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_text(value, name: str, *, required: bool = False, max_len: int = 200, default: str = "") -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(f"{name}必须是文本")
    text = value.strip()
    if required and not text:
        raise ValueError(f"请填写{name}")
    if len(text) > max_len:
        raise ValueError(f"{name}不能超过{max_len}个字")
    return text if text or required else (text or default)


def parse_int(value, name: str, *, minimum: int = 0, maximum: int = MAX_INT, default: int = 0) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{name}必须是整数")
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name}必须是整数") from None
    if number < minimum or number > maximum:
        raise ValueError(f"{name}超出范围")
    return number


def parse_status(value, *, default: str = "正常") -> str:
    if value is None or value == "":
        return default
    if not isinstance(value, str) or value.strip() not in STATUSES:
        raise ValueError("状态只能是正常、停用或异常")
    return value.strip()


def parse_recorded_at(value) -> str:
    if value is None or value == "":
        return now_iso()
    if not isinstance(value, str):
        raise ValueError("记录时间格式不正确")
    raw = value.strip()
    try:
        if len(raw) == 10:
            moment = datetime.strptime(raw, "%Y-%m-%d").replace(tzinfo=SHANGHAI)
        else:
            moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=SHANGHAI)
    except ValueError:
        raise ValueError("记录时间格式不正确") from None
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _require_id(value, name: str) -> int:
    number = parse_int(value, name, minimum=1, maximum=2**31 - 1, default=-1)
    if number < 1:
        raise ValueError(f"请填写{name}")
    return number


def _account_from_payload(payload: dict, *, partial: bool) -> dict:
    fields = {}
    if not partial or "label" in payload:
        fields["label"] = parse_text(payload.get("label"), "称呼", required=True, max_len=40)
    if not partial or "server" in payload:
        fields["server"] = parse_text(payload.get("server"), "服务器", required=True, max_len=40)
    if not partial or "channel" in payload:
        fields["channel"] = parse_text(payload.get("channel"), "渠道", max_len=32)
    if not partial or "status" in payload:
        fields["status"] = parse_status(payload.get("status"))
    if not partial or "notes" in payload:
        fields["notes"] = parse_text(payload.get("notes"), "备注", max_len=500)
    if partial and not fields:
        raise ValueError("没有要修改的内容")
    return fields


def _character_from_payload(payload: dict, *, partial: bool) -> dict:
    fields = {}
    if not partial or "account_id" in payload:
        fields["account_id"] = _require_id(payload.get("account_id"), "所属账号")
    if not partial or "name" in payload:
        fields["name"] = parse_text(payload.get("name"), "角色名", required=True, max_len=20)
    if not partial or "school" in payload:
        fields["school"] = parse_text(payload.get("school"), "门派", max_len=16)
    if not partial or "level" in payload:
        fields["level"] = parse_int(payload.get("level"), "等级", minimum=0, maximum=200, default=1)
    if not partial or "appearance" in payload:
        fields["appearance"] = parse_text(payload.get("appearance"), "造型", max_len=16)
    if not partial or "notes" in payload:
        fields["notes"] = parse_text(payload.get("notes"), "备注", max_len=500)
    if partial and not fields:
        raise ValueError("没有要修改的内容")
    return fields


def _money_from_payload(payload: dict, *, partial: bool) -> dict:
    labels = {
        "gold": "金币",
        "silver": "银币",
        "jade": "仙玉",
        "char_score": "人物评分",
        "equip_score": "装备评分",
        "pet_score": "召唤灵评分",
    }
    fields = {}
    for key, label in labels.items():
        if not partial or key in payload:
            fields[key] = parse_int(payload.get(key), label)
    if not partial or "notes" in payload:
        fields["notes"] = parse_text(payload.get("notes"), "备注", max_len=500)
    if not partial or "recorded_at" in payload:
        fields["recorded_at"] = parse_recorded_at(payload.get("recorded_at"))
    if not partial or "character_id" in payload:
        fields["character_id"] = _require_id(payload.get("character_id"), "角色")
    if partial and not fields:
        raise ValueError("没有要修改的内容")
    return fields


def _deltas(current: dict, previous: dict | None) -> dict | None:
    if previous is None:
        return None
    return {key: current[key] - previous[key] for key in MONEY_FIELDS}


def _previous_snapshot(conn: sqlite3.Connection, character_id: int, recorded_at: str, snapshot_id: int):
    return conn.execute(
        """
        SELECT * FROM snapshots
        WHERE character_id = ?
          AND (recorded_at < ? OR (recorded_at = ? AND id < ?))
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1
        """,
        (character_id, recorded_at, recorded_at, snapshot_id),
    ).fetchone()


def list_accounts(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT a.*,
            (SELECT COUNT(*) FROM characters c WHERE c.account_id = a.id) AS character_count,
            (
                SELECT SUM(s.gold)
                FROM characters c
                JOIN snapshots s ON s.id = (
                    SELECT id FROM snapshots
                    WHERE character_id = c.id
                    ORDER BY recorded_at DESC, id DESC
                    LIMIT 1
                )
                WHERE c.account_id = a.id
            ) AS latest_gold
        FROM accounts a
        ORDER BY a.updated_at DESC, a.id DESC
        """
    ).fetchall()
    return [dict(row) for row in rows]


def get_account(conn: sqlite3.Connection, account_id: int) -> dict:
    row = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if row is None:
        raise NotFound()
    account = dict(row)
    account["characters"] = list_characters(conn, account_id)
    return account


def create_account(conn: sqlite3.Connection, payload: dict) -> dict:
    fields = _account_from_payload(payload, partial=False)
    stamp = now_iso()
    cur = conn.execute(
        """
        INSERT INTO accounts (label, server, channel, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (fields["label"], fields["server"], fields["channel"], fields["status"], fields["notes"], stamp, stamp),
    )
    return get_account(conn, cur.lastrowid)


def update_account(conn: sqlite3.Connection, account_id: int, payload: dict) -> dict:
    get_account(conn, account_id)
    fields = _account_from_payload(payload, partial=True)
    fields["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(
        f"UPDATE accounts SET {assignments} WHERE id = ?",
        (*fields.values(), account_id),
    )
    return get_account(conn, account_id)


def delete_account(conn: sqlite3.Connection, account_id: int) -> None:
    get_account(conn, account_id)
    conn.execute("DELETE FROM accounts WHERE id = ?", (account_id,))


def list_characters(conn: sqlite3.Connection, account_id: int | None = None) -> list[dict]:
    sql = """
        SELECT c.*, a.label AS account_label, a.server AS server,
            s.gold AS latest_gold, s.silver AS latest_silver, s.jade AS latest_jade,
            s.char_score AS latest_char_score, s.equip_score AS latest_equip_score,
            s.pet_score AS latest_pet_score, s.recorded_at AS latest_recorded_at
        FROM characters c
        JOIN accounts a ON a.id = c.account_id
        LEFT JOIN snapshots s ON s.id = (
            SELECT id FROM snapshots
            WHERE character_id = c.id
            ORDER BY recorded_at DESC, id DESC
            LIMIT 1
        )
    """
    params: tuple = ()
    if account_id is not None:
        sql += " WHERE c.account_id = ?"
        params = (account_id,)
    sql += " ORDER BY a.label, c.name, c.id"
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def _ensure_account(conn: sqlite3.Connection, account_id: int) -> None:
    row = conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if row is None:
        raise ValueError("所属账号不存在")


def get_character(conn: sqlite3.Connection, character_id: int) -> dict:
    rows = [row for row in list_characters(conn) if row["id"] == character_id]
    if not rows:
        raise NotFound()
    return rows[0]


def create_character(conn: sqlite3.Connection, payload: dict) -> dict:
    fields = _character_from_payload(payload, partial=False)
    _ensure_account(conn, fields["account_id"])
    stamp = now_iso()
    cur = conn.execute(
        """
        INSERT INTO characters (
            account_id, name, school, level, appearance, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            fields["account_id"],
            fields["name"],
            fields["school"],
            fields["level"],
            fields["appearance"],
            fields["notes"],
            stamp,
            stamp,
        ),
    )
    conn.execute("UPDATE accounts SET updated_at = ? WHERE id = ?", (stamp, fields["account_id"]))
    return get_character(conn, cur.lastrowid)


def update_character(conn: sqlite3.Connection, character_id: int, payload: dict) -> dict:
    current = get_character(conn, character_id)
    fields = _character_from_payload(payload, partial=True)
    if "account_id" in fields:
        _ensure_account(conn, fields["account_id"])
    fields["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(
        f"UPDATE characters SET {assignments} WHERE id = ?",
        (*fields.values(), character_id),
    )
    stamp = fields["updated_at"]
    conn.execute("UPDATE accounts SET updated_at = ? WHERE id = ?", (stamp, current["account_id"]))
    return get_character(conn, character_id)


def delete_character(conn: sqlite3.Connection, character_id: int) -> None:
    current = get_character(conn, character_id)
    conn.execute("DELETE FROM characters WHERE id = ?", (character_id,))
    conn.execute("UPDATE accounts SET updated_at = ? WHERE id = ?", (now_iso(), current["account_id"]))


def _ensure_character(conn: sqlite3.Connection, character_id: int) -> None:
    row = conn.execute("SELECT id FROM characters WHERE id = ?", (character_id,)).fetchone()
    if row is None:
        raise ValueError("角色不存在")


def list_snapshots(conn: sqlite3.Connection, character_id: int) -> list[dict]:
    _ensure_character(conn, character_id)
    rows = conn.execute(
        """
        SELECT * FROM snapshots
        WHERE character_id = ?
        ORDER BY recorded_at ASC, id ASC
        """,
        (character_id,),
    ).fetchall()
    previous = None
    items = []
    for row in rows:
        item = dict(row)
        item["delta"] = _deltas(item, previous)
        previous = item
        items.append(item)
    items.reverse()
    return items


def create_snapshot(conn: sqlite3.Connection, payload: dict) -> dict:
    fields = _money_from_payload(payload, partial=False)
    _ensure_character(conn, fields["character_id"])
    stamp = now_iso()
    cur = conn.execute(
        """
        INSERT INTO snapshots (
            character_id, recorded_at, gold, silver, jade,
            char_score, equip_score, pet_score, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            fields["character_id"],
            fields["recorded_at"],
            fields["gold"],
            fields["silver"],
            fields["jade"],
            fields["char_score"],
            fields["equip_score"],
            fields["pet_score"],
            fields["notes"],
            stamp,
        ),
    )
    return _snapshot_with_delta(conn, cur.lastrowid)


def update_snapshot(conn: sqlite3.Connection, snapshot_id: int, payload: dict) -> dict:
    row = conn.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if row is None:
        raise NotFound()
    fields = _money_from_payload(payload, partial=True)
    if "character_id" in fields:
        _ensure_character(conn, fields["character_id"])
    assignments = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(
        f"UPDATE snapshots SET {assignments} WHERE id = ?",
        (*fields.values(), snapshot_id),
    )
    return _snapshot_with_delta(conn, snapshot_id)


def delete_snapshot(conn: sqlite3.Connection, snapshot_id: int) -> None:
    row = conn.execute("SELECT id FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if row is None:
        raise NotFound()
    conn.execute("DELETE FROM snapshots WHERE id = ?", (snapshot_id,))


def _snapshot_with_delta(conn: sqlite3.Connection, snapshot_id: int) -> dict:
    row = conn.execute("SELECT * FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
    if row is None:
        raise NotFound()
    item = dict(row)
    previous = _previous_snapshot(conn, item["character_id"], item["recorded_at"], item["id"])
    item["delta"] = _deltas(item, dict(previous) if previous else None)
    return item


def summary(conn: sqlite3.Connection) -> dict:
    account_count = conn.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    characters = list_characters(conn)
    totals = {key: 0 for key in ("gold", "silver", "jade")}
    listed = []
    for character in characters:
        latest = None
        if character["latest_recorded_at"] is not None:
            latest = {
                "recorded_at": character["latest_recorded_at"],
                "gold": character["latest_gold"],
                "silver": character["latest_silver"],
                "jade": character["latest_jade"],
                "char_score": character["latest_char_score"],
                "equip_score": character["latest_equip_score"],
                "pet_score": character["latest_pet_score"],
            }
            for key in totals:
                totals[key] += latest[key]
        listed.append(
            {
                "id": character["id"],
                "name": character["name"],
                "school": character["school"],
                "level": character["level"],
                "account_id": character["account_id"],
                "account_label": character["account_label"],
                "server": character["server"],
                "latest": latest,
            }
        )
    recent_rows = conn.execute(
        """
        SELECT s.*, c.name AS character_name, a.label AS account_label, a.server AS server
        FROM snapshots s
        JOIN characters c ON c.id = s.character_id
        JOIN accounts a ON a.id = c.account_id
        ORDER BY s.recorded_at DESC, s.id DESC
        LIMIT 8
        """
    ).fetchall()
    recent = []
    for row in recent_rows:
        item = dict(row)
        previous = _previous_snapshot(conn, item["character_id"], item["recorded_at"], item["id"])
        item["delta"] = _deltas(item, dict(previous) if previous else None)
        recent.append(item)
    return {
        "account_count": account_count,
        "character_count": len(characters),
        "totals": totals,
        "characters": listed,
        "recent": recent,
    }


def export_data(conn: sqlite3.Connection) -> dict:
    return {
        "version": 1,
        "exported_at": now_iso(),
        "accounts": [dict(row) for row in conn.execute(
            "SELECT id, label, server, channel, status, notes, created_at, updated_at FROM accounts ORDER BY id"
        )],
        "characters": [dict(row) for row in conn.execute(
            """
            SELECT id, account_id, name, school, level, appearance, notes, created_at, updated_at
            FROM characters ORDER BY id
            """
        )],
        "snapshots": [dict(row) for row in conn.execute(
            """
            SELECT id, character_id, recorded_at, gold, silver, jade,
                   char_score, equip_score, pet_score, notes, created_at
            FROM snapshots ORDER BY id
            """
        )],
    }


def _import_rows(payload: dict) -> tuple[list[dict], list[dict], list[dict]]:
    if not isinstance(payload, dict):
        raise ValueError("备份格式不正确")
    if payload.get("version") != 1:
        raise ValueError("只能导入版本 1 的备份")
    accounts = payload.get("accounts")
    characters = payload.get("characters")
    snapshots = payload.get("snapshots")
    if not isinstance(accounts, list) or not isinstance(characters, list) or not isinstance(snapshots, list):
        raise ValueError("备份格式不正确")
    clean_accounts = []
    for item in accounts:
        if not isinstance(item, dict):
            raise ValueError("备份里的账号格式不正确")
        fields = _account_from_payload(item, partial=False)
        fields["id"] = _require_id(item.get("id"), "账号编号")
        clean_accounts.append(fields)
    clean_characters = []
    for item in characters:
        if not isinstance(item, dict):
            raise ValueError("备份里的角色格式不正确")
        fields = _character_from_payload(item, partial=False)
        fields["id"] = _require_id(item.get("id"), "角色编号")
        clean_characters.append(fields)
    clean_snapshots = []
    for item in snapshots:
        if not isinstance(item, dict):
            raise ValueError("备份里的记录格式不正确")
        fields = _money_from_payload(item, partial=False)
        fields["id"] = _require_id(item.get("id"), "记录编号")
        clean_snapshots.append(fields)
    account_ids = [item["id"] for item in clean_accounts]
    character_ids = [item["id"] for item in clean_characters]
    snapshot_ids = [item["id"] for item in clean_snapshots]
    if len(account_ids) != len(set(account_ids)) or len(character_ids) != len(set(character_ids)) or len(snapshot_ids) != len(set(snapshot_ids)):
        raise ValueError("备份里有重复编号")
    account_id_set = set(account_ids)
    character_id_set = set(character_ids)
    for item in clean_characters:
        if item["account_id"] not in account_id_set:
            raise ValueError("角色引用了不存在的账号")
    for item in clean_snapshots:
        if item["character_id"] not in character_id_set:
            raise ValueError("记录引用了不存在的角色")
    return clean_accounts, clean_characters, clean_snapshots


def import_data(conn: sqlite3.Connection, payload: dict, *, mode: str) -> dict:
    if mode not in {"replace", "merge"}:
        raise ValueError("导入方式只能是 replace 或 merge")
    accounts, characters, snapshots = _import_rows(payload)
    stamp = now_iso()
    if mode == "replace":
        conn.execute("DELETE FROM snapshots")
        conn.execute("DELETE FROM characters")
        conn.execute("DELETE FROM accounts")
        for item in accounts:
            conn.execute(
                """
                INSERT INTO accounts (id, label, server, channel, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (item["id"], item["label"], item["server"], item["channel"], item["status"], item["notes"], stamp, stamp),
            )
        for item in characters:
            conn.execute(
                """
                INSERT INTO characters (
                    id, account_id, name, school, level, appearance, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["account_id"],
                    item["name"],
                    item["school"],
                    item["level"],
                    item["appearance"],
                    item["notes"],
                    stamp,
                    stamp,
                ),
            )
        for item in snapshots:
            conn.execute(
                """
                INSERT INTO snapshots (
                    id, character_id, recorded_at, gold, silver, jade,
                    char_score, equip_score, pet_score, notes, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["character_id"],
                    item["recorded_at"],
                    item["gold"],
                    item["silver"],
                    item["jade"],
                    item["char_score"],
                    item["equip_score"],
                    item["pet_score"],
                    item["notes"],
                    stamp,
                ),
            )
        return summary(conn)

    account_map: dict[int, int] = {}
    for item in accounts:
        existing = conn.execute(
            "SELECT id FROM accounts WHERE label = ? AND server = ?",
            (item["label"], item["server"]),
        ).fetchone()
        if existing:
            account_map[item["id"]] = existing["id"]
            conn.execute(
                """
                UPDATE accounts
                SET channel = ?, status = ?, notes = ?, updated_at = ?
                WHERE id = ?
                """,
                (item["channel"], item["status"], item["notes"], stamp, existing["id"]),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO accounts (label, server, channel, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (item["label"], item["server"], item["channel"], item["status"], item["notes"], stamp, stamp),
            )
            account_map[item["id"]] = cur.lastrowid

    character_map: dict[int, int] = {}
    for item in characters:
        account_id = account_map[item["account_id"]]
        existing = conn.execute(
            "SELECT id FROM characters WHERE account_id = ? AND name = ?",
            (account_id, item["name"]),
        ).fetchone()
        if existing:
            character_map[item["id"]] = existing["id"]
            conn.execute(
                """
                UPDATE characters
                SET school = ?, level = ?, appearance = ?, notes = ?, updated_at = ?
                WHERE id = ?
                """,
                (item["school"], item["level"], item["appearance"], item["notes"], stamp, existing["id"]),
            )
        else:
            cur = conn.execute(
                """
                INSERT INTO characters (
                    account_id, name, school, level, appearance, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    account_id,
                    item["name"],
                    item["school"],
                    item["level"],
                    item["appearance"],
                    item["notes"],
                    stamp,
                    stamp,
                ),
            )
            character_map[item["id"]] = cur.lastrowid

    for item in snapshots:
        character_id = character_map[item["character_id"]]
        existing = conn.execute(
            "SELECT id FROM snapshots WHERE character_id = ? AND recorded_at = ?",
            (character_id, item["recorded_at"]),
        ).fetchone()
        if existing:
            continue
        conn.execute(
            """
            INSERT INTO snapshots (
                character_id, recorded_at, gold, silver, jade,
                char_score, equip_score, pet_score, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                character_id,
                item["recorded_at"],
                item["gold"],
                item["silver"],
                item["jade"],
                item["char_score"],
                item["equip_score"],
                item["pet_score"],
                item["notes"],
                stamp,
            ),
        )
    return summary(conn)
