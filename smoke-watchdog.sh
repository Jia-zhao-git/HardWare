#!/bin/sh
# watchdog: kill old, start v8
PATH=/bin:/usr/bin:/sbin:/usr/sbin
for pid in $(ps | grep 'smoke-test' | grep -v grep | awk '{print $1}'); do
    kill $pid 2>/dev/null
done
sleep 2
if ! ps | grep -v grep | grep -q 'smoke-test-v8.sh'; then
    rm -rf /data/smoke_test
    mkdir -p /data/smoke_test
    /bin/sh /data/smoke-test-v8.sh &
fi
