# 梦幻西游手游账号数据

在浏览器里记录自己的账号、角色，以及每次上线时的金币、银币、仙玉和评分。页面按北京时间显示，并能算出相对上一笔的涨跌。

这里记的是你亲手填写的进度，不会连接游戏，也不会登录网易账号。请不要把登录账号、密码或将军令写进称呼和备注。

## 直接打开

合并到 `main` 之后，GitHub Pages 会发布这个页面：

https://lyghuangyan.github.io/mhxysyaccountdata/

打开就能用，不用安装 Python。记录保存在这台浏览器里，不会写进公开仓库。换电脑、换浏览器，或清理站点数据之前，先在总览里导出 JSON 备份。

如果打开后是 404，到仓库的 Settings → Pages，把 Source 选成 GitHub Actions，等一次发布完成后再打开上面的地址。

## 在自己电脑上启动

需要 Python 3.11 或更高版本，不需要额外安装包。

```bash
python3 -m mhxy_accounts
```

浏览器打开 http://127.0.0.1:8765 。服务只监听本机。

常用参数：

```bash
python3 -m mhxy_accounts --db data/mhxy.db --host 127.0.0.1 --port 8765
```

## 怎么用

1. 在「账号」里添加称呼和服务器。称呼是你自己认的名字。
2. 在账号下添加角色，填写门派、造型和等级。
3. 在「记录」里按北京时间记一笔金币、银币、仙玉和三项评分。
4. 「总览」按每个角色最新一笔合计资产，并列出最近的变化。
5. 用「导出备份」保存 JSON。换电脑时再导入。导入时可以选择合并，或用备份覆盖本机全部记录。

## 接口

本机页面和脚本可以用这些接口写入同一份数据库。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/api/summary` | 账号数、角色数、最新资产合计、最近记录 |
| `POST` | `/api/accounts` | 添加账号 |
| `POST` | `/api/characters` | 添加角色，字段含 `account_id` |
| `POST` | `/api/snapshots` | 记一笔，字段含 `character_id`、`gold`、`silver`、`jade` 和评分 |
| `GET` | `/api/export` | 导出全部数据 |
| `POST` | `/api/import` | `{"mode":"merge","data":...}` 或 `replace` |

记一笔的例子：

```bash
curl -s -X POST http://127.0.0.1:8765/api/snapshots \
  -H 'Content-Type: application/json' \
  -d '{"character_id":1,"recorded_at":"2026-10-30T21:00:00+08:00","gold":120000,"silver":8000,"jade":60}'
```

没写的金额按 0 保存。`recorded_at` 可以是带时区的时间，或 `YYYY-MM-DD`（按北京时间零点）。

## 测试

```bash
python3 -m unittest discover -s tests -t . -v
```
