# CLAUDE.md — プロジェクト指示・制約事項

## ファイル削除の禁止
- ファイルを削除する際は `rm` 等で消さず、`legacy_ref/` ディレクトリへ移動して退避すること
- 退避先は内容がわかるサブディレクトリを作って整理する（例: `legacy_ref/removed_20260404/`）

## legacy_ref/ の扱い
- `legacy_ref/` 内のファイルは**読み取り専用**として扱うこと
- 編集・削除・上書きは禁止

## SQLマイグレーションファイル
- `sql/` 以下の既存ファイルは**変更禁止**（適用済みマイグレーションを変更するとDBが壊れる）
- 新しいマイグレーションは新規ファイルとして追加すること

## 設定ファイル
- `gallery.conf`（実際の設定ファイル）には触らない（認証情報等が含まれる）
- `gallery.conf.sample` はサンプルなので変更は最小限に

## Git操作
- `git push --force` / `git reset --hard` / `git clean -f` は禁止
- コミット・プッシュは必ず事前に確認を取ること
- **サーバー上で `git stash` は使わない**（未コミットの編集が消えてバグの原因になる）

## サーバー上での直接編集禁止
- **サーバー上のファイルを直接編集してはいけない**（コード・設定ファイルとも）
- すべての変更はローカルで編集 → commit → push → サーバーで pull の流れで反映する
- **例外**: 環境変数や `gallery.conf` 等、リポジトリに含まれない/含めるべきでないものはサーバー上での編集が必要な場合がある
- ファイルのやり取りに `scp` を使わない。git のみで運用する
- **もしサーバー上に未コミットの差分が残っている場合**: そのサーバー上で `git add` → `git commit` → `git push` してリポジトリに取り込み、ローカルと他サーバーは `git pull` で同期する（その差分が要らないものなら破棄するか確認を取る）

## サーバー構成（2台）

| サーバー | ホスト名 | 役割 | ブランチ | 認証方式 |
|---|---|---|---|---|
| `192.168.10.102` | felixxsv2 | Apache リバースプロキシ・HTTPS終端。ファイルは配信しない | `syu` | パスワード認証（`sshpass`） |
| `192.168.10.120` | web02 | **実際の配信サーバー**。FastAPI + 静的ファイルをここから配信 | `main` | 公開鍵認証（`sshpass` 不要） |

**静的ファイル（HTML/CSS/JS）も含めすべて `.120` から配信される。`.102` だけにpullしても本番に反映されない。**

## デプロイ手順（必ずこの順序で行う）

### 前提
- **ローカル (`/home/felix/felixxsv-gallery`) は `syu` ブランチで作業する**
- ローカルで `syu` を編集・コミットし、`main` にマージして各サーバーへ反映する
- **`.102` は `syu` ブランチ・パスワード認証、`.120` は `main` ブランチ・公開鍵認証で運用**

### 手順

#### 1. 各サーバーの状態を確認
```bash
# .102（syuブランチ）
sshpass -p "jimon.jp0710" ssh felix@192.168.10.102 "cd /data/felixxsv-gallery && git status --short"

# .120（mainブランチ）
ssh felix@192.168.10.120 "cd /data/felixxsv-gallery && git status --short"
```

サーバーに未コミットの差分が残っていた場合、`scp` でローカルに取らず、**そのサーバー上で commit → push** してリポジトリに取り込む（要らない差分なら破棄するかユーザーに確認）。

```bash
# 例: .120 に必要な未コミット変更がある場合（main ブランチなのでそのまま push できる）
ssh felix@192.168.10.120 \
  "cd /data/felixxsv-gallery && git add <files> && git -c user.name=felix -c user.email=felix@local commit -m '...' && git push origin main"

# その後ローカルで origin/main を取り込む
git fetch origin
git checkout syu
git merge origin/main
```

#### 2. ローカルでコミット・プッシュ（syu → main マージ）
```bash
git add <files>
git commit -m "..."
git push origin syu

# .120 は main ブランチなので syu を main にマージしてpush
git checkout main
git pull origin main      # サーバー側で先に push されている可能性に備える
git merge syu
git push origin main
git checkout syu
```

#### 3. 両サーバーでpull・再起動
```bash
# .102（syuブランチ）をpull
sshpass -p "jimon.jp0710" ssh felix@192.168.10.102 \
  "cd /data/felixxsv-gallery && git reset HEAD . && git checkout -- . && git pull"

# .120（mainブランチ）をpull ← これをしないと本番に反映されない（公開鍵認証）
ssh felix@192.168.10.120 \
  "cd /data/felixxsv-gallery && git reset HEAD . && git checkout -- . && git pull"

# APIサーバー再起動（Pythonバックエンドの変更時のみ・公開鍵認証）
ssh felix@192.168.10.120 \
  "echo 'jimon.jp0710' | sudo -S systemctl restart felixxsv-gallery-api"
```

#### 注意事項
- `git stash` はサーバーで使わない
- `scp` を使わない。差分の受け渡しは git の push/pull のみ
- pullの前に必ずサーバー側のワーキングツリーをリセット（`git reset HEAD . && git checkout -- .`）する
  - ただしリセット前に未コミット差分がないか必ず確認し、ある場合は破棄せずまず commit→push する
- フロントエンド（HTML/CSS/JS）の変更のみならAPIサーバー再起動は不要
- Pythonファイル（`app/`）を変更した場合は必ず再起動する
- **再起動は `.120` に対して行う**（`.102` ではAPIは動いていない）

## deploy/ ディレクトリ
- `deploy/` 以下のsystemdファイル等、本番環境に関わるファイルの変更は必ず事前確認すること

## sudo / システム操作
- `sudo` を使う操作は必ず事前確認すること
- `/etc` 等のシステムディレクトリには触らない

## 作業範囲
- プロジェクトルート (`/home/felix/felixxsv-gallery`) の外のファイルは操作しない

## 言語
- **ユーザーへの返答・説明・要約はすべて日本語で書くこと**
- コード・コメントの言語は既存の慣習に従う
