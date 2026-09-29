FROM eclipse-temurin:17-jre

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Paper 1.12.2 + EaglerXServer, EaglerXRewind, ViaVersion, SkinsRestorer, AuthMe
ARG TEMPLATE_REPO=https://github.com/Eaglercraft-Templates/Eaglercraft-Server-Paper
RUN git clone --depth 1 "$TEMPLATE_REPO" /opt/template && rm -rf /opt/template/.git

COPY scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /data
VOLUME /data
EXPOSE 25565

ENV MEMORY=2G \
    EULA=false \
    MOTD="An Eaglercraft Server" \
    MAX_PLAYERS=20 \
    VIEW_DISTANCE=6

ENTRYPOINT ["/entrypoint.sh"]
