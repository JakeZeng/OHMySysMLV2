# syntax=docker/dockerfile:1.7
#
# SysML v2 MBSE — Backend Dockerfile
# multi-stage build：先编译 Go 二进制，再放入 alpine 运行时
#
# 镜像：~25 MB（含 modernc.org/sqlite 静态链接 + alpine + tini）
# 启动：监听 8080，SQLite 文件位于 /data/sysmlv2.db（由 docker volume 持久化）
#
# 关键变更（对比 M2 commit 36f964e 旧版）
# ────────────────────────────────────────
#   1. runtime 从 distroless 换 alpine
#      旧版 distroless 无 shell / 无 tini / 无 wget，main.go 的
#      graceful shutdown（srv.Shutdown）信号不被转发，且 compose 里的
#      healthcheck 引用 /app/server -version 但 main.go 无 -version
#      flag——整套 healthcheck 是死配置。
#   2. 加 tini 做 PID 1
#      alpine 自带 tini 包，2 MB 不到，正确转发 SIGTERM/SIGINT 给
#      ENTRYPOINT，让 Gin 的 graceful shutdown 真的能跑。
#   3. 切 nonroot uid 10001（distroless:nonroot 是随机 UID，固定 10001
#      方便和 compose volume 权限对齐）
#
# compose healthcheck 改动见独立 commit（fix(compose): update
# backend healthcheck to wget）。

# ---- builder ----
FROM golang:1.23-alpine AS builder

WORKDIR /src

# GOPROXY 用国内镜像（GOPROXY 默认 proxy.golang.org 在大陆环境不可达）。
# goproxy.cn 是七牛运营的官方镜像；aliyun 是另一个。
# 用 build-arg 注入；默认指向 goproxy.cn，本地构建可 `docker build
# --build-arg GOPROXY=https://goproxy.io,direct .` 覆盖。
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY} GOSUMDB=off

# 先复制 go.mod/go.sum 以利用 Docker layer 缓存
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/server ./cmd/server

# ---- runtime ----
FROM alpine:3.20

# ca-certificates：HTTPS 客户端需要（AI API 调用 OpenAI/DeepSeek/Anthropic）
# tini         ：PID 1 信号转发，让 main.go 的 graceful shutdown 生效
RUN apk add --no-cache ca-certificates tini \
    && adduser -D -u 10001 -g '' app

WORKDIR /app

COPY --from=builder /out/server /app/server
RUN chown -R app:app /app

# 数据卷：持久化 SQLite
RUN mkdir -p /data && chown app:app /data
VOLUME ["/data"]

ENV DB_PATH=/data/sysmlv2.db \
    PORT=8080 \
    GIN_MODE=release

EXPOSE 8080

USER app

# tini 转发 SIGTERM/SIGINT，让 main.go 的 srv.Shutdown(ctx) 真的能跑
ENTRYPOINT ["/sbin/tini", "--", "/app/server"]
