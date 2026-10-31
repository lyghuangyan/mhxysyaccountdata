const view = document.querySelector("#view");
const toast = document.querySelector("#toast");
const state = {
  page: sessionStorage.getItem("mhxy.page") || "overview",
  accounts: [],
  characters: [],
  summary: null,
  detail: null,
  snapshots: [],
  selectedAccountId: Number(sessionStorage.getItem("mhxy.account") || 0),
  selectedCharacterId: Number(sessionStorage.getItem("mhxy.character") || 0),
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function money(value) {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("zh-CN");
}

function delta(value) {
  if (value === null || value === undefined) return "";
  const number = Number(value);
  if (!number) return "";
  const cls = number > 0 ? "up" : "down";
  const sign = number > 0 ? "+" : "";
  return `<span class="${cls}">${sign}${number.toLocaleString("zh-CN")}</span>`;
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function shanghaiNowInput() {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return parts.replace(" ", "T");
}

function isoToLocalInput(iso) {
  if (!iso) return shanghaiNowInput();
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso)).replace(" ", "T");
}

function showToast(message) {
  toast.hidden = false;
  toast.textContent = message;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

let backend = "http";

async function api(path, options = {}) {
  if (backend === "browser") return globalThis.mhxyBrowserApi(path, options);
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function chooseBackend() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (response.ok) {
      backend = "http";
      return;
    }
  } catch (error) {
    // GitHub Pages has no Python service, so the ledger stays in this browser.
  }
  backend = "browser";
  const note = document.querySelector("#storage-note");
  if (note) {
    note.textContent = "只记角色和资产。不要填写登录账号或密码。数据留在这台浏览器里，换设备前请导出备份。";
  }
}

function setPage(page) {
  state.page = page;
  sessionStorage.setItem("mhxy.page", page);
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === page);
  });
}

async function load() {
  const [accounts, characters, summary] = await Promise.all([
    api("/api/accounts"),
    api("/api/characters"),
    api("/api/summary"),
  ]);
  state.accounts = accounts;
  state.characters = characters;
  state.summary = summary;
  if (!state.accounts.some((item) => item.id === state.selectedAccountId)) {
    state.selectedAccountId = state.accounts[0]?.id || 0;
  }
  if (!state.characters.some((item) => item.id === state.selectedCharacterId)) {
    state.selectedCharacterId = state.characters[0]?.id || 0;
  }
  sessionStorage.setItem("mhxy.account", String(state.selectedAccountId));
  sessionStorage.setItem("mhxy.character", String(state.selectedCharacterId));
  if (state.page === "accounts" && state.selectedAccountId) {
    state.detail = await api(`/api/accounts/${state.selectedAccountId}`);
  } else {
    state.detail = null;
  }
  if (state.page === "records" && state.selectedCharacterId) {
    state.snapshots = await api(`/api/snapshots?character_id=${state.selectedCharacterId}`);
  } else {
    state.snapshots = [];
  }
  render();
}

function render() {
  if (state.page === "accounts") renderAccounts();
  else if (state.page === "records") renderRecords();
  else renderOverview();
}

function renderOverview() {
  const summary = state.summary;
  const cards = [
    ["账号", summary.account_count],
    ["角色", summary.character_count],
    ["最新金币", money(summary.totals.gold)],
    ["最新仙玉", money(summary.totals.jade)],
  ].map(([label, value]) => `<article class="card"><span>${label}</span><strong>${value}</strong></article>`).join("");
  const recent = summary.recent.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>角色</th><th>金币</th><th>变化</th><th>银币</th><th>仙玉</th></tr></thead>
        <tbody>${summary.recent.map((item) => `<tr>
          <td>${esc(formatTime(item.recorded_at))}</td>
          <td>${esc(item.account_label)} · ${esc(item.character_name)}</td>
          <td>${money(item.gold)}</td>
          <td>${item.delta ? delta(item.delta.gold) : "—"}</td>
          <td>${money(item.silver)}</td>
          <td>${money(item.jade)}</td>
        </tr>`).join("")}</tbody></table></div>`
    : `<p class="empty">还没有资产记录。添加角色后，每次上线记一笔金币、仙玉和评分。</p>`;
  view.innerHTML = `
    <header class="page-head">
      <div>
        <h2>总览</h2>
        <p class="sub">金币、银币、仙玉按每个角色最新一笔合计。时间是北京时间。</p>
      </div>
      <div class="toolbar">
        <button class="ghost" type="button" data-action="export">导出备份</button>
        <button class="ghost" type="button" data-action="import">导入备份</button>
        <button class="primary" type="button" data-action="open-snapshot">记一笔</button>
      </div>
    </header>
    <section class="cards">${cards}</section>
    <section class="panel">
      <h3>最近记录</h3>
      ${recent}
    </section>`;
}

function renderAccounts() {
  const header = `
    <header class="page-head">
      <div>
        <h2>账号</h2>
        <p class="sub">一个称呼对应一台服务器上的登录身份，下面再挂角色。</p>
      </div>
      <button class="primary" type="button" data-action="open-account">添加账号</button>
    </header>`;
  if (!state.accounts.length) {
    view.innerHTML = `${header}<section class="panel"><p class="empty">还没有账号。先加一个称呼和服务器。</p></section>`;
    return;
  }
  const list = state.accounts.map((item) => `<button class="account-item${item.id === state.selectedAccountId ? " active" : ""}" type="button" data-action="select-account" data-id="${item.id}">
        <strong>${esc(item.label)}</strong>
        <span class="meta">${esc(item.server)}${item.channel ? " · " + esc(item.channel) : ""} · ${esc(item.status)} · ${item.character_count} 个角色</span>
      </button>`).join("");
  const detail = state.detail ? renderDetail(state.detail) : `<section class="panel"><p class="empty">选一个账号查看角色。</p></section>`;
  view.innerHTML = `${header}<div class="two"><section class="account-list">${list}</section>${detail}</div>`;
}

function renderDetail(account) {
  const characters = account.characters.length
    ? account.characters.map((item) => `<article class="character-row">
        <strong>${esc(item.name)} <span class="badge">${esc(item.level)}级 ${esc(item.school || "未填门派")}</span></strong>
        <p class="meta">${esc(item.appearance || "未填造型")} · 最新金币 ${money(item.latest_gold)} · 仙玉 ${money(item.latest_jade)}</p>
        <div class="toolbar">
          <button class="ghost" type="button" data-action="record-character" data-id="${item.id}">记一笔</button>
          <button class="ghost" type="button" data-action="edit-character" data-id="${item.id}">编辑</button>
          <button class="ghost danger" type="button" data-action="delete-character" data-id="${item.id}" data-name="${esc(item.name)}">删除</button>
        </div>
      </article>`).join("")
    : `<p class="empty">这个账号下还没有角色。</p>`;
  return `<section class="panel stack">
    <div class="split">
      <div>
        <h3>${esc(account.label)}</h3>
        <p class="meta">${esc(account.server)}${account.channel ? " · " + esc(account.channel) : ""} · ${esc(account.status)}</p>
        <p class="meta">${esc(account.notes || "没有备注")}</p>
      </div>
      <div class="toolbar">
        <button class="ghost" type="button" data-action="edit-account" data-id="${account.id}">编辑</button>
        <button class="ghost danger" type="button" data-action="delete-account" data-id="${account.id}" data-label="${esc(account.label)}">删除</button>
      </div>
    </div>
    <div class="split">
      <h3>角色</h3>
      <button class="primary" type="button" data-action="open-character" data-account="${account.id}">添加角色</button>
    </div>
    ${characters}
  </section>`;
}

function renderRecords() {
  if (!state.characters.length) {
    view.innerHTML = `<header class="page-head"><div><h2>记录</h2><p class="sub">先添加账号和角色，再记资产。</p></div></header>
      <section class="panel"><p class="empty">还没有角色。</p></section>`;
    return;
  }
  const options = state.characters.map((item) => `<option value="${item.id}"${item.id === state.selectedCharacterId ? " selected" : ""}>${esc(item.account_label)} · ${esc(item.name)}</option>`).join("");
  const rows = state.snapshots.length
    ? state.snapshots.map((item) => `<tr>
        <td>${esc(formatTime(item.recorded_at))}</td>
        <td>${money(item.gold)} ${item.delta ? delta(item.delta.gold) : ""}</td>
        <td>${money(item.silver)} ${item.delta ? delta(item.delta.silver) : ""}</td>
        <td>${money(item.jade)} ${item.delta ? delta(item.delta.jade) : ""}</td>
        <td>${money(item.char_score)}</td>
        <td>${money(item.equip_score)}</td>
        <td>${money(item.pet_score)}</td>
        <td>${esc(item.notes || "")}</td>
        <td><button class="ghost danger" type="button" data-action="delete-snapshot" data-id="${item.id}">删除</button></td>
      </tr>`).join("")
    : `<tr><td colspan="9">这个角色还没有记录。</td></tr>`;
  view.innerHTML = `
    <header class="page-head">
      <div>
        <h2>记录</h2>
        <p class="sub">同一角色按时间排列。变化是相对上一笔的差额。</p>
      </div>
      <button class="primary" type="button" data-action="open-snapshot">记一笔</button>
    </header>
    <section class="panel stack">
      <label>角色
        <select id="character-select">${options}</select>
      </label>
      <div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>金币</th><th>银币</th><th>仙玉</th><th>人物</th><th>装备</th><th>召唤灵</th><th>备注</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  document.querySelector("#character-select").addEventListener("change", async (event) => {
    state.selectedCharacterId = Number(event.target.value);
    sessionStorage.setItem("mhxy.character", String(state.selectedCharacterId));
    await load();
  });
}

function fillAccountSelect(select, selected) {
  select.innerHTML = state.accounts.map((item) => `<option value="${item.id}">${esc(item.label)} · ${esc(item.server)}</option>`).join("");
  if (selected) select.value = String(selected);
}

function fillCharacterSelect(select, selected) {
  select.innerHTML = state.characters.map((item) => `<option value="${item.id}">${esc(item.account_label)} · ${esc(item.name)}</option>`).join("");
  if (selected) select.value = String(selected);
}

function openAccountDialog(account) {
  const form = document.querySelector("#account-form");
  form.reset();
  form.elements.id.value = account?.id || "";
  document.querySelector("#account-dialog-title").textContent = account ? "编辑账号" : "添加账号";
  if (account) {
    form.elements.label.value = account.label;
    form.elements.server.value = account.server;
    form.elements.channel.value = account.channel || "";
    form.elements.status.value = account.status;
    form.elements.notes.value = account.notes || "";
  }
  document.querySelector("#account-dialog").showModal();
}

function openCharacterDialog(character, accountId) {
  if (!state.accounts.length) {
    showToast("先添加账号");
    return;
  }
  const form = document.querySelector("#character-form");
  form.reset();
  fillAccountSelect(form.elements.account_id, accountId || state.selectedAccountId);
  form.elements.id.value = character?.id || "";
  document.querySelector("#character-dialog-title").textContent = character ? "编辑角色" : "添加角色";
  if (character) {
    form.elements.account_id.value = String(character.account_id);
    form.elements.name.value = character.name;
    form.elements.school.value = character.school || "";
    form.elements.appearance.value = character.appearance || "";
    form.elements.level.value = character.level;
    form.elements.notes.value = character.notes || "";
  }
  document.querySelector("#character-dialog").showModal();
}

function openSnapshotDialog() {
  if (!state.characters.length) {
    showToast("先添加角色");
    return;
  }
  const form = document.querySelector("#snapshot-form");
  form.reset();
  fillCharacterSelect(form.elements.character_id, state.selectedCharacterId);
  form.elements.recorded_at.value = shanghaiNowInput();
  form.elements.gold.value = "0";
  form.elements.silver.value = "0";
  form.elements.jade.value = "0";
  form.elements.char_score.value = "0";
  form.elements.equip_score.value = "0";
  form.elements.pet_score.value = "0";
  document.querySelector("#snapshot-dialog").showModal();
}

function formData(form) {
  const data = {};
  for (const element of form.elements) {
    if (!element.name || element.type === "submit") continue;
    data[element.name] = element.value;
  }
  return data;
}

document.body.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "nav") {
      setPage(button.dataset.view);
      await load();
    } else if (action === "open-account") {
      openAccountDialog(null);
    } else if (action === "edit-account") {
      openAccountDialog(state.detail);
    } else if (action === "open-character") {
      openCharacterDialog(null, Number(button.dataset.account));
    } else if (action === "edit-character") {
      const character = state.detail.characters.find((item) => item.id === Number(button.dataset.id));
      openCharacterDialog(character);
    } else if (action === "open-snapshot") {
      openSnapshotDialog();
    } else if (action === "record-character") {
      state.selectedCharacterId = Number(button.dataset.id);
      setPage("records");
      await load();
      openSnapshotDialog();
    } else if (action === "select-account") {
      state.selectedAccountId = Number(button.dataset.id);
      sessionStorage.setItem("mhxy.account", String(state.selectedAccountId));
      await load();
    } else if (action === "close-dialog") {
      button.closest("dialog").close();
    } else if (action === "delete-account") {
      if (!confirm(`删除账号「${button.dataset.label}」以及它的角色和记录？`)) return;
      await api(`/api/accounts/${button.dataset.id}`, { method: "DELETE" });
      showToast("已删除账号");
      await load();
    } else if (action === "delete-character") {
      if (!confirm(`删除角色「${button.dataset.name}」和它的记录？`)) return;
      await api(`/api/characters/${button.dataset.id}`, { method: "DELETE" });
      showToast("已删除角色");
      await load();
    } else if (action === "delete-snapshot") {
      if (!confirm("删除这条记录？")) return;
      await api(`/api/snapshots/${button.dataset.id}`, { method: "DELETE" });
      showToast("已删除记录");
      await load();
    } else if (action === "export") {
      const data = await api("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "mhxy-accounts.json";
      link.click();
      URL.revokeObjectURL(link.href);
    } else if (action === "import") {
      document.querySelector("#import-file").click();
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.body.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  try {
    // A control named "id" shadows form.id, so read the attribute.
    const formId = form.getAttribute("id");
    if (formId === "account-form") {
      const data = formData(form);
      const payload = {
        label: data.label,
        server: data.server,
        channel: data.channel,
        status: data.status,
        notes: data.notes,
      };
      if (data.id) await api(`/api/accounts/${data.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else {
        const created = await api("/api/accounts", { method: "POST", body: JSON.stringify(payload) });
        state.selectedAccountId = created.id;
      }
      form.closest("dialog").close();
      setPage("accounts");
      showToast("账号已保存");
      await load();
    } else if (formId === "character-form") {
      const data = formData(form);
      const payload = {
        account_id: Number(data.account_id),
        name: data.name,
        school: data.school,
        appearance: data.appearance,
        level: Number(data.level),
        notes: data.notes,
      };
      if (data.id) await api(`/api/characters/${data.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else {
        const created = await api("/api/characters", { method: "POST", body: JSON.stringify(payload) });
        state.selectedCharacterId = created.id;
        state.selectedAccountId = payload.account_id;
      }
      form.closest("dialog").close();
      setPage("accounts");
      showToast("角色已保存");
      await load();
    } else if (formId === "snapshot-form") {
      const data = formData(form);
      const payload = {
        character_id: Number(data.character_id),
        recorded_at: `${data.recorded_at}:00+08:00`,
        gold: Number(data.gold || 0),
        silver: Number(data.silver || 0),
        jade: Number(data.jade || 0),
        char_score: Number(data.char_score || 0),
        equip_score: Number(data.equip_score || 0),
        pet_score: Number(data.pet_score || 0),
        notes: data.notes,
      };
      await api("/api/snapshots", { method: "POST", body: JSON.stringify(payload) });
      state.selectedCharacterId = payload.character_id;
      form.closest("dialog").close();
      setPage("records");
      showToast("已记下这笔");
      await load();
    }
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm("导入这份备份？")) return;
    const replace = confirm("用备份覆盖本机全部记录？确定会覆盖，取消则合并到现有数据。");
    await api("/api/import", {
      method: "POST",
      body: JSON.stringify({ mode: replace ? "replace" : "merge", data }),
    });
    showToast(replace ? "已用备份覆盖" : "已合并备份");
    await load();
  } catch (error) {
    showToast(error.message || "导入失败");
  }
});

setPage(state.page);
chooseBackend().then(() => load()).catch((error) => {
  view.innerHTML = `<p class="empty">${esc(error.message)}</p>`;
});
