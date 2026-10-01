#!/usr/bin/env bash
# EplyD end-to-end smoke test (new-feature pass)
set -u
BASE=http://127.0.0.1:3000
J=/tmp/eplyd-cookies.txt
rm -f $J
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  ok: $1"; }
bad(){ FAIL=$((FAIL+1)); echo "FAIL: $1"; }

# 1. login
CSRF=$(curl -s -c $J $BASE/api/v1/auth/me >/dev/null; grep eplyd_csrf $J | awk '{print $7}')
LOGIN=$(curl -s -b $J -c $J -X POST $BASE/api/v1/auth/login -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{"password":"eplyd-preview","remember":true}')
echo "$LOGIN" | grep -q '"role":"owner"' && ok "owner login" || bad "owner login: $LOGIN"

CSRF=$(grep eplyd_csrf $J | awk '{print $7}')

# 2. create template project
P=$(curl -s -b $J -X POST $BASE/api/v1/projects -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{"name":"smoke-js","template":"discordjs"}')
PID=$(echo "$P" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
[ -n "$PID" ] && ok "project created $PID" || bad "create: $P"

# 3. verify 24/7 defaults
DEF=$(curl -s -b $J $BASE/api/v1/projects/$PID)
echo "$DEF" | grep -q '"restart_policy":"always"' && ok "restart_policy=always default" || bad "restart policy: $(echo $DEF | head -c 200)"
echo "$DEF" | grep -q '"autostart":1' && ok "autostart=1 default" || bad "autostart"

# 4. env import (auto-detect, merge) + raw view; replace-mode tested after run
ENV1=$(curl -s -b $J -X POST $BASE/api/v1/projects/$PID/env/import -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{"text":"DISCORD_TOKEN=MTIzNDU2Nzg5MDEyMzQ1Njc4.client6.secretsecretsecretsecretsecretsecre\nLOG_LEVEL=debug\nBAD-NAME=x","mode":"merge"}')
echo "$ENV1" | grep -q '"secrets":1' && ok "import detects 1 secret" || bad "env import detect: $ENV1"
RAW=$(curl -s -b $J $BASE/api/v1/projects/$PID/env/raw)
echo "$RAW" | grep -q "DISCORD_TOKEN=MTIz" && ok "raw endpoint returns decrypted .env" || bad "raw: $RAW"
SECRETFLAG=$(curl -s -b $J "$BASE/api/v1/projects/$PID/env")
echo "$SECRETFLAG" | grep -q '"secret":false' && ok "secret flag present in list" || bad "secret flag: $SECRETFLAG"

# 5. start (auto-install on first start) and wait for running
ST=$(curl -s -b $J -X POST $BASE/api/v1/projects/$PID/start -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{}')
echo "$ST" | grep -q '"ok":true' && ok "start accepted" || bad "start: $ST"
RUNNING=0
for i in $(seq 1 40); do
  S=$(curl -s -b $J $BASE/api/v1/projects/$PID | sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' | head -1)
  case "$S" in
    running) RUNNING=1; break;;
    crashed|crash_loop|install_failed) break;;
  esac
  sleep 1
done
[ $RUNNING = 1 ] && ok "bot reached running (auto deps pipeline)" || bad "final status: $S"

# 5b. replace-mode import (while stopped) removes old keys
ENV2=$(curl -s -b $J -X POST $BASE/api/v1/projects/$PID/env/import -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{"text":"ONLY_THIS=persist","mode":"replace"}')
echo "$ENV2" | grep -q '"removed":2' && ok "replace mode removed 2 old keys" || bad "replace: $ENV2"
RESTORE=$(curl -s -b $J -X POST $BASE/api/v1/projects/$PID/env/import -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{"text":"DISCORD_TOKEN=MTIzNDU2Nzg5MDEyMzQ1Njc4.client6.secretsecretsecretsecretsecretsecre","mode":"merge"}')
echo "$RESTORE" | grep -q '"ok":true' && ok "token restored" || bad "restore: $RESTORE"

# 6. logs captured
LOGS=$(curl -s -b $J "$BASE/api/v1/projects/$PID/logs")
echo "$LOGS" | grep -qi "eplyd\|deps\|npm\|install" && ok "logs captured" || bad "logs: $(echo $LOGS | head -c 200)"

# 7. restart-then-fingerprint-skip: stop, start again, time it
curl -s -b $J -X POST $BASE/api/v1/projects/$PID/stop -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{}' >/dev/null
sleep 2
T0=$(date +%s)
curl -s -b $J -X POST $BASE/api/v1/projects/$PID/start -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{}' >/dev/null
for i in $(seq 1 30); do
  S=$(curl -s -b $J $BASE/api/v1/projects/$PID | sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' | head -1)
  [ "$S" = "running" ] && break
  sleep 1
done
T1=$(date +%s)
DT=$((T1-T0))
[ "$S" = "running" ] && [ $DT -le 10 ] && ok "second start fast (fingerprint skip): ${DT}s" || bad "second start ${DT}s status=$S"

# 8. stop and clean up
curl -s -b $J -X POST $BASE/api/v1/projects/$PID/stop -H "content-type: application/json" -H "x-csrf-token: $CSRF" -d '{}' >/dev/null
sleep 1.5
S=$(curl -s -b $J $BASE/api/v1/projects/$PID | sed -n 's/.*"status":"\([a-z_]*\)".*/\1/p' | head -1)
[ "$S" = "stopped" ] && ok "stopped cleanly" || bad "stop: $S"

curl -s -b $J -X DELETE $BASE/api/v1/projects/$PID -H "x-csrf-token: $CSRF" >/dev/null && ok "project deleted"

echo "-------------------------------------"
echo "SMOKE RESULT: pass=$PASS fail=$FAIL"
exit $([ $FAIL = 0 ] && echo 0 || echo 1)
