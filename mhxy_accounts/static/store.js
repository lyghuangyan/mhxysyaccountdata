/* Browser copy of the ledger. Used when the page is opened from GitHub Pages. */
(function (root) {
  const KEY = "mhxy.ledger.v1";
  const MONEY = ["gold", "silver", "jade", "char_score", "equip_score", "pet_score"];
  const STATUSES = ["正常", "停用", "异常"];

  function storageArea() {
    if (typeof localStorage !== "undefined") return localStorage;
    if (!root.__mhxyMemory) root.__mhxyMemory = new Map();
    return {
      getItem(key) {
        return root.__mhxyMemory.has(key) ? root.__mhxyMemory.get(key) : null;
      },
      setItem(key, value) {
        root.__mhxyMemory.set(key, value);
      },
      removeItem(key) {
        root.__mhxyMemory.delete(key);
      },
    };
  }

  function emptyDb() {
    return { nextId: 1, accounts: [], characters: [], snapshots: [] };
  }

  function loadDb() {
    const raw = storageArea().getItem(KEY);
    if (!raw) return emptyDb();
    try {
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.accounts)) return emptyDb();
      data.characters = Array.isArray(data.characters) ? data.characters : [];
      data.snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
      data.nextId = data.nextId || 1;
      return data;
    } catch (error) {
      return emptyDb();
    }
  }

  function saveDb(db) {
    storageArea().setItem(KEY, JSON.stringify(db));
  }

  function fail(message) {
    throw new Error(message);
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function text(value, name, required, maxLen) {
    if (value == null) value = "";
    if (typeof value !== "string") fail(`${name}必须是文本`);
    const trimmed = value.trim();
    if (required && !trimmed) fail(`请填写${name}`);
    if (trimmed.length > maxLen) fail(`${name}不能超过${maxLen}个字`);
    return trimmed;
  }

  function integer(value, name, minimum, maximum, fallback) {
    if (value == null || value === "") return fallback;
    if (typeof value === "boolean") fail(`${name}必须是整数`);
    const number = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(number)) fail(`${name}必须是整数`);
    if (number < minimum || number > maximum) fail(`${name}超出范围`);
    return number;
  }

  function statusOf(value) {
    if (value == null || value === "") return "正常";
    if (typeof value !== "string" || !STATUSES.includes(value.trim())) fail("状态只能是正常、停用或异常");
    return value.trim();
  }

  function recordedAt(value) {
    if (value == null || value === "") return nowIso();
    if (typeof value !== "string") fail("记录时间格式不正确");
    const raw = value.trim();
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00+08:00`) : new Date(raw);
    if (Number.isNaN(parsed.getTime())) fail("记录时间格式不正确");
    return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function requireId(value, name) {
    const number = integer(value, name, 1, 2 ** 31 - 1, -1);
    if (number < 1) fail(`请填写${name}`);
    return number;
  }

  function takeId(db) {
    const id = db.nextId;
    db.nextId += 1;
    return id;
  }

  function accountById(db, id) {
    return db.accounts.find((item) => item.id === id) || null;
  }

  function characterById(db, id) {
    return db.characters.find((item) => item.id === id) || null;
  }

  function latestSnapshot(db, characterId) {
    return db.snapshots
      .filter((item) => item.character_id === characterId)
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id - a.id))[0] || null;
  }

  function previousSnapshot(db, characterId, recorded, snapshotId) {
    return db.snapshots
      .filter((item) => item.character_id === characterId && (item.recorded_at < recorded || (item.recorded_at === recorded && item.id < snapshotId)))
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id - a.id))[0] || null;
  }

  function moneyDelta(current, previous) {
    if (!previous) return null;
    const delta = {};
    for (const key of MONEY) delta[key] = current[key] - previous[key];
    return delta;
  }

  function publicCharacter(db, character) {
    const account = accountById(db, character.account_id);
    const latest = latestSnapshot(db, character.id);
    return {
      ...character,
      account_label: account ? account.label : "",
      server: account ? account.server : "",
      latest_gold: latest ? latest.gold : null,
      latest_silver: latest ? latest.silver : null,
      latest_jade: latest ? latest.jade : null,
      latest_char_score: latest ? latest.char_score : null,
      latest_equip_score: latest ? latest.equip_score : null,
      latest_pet_score: latest ? latest.pet_score : null,
      latest_recorded_at: latest ? latest.recorded_at : null,
    };
  }

  function listCharacters(db, accountId) {
    return db.characters
      .filter((item) => accountId == null || item.account_id === accountId)
      .map((item) => publicCharacter(db, item))
      .sort((a, b) => a.account_label.localeCompare(b.account_label, "zh") || a.name.localeCompare(b.name, "zh") || a.id - b.id);
  }

  function listAccounts(db) {
    return db.accounts
      .map((account) => {
        const characters = db.characters.filter((item) => item.account_id === account.id);
        const golds = characters.map((item) => latestSnapshot(db, item.id)).filter(Boolean).map((item) => item.gold);
        return {
          ...account,
          character_count: characters.length,
          latest_gold: golds.length ? golds.reduce((sum, value) => sum + value, 0) : null,
        };
      })
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : b.id - a.id));
  }

  function getAccount(db, id) {
    const account = accountById(db, id);
    if (!account) fail("没有找到这条记录");
    return { ...account, characters: listCharacters(db, id) };
  }

  function accountFields(payload, partial) {
    const fields = {};
    if (!partial || "label" in payload) fields.label = text(payload.label, "称呼", true, 40);
    if (!partial || "server" in payload) fields.server = text(payload.server, "服务器", true, 40);
    if (!partial || "channel" in payload) fields.channel = text(payload.channel, "渠道", false, 32);
    if (!partial || "status" in payload) fields.status = statusOf(payload.status);
    if (!partial || "notes" in payload) fields.notes = text(payload.notes, "备注", false, 500);
    if (partial && !Object.keys(fields).length) fail("没有要修改的内容");
    return fields;
  }

  function characterFields(payload, partial) {
    const fields = {};
    if (!partial || "account_id" in payload) fields.account_id = requireId(payload.account_id, "所属账号");
    if (!partial || "name" in payload) fields.name = text(payload.name, "角色名", true, 20);
    if (!partial || "school" in payload) fields.school = text(payload.school, "门派", false, 16);
    if (!partial || "level" in payload) fields.level = integer(payload.level, "等级", 0, 200, 1);
    if (!partial || "appearance" in payload) fields.appearance = text(payload.appearance, "造型", false, 16);
    if (!partial || "notes" in payload) fields.notes = text(payload.notes, "备注", false, 500);
    if (partial && !Object.keys(fields).length) fail("没有要修改的内容");
    return fields;
  }

  function snapshotFields(payload, partial) {
    const labels = { gold: "金币", silver: "银币", jade: "仙玉", char_score: "人物评分", equip_score: "装备评分", pet_score: "召唤灵评分" };
    const fields = {};
    for (const [key, label] of Object.entries(labels)) {
      if (!partial || key in payload) fields[key] = integer(payload[key], label, 0, 10 ** 15, 0);
    }
    if (!partial || "notes" in payload) fields.notes = text(payload.notes, "备注", false, 500);
    if (!partial || "recorded_at" in payload) fields.recorded_at = recordedAt(payload.recorded_at);
    if (!partial || "character_id" in payload) fields.character_id = requireId(payload.character_id, "角色");
    if (partial && !Object.keys(fields).length) fail("没有要修改的内容");
    return fields;
  }

  function touchAccount(db, accountId, stamp) {
    const account = accountById(db, accountId);
    if (account) account.updated_at = stamp;
  }

  function snapshotView(db, snapshot) {
    const previous = previousSnapshot(db, snapshot.character_id, snapshot.recorded_at, snapshot.id);
    return { ...snapshot, delta: moneyDelta(snapshot, previous) };
  }

  function summary(db) {
    const characters = listCharacters(db);
    const totals = { gold: 0, silver: 0, jade: 0 };
    const listed = characters.map((character) => {
      const latest = character.latest_recorded_at == null ? null : {
        recorded_at: character.latest_recorded_at,
        gold: character.latest_gold,
        silver: character.latest_silver,
        jade: character.latest_jade,
        char_score: character.latest_char_score,
        equip_score: character.latest_equip_score,
        pet_score: character.latest_pet_score,
      };
      if (latest) {
        totals.gold += latest.gold;
        totals.silver += latest.silver;
        totals.jade += latest.jade;
      }
      return {
        id: character.id,
        name: character.name,
        school: character.school,
        level: character.level,
        account_id: character.account_id,
        account_label: character.account_label,
        server: character.server,
        latest,
      };
    });
    const recent = db.snapshots
      .map((snapshot) => {
        const character = characterById(db, snapshot.character_id);
        const account = character ? accountById(db, character.account_id) : null;
        return {
          ...snapshotView(db, snapshot),
          character_name: character ? character.name : "",
          account_label: account ? account.label : "",
          server: account ? account.server : "",
        };
      })
      .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : b.id - a.id))
      .slice(0, 8);
    return {
      account_count: db.accounts.length,
      character_count: characters.length,
      totals,
      characters: listed,
      recent,
    };
  }

  function exportData(db) {
    const accounts = db.accounts.map(({ id, label, server, channel, status, notes, created_at, updated_at }) => ({ id, label, server, channel, status, notes, created_at, updated_at }));
    const characters = db.characters.map(({ id, account_id, name, school, level, appearance, notes, created_at, updated_at }) => ({ id, account_id, name, school, level, appearance, notes, created_at, updated_at }));
    const snapshots = db.snapshots.map(({ id, character_id, recorded_at, gold, silver, jade, char_score, equip_score, pet_score, notes, created_at }) => ({ id, character_id, recorded_at, gold, silver, jade, char_score, equip_score, pet_score, notes, created_at }));
    return { version: 1, exported_at: nowIso(), accounts, characters, snapshots };
  }

  function cleanImport(payload) {
    if (!payload || payload.version !== 1) fail("只能导入版本 1 的备份");
    if (!Array.isArray(payload.accounts) || !Array.isArray(payload.characters) || !Array.isArray(payload.snapshots)) fail("备份格式不正确");
    for (const item of [...payload.accounts, ...payload.characters, ...payload.snapshots]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail("备份格式不正确");
    }
    const accounts = payload.accounts.map((item) => ({ id: requireId(item.id, "账号编号"), ...accountFields(item, false) }));
    const characters = payload.characters.map((item) => ({ id: requireId(item.id, "角色编号"), ...characterFields(item, false) }));
    const snapshots = payload.snapshots.map((item) => ({ id: requireId(item.id, "记录编号"), ...snapshotFields(item, false) }));
    const accountIds = new Set(accounts.map((item) => item.id));
    const characterIds = new Set(characters.map((item) => item.id));
    if (accountIds.size !== accounts.length || characterIds.size !== characters.length || new Set(snapshots.map((item) => item.id)).size !== snapshots.length) fail("备份里有重复编号");
    for (const item of characters) if (!accountIds.has(item.account_id)) fail("角色引用了不存在的账号");
    for (const item of snapshots) if (!characterIds.has(item.character_id)) fail("记录引用了不存在的角色");
    return { accounts, characters, snapshots };
  }

  function importData(db, body) {
    if (body.mode && body.mode !== "replace" && body.mode !== "merge") fail("导入方式只能是 replace 或 merge");
    const mode = body.mode || "replace";
    const cleaned = cleanImport(body.data || body);
    const stamp = nowIso();
    if (mode === "replace") {
      db.accounts = cleaned.accounts.map((item) => ({ ...item, created_at: stamp, updated_at: stamp }));
      db.characters = cleaned.characters.map((item) => ({ ...item, created_at: stamp, updated_at: stamp }));
      db.snapshots = cleaned.snapshots.map((item) => ({ ...item, created_at: stamp }));
      const ids = [...db.accounts, ...db.characters, ...db.snapshots].map((item) => item.id);
      db.nextId = (ids.length ? Math.max(...ids) : 0) + 1;
      return summary(db);
    }
    const accountMap = {};
    for (const item of cleaned.accounts) {
      const existing = db.accounts.find((account) => account.label === item.label && account.server === item.server);
      if (existing) {
        accountMap[item.id] = existing.id;
        existing.channel = item.channel;
        existing.status = item.status;
        existing.notes = item.notes;
        existing.updated_at = stamp;
      } else {
        const id = takeId(db);
        accountMap[item.id] = id;
        db.accounts.push({ ...item, id, created_at: stamp, updated_at: stamp });
      }
    }
    const characterMap = {};
    for (const item of cleaned.characters) {
      const accountId = accountMap[item.account_id];
      const existing = db.characters.find((character) => character.account_id === accountId && character.name === item.name);
      if (existing) {
        characterMap[item.id] = existing.id;
        existing.school = item.school;
        existing.level = item.level;
        existing.appearance = item.appearance;
        existing.notes = item.notes;
        existing.updated_at = stamp;
      } else {
        const id = takeId(db);
        characterMap[item.id] = id;
        db.characters.push({ ...item, id, account_id: accountId, created_at: stamp, updated_at: stamp });
      }
    }
    for (const item of cleaned.snapshots) {
      const characterId = characterMap[item.character_id];
      if (db.snapshots.some((snapshot) => snapshot.character_id === characterId && snapshot.recorded_at === item.recorded_at)) continue;
      db.snapshots.push({ ...item, id: takeId(db), character_id: characterId, created_at: stamp });
    }
    return summary(db);
  }

  function readJson(options) {
    if (!options.body) return {};
    const data = JSON.parse(options.body);
    if (!data || typeof data !== "object" || Array.isArray(data)) fail("请求格式不正确");
    return data;
  }

  function pathId(value) {
    if (!/^[1-9]\d*$/.test(String(value))) fail("没有找到这条记录");
    return Number(value);
  }

  function browserApi(path, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const url = new URL(path, "http://ledger.local");
    const parts = url.pathname.split("/").filter(Boolean);
    const db = loadDb();
    let result;
    if (parts[0] !== "api") fail("没有这个地址");
    if (parts[1] === "health" && method === "GET") result = { ok: true };
    else if (parts[1] === "summary" && method === "GET") result = summary(db);
    else if (parts[1] === "export" && method === "GET") result = exportData(db);
    else if (parts[1] === "import" && method === "POST") result = importData(db, readJson(options));
    else if (parts[1] === "accounts" && parts.length === 2 && method === "GET") result = listAccounts(db);
    else if (parts[1] === "accounts" && parts.length === 2 && method === "POST") {
      const fields = accountFields(readJson(options), false);
      const stamp = nowIso();
      const account = { id: takeId(db), ...fields, created_at: stamp, updated_at: stamp };
      db.accounts.push(account);
      result = getAccount(db, account.id);
    } else if (parts[1] === "accounts" && parts.length === 3) {
      const id = pathId(parts[2]);
      if (method === "GET") result = getAccount(db, id);
      else if (method === "PATCH") {
        const account = accountById(db, id);
        if (!account) fail("没有找到这条记录");
        Object.assign(account, accountFields(readJson(options), true), { updated_at: nowIso() });
        result = getAccount(db, id);
      } else if (method === "DELETE") {
        if (!accountById(db, id)) fail("没有找到这条记录");
        const characterIds = new Set(db.characters.filter((item) => item.account_id === id).map((item) => item.id));
        db.accounts = db.accounts.filter((item) => item.id !== id);
        db.characters = db.characters.filter((item) => item.account_id !== id);
        db.snapshots = db.snapshots.filter((item) => !characterIds.has(item.character_id));
        result = { ok: true };
      }
    } else if (parts[1] === "characters" && parts.length === 2 && method === "GET") {
      const raw = url.searchParams.get("account_id");
      result = listCharacters(db, raw ? pathId(raw) : null);
    } else if (parts[1] === "characters" && parts.length === 2 && method === "POST") {
      const fields = characterFields(readJson(options), false);
      if (!accountById(db, fields.account_id)) fail("所属账号不存在");
      const stamp = nowIso();
      const character = { id: takeId(db), ...fields, created_at: stamp, updated_at: stamp };
      db.characters.push(character);
      touchAccount(db, fields.account_id, stamp);
      result = publicCharacter(db, character);
    } else if (parts[1] === "characters" && parts.length === 3) {
      const id = pathId(parts[2]);
      const character = characterById(db, id);
      if (!character) fail("没有找到这条记录");
      if (method === "PATCH") {
        const fields = characterFields(readJson(options), true);
        if (fields.account_id && !accountById(db, fields.account_id)) fail("所属账号不存在");
        Object.assign(character, fields, { updated_at: nowIso() });
        touchAccount(db, character.account_id, character.updated_at);
        result = publicCharacter(db, character);
      } else if (method === "DELETE") {
        db.characters = db.characters.filter((item) => item.id !== id);
        db.snapshots = db.snapshots.filter((item) => item.character_id !== id);
        touchAccount(db, character.account_id, nowIso());
        result = { ok: true };
      }
    } else if (parts[1] === "snapshots" && parts.length === 2 && method === "GET") {
      const raw = url.searchParams.get("character_id");
      if (!raw) fail("请指定角色");
      const characterId = pathId(raw);
      if (!characterById(db, characterId)) fail("角色不存在");
      const rows = db.snapshots.filter((item) => item.character_id === characterId).sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : a.id - b.id));
      let previous = null;
      const items = rows.map((row) => {
        const item = { ...row, delta: moneyDelta(row, previous) };
        previous = row;
        return item;
      });
      items.reverse();
      result = items;
    } else if (parts[1] === "snapshots" && parts.length === 2 && method === "POST") {
      const fields = snapshotFields(readJson(options), false);
      if (!characterById(db, fields.character_id)) fail("角色不存在");
      const snapshot = { id: takeId(db), ...fields, created_at: nowIso() };
      db.snapshots.push(snapshot);
      result = snapshotView(db, snapshot);
    } else if (parts[1] === "snapshots" && parts.length === 3) {
      const id = pathId(parts[2]);
      const snapshot = db.snapshots.find((item) => item.id === id);
      if (!snapshot) fail("没有找到这条记录");
      if (method === "PATCH") {
        const fields = snapshotFields(readJson(options), true);
        if (fields.character_id && !characterById(db, fields.character_id)) fail("角色不存在");
        Object.assign(snapshot, fields);
        result = snapshotView(db, snapshot);
      } else if (method === "DELETE") {
        db.snapshots = db.snapshots.filter((item) => item.id !== id);
        result = { ok: true };
      }
    }
    if (result === undefined) fail("不支持这个操作");
    saveDb(db);
    return result;
  }

  root.mhxyBrowserApi = browserApi;
  root.mhxyResetBrowserStore = function () {
    storageArea().removeItem(KEY);
  };
})(globalThis);
