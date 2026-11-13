# Full application (web, API, PostgreSQL behind HTTPS Nginx) in containers.
# `make` prepares missing secrets and certificates, then starts it on this
# computer's IP so another computer can join (HOST=<IP> picks the address).
# `make local` starts it on https://localhost only.
COMPOSE = docker compose --env-file .env.full --project-directory . \
	-p cyber-board-cafe-full -f infra/compose.full.yaml

.PHONY: all up local prepare down logs ps

all: up

up:
	@sh infra/start-full.sh lan "$(HOST)"

local:
	@sh infra/start-full.sh local

prepare:
	@sh infra/prepare-full.sh

# Stops the containers. The database and avatar volumes are kept.
down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps
