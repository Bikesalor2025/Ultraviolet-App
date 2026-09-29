#!/bin/sh
set -e

if [ "$EULA" != "true" ]; then
  echo "You must accept the Minecraft EULA (https://aka.ms/MinecraftEULA)."
  echo "Set EULA=true to continue."
  exit 1
fi

# First run: copy the server template into the data volume
if [ ! -f /data/paper-1.12.2.jar ]; then
  echo "Setting up server files in /data..."
  cp -rn /opt/template/. /data/
fi

echo "eula=true" > /data/eula.txt

set_prop() {
  if grep -q "^$1=" server.properties; then
    sed -i "s|^$1=.*|$1=$2|" server.properties
  else
    echo "$1=$2" >> server.properties
  fi
}
set_prop motd "$MOTD"
set_prop max-players "$MAX_PLAYERS"
set_prop view-distance "$VIEW_DISTANCE"

exec java -Xms"$MEMORY" -Xmx"$MEMORY" -XX:+UseG1GC -XX:+ParallelRefProcEnabled \
  -XX:MaxGCPauseMillis=200 -XX:+DisableExplicitGC -jar paper-1.12.2.jar nogui
