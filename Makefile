# Full application (web, API, PostgreSQL behind HTTPS Nginx) in containers.
# `make` prepares missing secrets and certificates, then starts it on this
# computer's IP so another computer can join (HOST=<IP> picks the address).
# `make local` starts it on https://localhost only.
COMPOSE = docker compose --env-file .env --project-directory . \
	-p cyber-board-cafe-full -f infra/compose.full.yaml

.PHONY: all up local prepare down logs ps \
	dev test e2e build db-migrate db-generate qa-accounts dev-shell dev-down

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

# Development and tests in a Node.js container (infra/dev.sh); the host needs
# only Docker. They use the development database of infra/compose.yaml, not
# the `make` application above. ARGS passes options, e.g.
# make test ARGS=apps/server, make e2e ARGS="tests/gomoku.spec.ts".
dev:
	@sh infra/dev.sh dev

test:
	@sh infra/dev.sh test $(ARGS)

e2e:
	@sh infra/dev.sh e2e $(ARGS)

build:
	@sh infra/dev.sh build

db-migrate:
	@sh infra/dev.sh migrate

db-generate:
	@sh infra/dev.sh generate "$(NAME)"

qa-accounts:
	@sh infra/dev.sh qa-accounts

dev-shell:
	@sh infra/dev.sh shell

# Stops the development containers. The database and dependencies are kept.
dev-down:
	@sh infra/dev.sh down
