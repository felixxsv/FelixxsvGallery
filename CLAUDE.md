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

#### 1. サーバーの未コミット変更をローカルに取り込む
```bash
# サーバーで変更されているファイルを確認
sshpass -p "jimon.jp0710" ssh felix@192.168.10.102 "cd /data/felixxsv-gallery && git status --short"

# 変更ファイルをローカルにscpで取得（例）
sshpass -p "jimon.jp0710" scp felix@192.168.10.102:/data/felixxsv-gallery/<path> /home/felix/felixxsv-gallery/<path>
```

#### 2. ローカルでコミット・プッシュ（syu → main マージ）
```bash
git add <files>
git commit -m "..."
git push origin syu

# .120 は main ブランチなので syu を main にマージしてpush
git checkout main
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
- pullの前に必ずサーバー側のワーキングツリーをリセット（`git reset HEAD . && git checkout -- .`）する
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
