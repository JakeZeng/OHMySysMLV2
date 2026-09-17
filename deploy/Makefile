# SysML v2 MBSE — 部署命令入口
#
# 用法（需要 GNU make；Windows 用 Git Bash 自带）：
#   make help
#   make build                 # 本地构建两个镜像
#   make deploy                # 部署（pull + restart + health）
#   make deploy-build          # 部署（本地 build 而非 pull）
#   make rollback              # 回滚到上次 tag
#   make status                # 状态查询
#   make backup                # 立即备份
#   make backups               # 列出备份
#   make logs                  # 跟踪日志
#   make stop                  # 停止
#   make down                  # 停止并清理容器（保留 volume）
#   make clean                 # 彻底清理（含 volume）⚠
#   make health                # 健康检查
#   make env-check             # 校验 .env.production
#   make init                  # 首次部署：生成 .env.production + secrets

SHELL := /usr/bin/env bash

ROOT_DIR := $(shell cd "$(dir $(abspath $(firstword $(MAKEFILE_LIST))))/.." && pwd)
DEPLOY_DIR := $(ROOT_DIR)/deploy
COMPOSE_FILE := $(ROOT_DIR)/docker-compose.prod.yml
ENV_FILE := $(DEPLOY_DIR)/.env.production

.PHONY: help build deploy deploy-build rollback status backup backups logs \
        stop down clean health env-check init

help: ## 显示帮助
	@printf "\nSysML v2 MBSE — 部署命令\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'
	@printf "\n"

init: ## 首次部署：生成 .env.production + JWT secret
	@if [[ ! -f "$(ENV_FILE)" ]]; then \
		cp "$(DEPLOY_DIR)/.env.production.example" "$(ENV_FILE)" && \
		SECRET=$$(openssl rand -hex 32) && \
		sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$$SECRET|" "$(ENV_FILE)" && \
		rm -f "$(ENV_FILE).bak" && \
		echo "✓ 已生成 $(ENV_FILE)" && \
		echo "  JWT_SECRET 已写入（随机 64 hex）"; \
	else \
		echo "! $(ENV_FILE) 已存在，跳过（删除后重跑 make init）"; \
	fi
	@echo ""
	@echo "下一步：编辑 $(ENV_FILE) 填入 AI_API_KEY、CORS_ALLOWED_ORIGINS 等"

env-check: ## 校验 .env.production（占位符检查）
	@bash $(DEPLOY_DIR)/deploy.sh --status 2>&1 | head -5 || true
	@if grep -q '^JWT_SECRET=CHANGE-ME' "$(ENV_FILE)" 2>/dev/null; then \
		echo "✗ JWT_SECRET 未设置"; exit 1; \
	fi
	@echo "✓ JWT_SECRET 已设置"
	@if grep -q '^AI_API_KEY=sk-CHANGE-ME' "$(ENV_FILE)" 2>/dev/null; then \
		echo "! AI_API_KEY 是占位（AI 端点将不可用）"; \
	else \
		echo "✓ AI_API_KEY 已设置"; \
	fi

build: ## 本地构建 backend + frontend 镜像
	docker build -t sysmlv2-mbse/backend:$(or $(IMAGE_TAG),latest) \
		-f $(ROOT_DIR)/poc-v2/backend/Dockerfile $(ROOT_DIR)/poc-v2/backend
	docker build -t sysmlv2-mbse/frontend:$(or $(IMAGE_TAG),latest) \
		-f $(ROOT_DIR)/poc-v2/frontend/Dockerfile $(ROOT_DIR)/poc-v2

deploy: ## 部署（拉取镜像 + 滚动重启 + 健康检查）
	bash $(DEPLOY_DIR)/deploy.sh

deploy-build: ## 部署（本地构建 + 滚动重启 + 健康检查）
	bash $(DEPLOY_DIR)/deploy.sh --build

rollback: ## 回滚到上次部署的 tag
	bash $(DEPLOY_DIR)/deploy.sh --rollback

status: ## 显示当前部署状态
	bash $(DEPLOY_DIR)/deploy.sh --status

backup: ## 立即创建一次备份
	bash $(DEPLOY_DIR)/backup.sh snapshot

backups: ## 列出所有备份
	bash $(DEPLOY_DIR)/backup.sh list

logs: ## 跟踪日志
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) logs -f --tail=100

stop: ## 停止服务（保留 volume）
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) stop

down: ## 停止并删除容器（保留 volume 和镜像）
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) down

clean: ## ⚠ 停止并删除容器、卷、镜像（数据不可恢复）
	@echo "⚠  这将删除 volume sysmlv2-backend-data-prod 和所有镜像"
	@read -p "确认? (yes/no): " ans && [[ "$$ans" == "yes" ]] || { echo "已取消"; exit 1; }
	docker compose -f $(COMPOSE_FILE) --env-file $(ENV_FILE) down -v --rmi all

health: ## 健康检查（一次）
	bash $(DEPLOY_DIR)/health-check.sh

health-wait: ## 健康检查（持续等到就绪）
	bash $(DEPLOY_DIR)/health-check.sh --wait