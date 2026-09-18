# syntax=docker/dockerfile:1.7
#
# SysML v2 MBSE Frontend (React + Vite + nginx)
# ─────────────────────────────────────────────────────────────────────────────
# Build:  docker buildx build -f frontend/Dockerfile .
#         (从仓库根 poc-v2/ 跑；build context 必须含 frontend/ + parser/)
# Run:    docker run --rm -p 3000:80 --link sysmlv2-backend:backend \
#               sysmlv2-mbse/frontend:dev
# 访问:   http://localhost:3000   (容器内 nginx :80)
#
# 关键变更（对比 M2 commit 36f964e 旧版）
# ────────────────────────────────────────
#   1. 移除 COPY ../parser /parser
#      旧版跨 build context 复制会失败（旧 CI 若真跑会挂）；
#      改用 build context = 仓库根，直接 COPY parser/ 整个目录。
#   2. 移除 RUN npm run build || true（吞错）
#      parser 生成失败必须显式 fail，不再被 || true 吞掉。
#   3. 删 nginx 默认 welcome 页面 + 切 nonroot
#      安全加固项（M3 安全清单）。
#   4. healthcheck 用 wget
#
# 前置条件
# ─────────
#   parser/parser.generated.ts 必须存在（git tracked；CI 跑 npm run
#   parser:build 会保持最新）。不在 docker 内 build parser——避免跨
#   context COPY ../parser 的 bug。

# ─── Stage 1: builder ───────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /build

# 装前端依赖（先 package*.json 走缓存）
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# 复制前端源码
COPY frontend/ ./

# 复制同级工具目录（vite.config.ts 用 @parser / @validator / @transform / @ast alias）
# WORKDIR=/build，alias `../parser` 解析为 /parser/。
COPY parser/      ../parser/
COPY validator/   ../validator/
COPY transform/   ../transform/
COPY ast/         ../ast/

# elkjs 不在 frontend/package.json 里（只在根 poc-v2/package.json 里），
# 但 transform/layoutEngine.ts 直接 import 'elkjs/lib/elk.bundled.js'。
# 解决：在每个可能解析 elkjs 的源目录里放一份 node_modules 符号链接，
# 让 Node 的 node_modules 向上查找能找到包。
# 局限：elkjs 自己也依赖一些包；用 npm install --prefix 完整克隆：
RUN for d in parser validator transform ast; do \
      mkdir -p /${d}/node_modules && \
      cp -r /build/node_modules/. /${d}/node_modules/ 2>/dev/null || \
        ln -s /build/node_modules /${d}/node_modules; \
    done

# Vite build：产物在 /build/dist/
RUN npm run build

# ─── Stage 2: runtime (nginx) ──────────────────────────────────────────────
FROM nginx:1.27-alpine

# 删掉 nginx 默认 welcome 页面
RUN rm -f /etc/nginx/conf.d/default.conf

# 创建 nonroot 用户（M3 安全加固）
RUN adduser -D -u 10001 -g '' app

# 复制 build 产物
COPY --from=build /build/dist /usr/share/nginx/html

# 复制仓库自带的 nginx.conf（含 /api/* 反代 + SPA fallback）
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# nginx 运行时需要写：PID / cache / log 目录
# 切 nonroot 前 chown 这些路径
RUN chown -R app:app /var/cache/nginx /var/log/nginx /run \
    && chown -R app:app /usr/share/nginx/html

# 健康检查：访问 SPA 根，验证 nginx 起来且静态文件可服务
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=5s \
    CMD wget -q --spider http://localhost/ || exit 1

EXPOSE 80

USER app

# 沿用 nginx:alpine 默认 CMD
CMD ["nginx", "-g", "daemon off;"]
