# Full application (web, API, PostgreSQL behind HTTPS Nginx) in containers.
# `make` prepares missing secrets and the local certificate, then starts it.
COMPOSE = docker compose --env-file .env.full --project-directory . \
	-p cyber-board-cafe-full -f infra/compose.full.yaml

.PHONY: all up prepare down logs ps

all: up

up: prepare
	$(COMPOSE) up --build -d --wait
	@port=$$(sed -n 's/^HTTPS_PORT=//p' .env.full | tail -n 1); \
	echo "Running: https://localhost:$${port:-8443}/"

prepare:
	@sh infra/prepare-full.sh

# Stops the containers. The database and avatar volumes are kept.
down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps
