#!/bin/sh
# Monitors get a number of their own within each account (their address is /m/<num>/<name>), and each agent is
# keyed by its monitor's id ("m-<id>") instead of a name someone typed. Run as root with the service stopped:
#   systemctl stop agenda-delivery && sh 2026-11-monitor-numbers.sh && systemctl start agenda-delivery
set -eu
DATA=${DATA:-/var/lib/agenda}
DB="$DATA/agenda.db"
SQL="sudo -u agenda sqlite3 -bail $DB"
cp "$DB" "$DB.before-monitor-numbers"

has_col() { $SQL "SELECT count(*) FROM pragma_table_info('$1') WHERE name = '$2'"; }
[ "$(has_col user monitor_seq)" = 1 ] || $SQL "ALTER TABLE user ADD COLUMN monitor_seq INTEGER NOT NULL DEFAULT 0"
[ "$(has_col monitor num)" = 1 ] || $SQL "ALTER TABLE monitor ADD COLUMN num INTEGER NOT NULL DEFAULT 0"
# Each account's monitors are numbered in the order they were added.
$SQL "UPDATE monitor SET num = (SELECT count(*) FROM monitor m2 WHERE m2.user_id = monitor.user_id AND m2.id <= monitor.id) WHERE num = 0"
$SQL "UPDATE user SET monitor_seq = max(monitor_seq, coalesce((SELECT max(num) FROM monitor WHERE user_id = user.id), 0))"
$SQL "CREATE UNIQUE INDEX IF NOT EXISTS monitor_user_num ON monitor (user_id, num)"

# Each agent's folder, label and key move to m-<id>.
$SQL "SELECT id || ' ' || slug FROM monitor WHERE slug != 'm-' || id" | while read -r id old; do
  new="m-$id"
  [ -d "$DATA/agents/$old" ] && mv "$DATA/agents/$old" "$DATA/agents/$new"
  $SQL "UPDATE monitor SET slug = '$new' WHERE id = $id; UPDATE agent SET home = '$DATA/agents/$new', unit = 'agent:$new' WHERE monitor_id = $id"
  echo "monitor $id: $old -> $new"
done
$SQL "SELECT u.email || '  /m/' || m.num || '  ' || m.slug FROM monitor m JOIN user u ON u.id = m.user_id ORDER BY u.id, m.num"
