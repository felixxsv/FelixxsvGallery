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

## デプロイ手順（必ずこの順序で行う）

### 前提
- 編集の実態はサーバー (`felix@192.168.10.102`, `/data/felixxsv-gallery`) にある
- ローカル (`/home/felix/felixxsv-gallery`) はgitで管理するための場所

### 手順

#### 1. サーバーの未コミット変更をローカルに取り込む
```bash
# サーバーで変更されているファイルを確認
sshpass -p "jimon.jp0710" ssh felix@192.168.10.102 "cd /data/felixxsv-gallery && git status --short"

# 変更ファイルをローカルにscpで取得（例）
sshpass -p "jimon.jp0710" scp felix@192.168.10.102:/data/felixxsv-gallery/<path> /home/felix/felixxsv-gallery/<path>
```

#### 2. ローカルでコミット・プッシュ
```bash
git add <files>
git commit -m "..."
git push origin syu
```

#### 3. サーバーでpull・再起動
```bash
# サーバーのワーキングツリーをクリーン（取り込み済みなので安全）
sshpass -p "jimon.jp0710" ssh felix@192.168.10.102 \
  "cd /data/felixxsv-gallery && git reset HEAD . && git checkout -- . && git pull"

# APIサーバー再起動（Pythonバックエンドの変更時のみ）
sshpass -p "jimon.jp0710" ssh felix@192.168.10.102 \
  "echo 'jimon.jp0710' | sudo -S systemctl restart felixxsv-gallery-api"
```

#### 注意事項
- `git stash` はサーバーで使わない
- pullの前に必ずサーバー側のワーキングツリーをリセット（`git reset HEAD . && git checkout -- .`）する
- フロントエンド（HTML/CSS/JS）の変更のみならAPIサーバー再起動は不要
- Pythonファイル（`app/`）を変更した場合は必ず再起動する

## deploy/ ディレクトリ
- `deploy/` 以下のsystemdファイル等、本番環境に関わるファイルの変更は必ず事前確認すること

## sudo / システム操作
- `sudo` を使う操作は必ず事前確認すること
- `/etc` 等のシステムディレクトリには触らない

## 作業範囲
- プロジェクトルート (`/home/felix/felixxsv-gallery`) の外のファイルは操作しない
