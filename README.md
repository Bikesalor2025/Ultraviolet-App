# Eaglercraft Server Host

Runs an Eaglercraft server in Docker: Paper 1.12.2 with EaglerXServer, built from
[Eaglercraft-Server-Paper](https://github.com/Eaglercraft-Templates/Eaglercraft-Server-Paper).

It supports EaglercraftX 1.8, Eaglercraft 1.12.2, Eaglercraft 1.5.2, and Java Edition clients, all on port 25565.

## Start

Requires Docker.

```sh
docker compose up -d --build
```

Setting `EULA: "true"` in `docker-compose.yml` means you accept the [Minecraft EULA](https://aka.ms/MinecraftEULA).

## Connect

In an Eaglercraft client, add a server with this address:

- Same computer: `ws://localhost:25565`
- Other devices: `ws://<your-ip>:25565` (forward port 25565 on your router to reach it from the internet)
- A client loaded over HTTPS needs `wss://`, so put the server behind a TLS reverse proxy (Caddy, nginx, or Cloudflare Tunnel).

Players must `/register <password> <password>` the first time and `/login <password>` after that (AuthMe).

## Manage

| Task | Command |
|---|---|
| Server console | `docker attach eaglercraft` (detach: Ctrl+P, Ctrl+Q) |
| Logs | `docker compose logs -f` |
| Stop | `docker compose down` |
| Make someone op | Type `op <name>` in the server console |

## Settings

Edit `environment` in `docker-compose.yml`, then run `docker compose up -d`:

| Variable | Default | Purpose |
|---|---|---|
| `MEMORY` | `2G` | Java heap size |
| `MOTD` | `An Eaglercraft Server` | Server list message |
| `MAX_PLAYERS` | `20` | Player limit |
| `VIEW_DISTANCE` | `6` | Keep low; high values cause "End of stream" errors |

The world, plugins, and configs are saved in `./server-data`. EaglerXServer settings are in `server-data/plugins/EaglercraftXServer/`.
