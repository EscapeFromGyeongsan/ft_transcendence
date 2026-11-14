# Full application (web, API, PostgreSQL behind HTTPS Nginx) in containers.
# `make` prepares missing secrets and certificates, then starts it on this
# computer's IP so another computer can join (HOST=<IP> picks the address).
# `make local` starts it on https://localhost only.
COMPOSE = docker compose --env-file .env --project-directory . \
	-p cyber-board-cafe-full -f infra/compose.full.yaml
# clean/fclean address the Compose projects by name only, so they work even
# when .env is missing or incomplete.
PROJECTS = cyber-board-cafe-full cyber-board-cafe
ARTIFACTS = apps/web/dist test-results playwright-report

.PHONY: all up local prepare down logs ps clean fclean re \
	qa-accounts dev test e2e build db-migrate db-generate dev-qa-accounts \
	dev-shell dev-down

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

# Creates qa-p1~p4 and qa-outsider (@qa.example.com) in the running `make`
# application, with QA_PASSWORD from .env. The script runs inside the API
# container and calls that API directly; existing accounts are kept.
qa-accounts:
	@docker exec cyber-board-cafe-full-api-1 true 2>/dev/null || \
		{ echo "Start the application first: make" >&2; exit 1; }
	@env_file=.env; . infra/env-value.sh; \
	docker exec -e QA_PASSWORD="$$(value_of QA_PASSWORD)" \
		-e QA_API_URL=http://127.0.0.1:3001 cyber-board-cafe-full-api-1 \
		node scripts/qa-accounts.mjs

# Removes the containers of the application and of development, and the build
# outputs. The database, avatars and dependencies (volumes) are kept.
clean:
	@for project in $(PROJECTS); do \
		docker compose -p $$project down --remove-orphans; \
	done
	rm -rf $(ARTIFACTS)

# Also removes the volumes (database, avatars, dependencies: all stored data)
# and the images built by `make`. .env, the database password file and the
# certificates are kept: they hold secrets that cannot be recreated, such as
# the 42 OAuth client secret.
fclean:
	@for project in $(PROJECTS); do \
		docker compose -p $$project down --volumes --remove-orphans; \
		docker image ls -q --filter label=com.docker.compose.project=$$project | \
			sort -u | xargs -r docker image rm -f; \
	done
	rm -rf $(ARTIFACTS)

re: fclean
	@$(MAKE) all

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

# The same QA accounts in the running `make dev` servers.
dev-qa-accounts:
	@sh infra/dev.sh qa-accounts

dev-shell:
	@sh infra/dev.sh shell

# Stops the development containers. The database and dependencies are kept.
dev-down:
	@sh infra/dev.sh down
