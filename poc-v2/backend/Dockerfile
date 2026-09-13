# SysML v2 MBSE — Backend Dockerfile
# multi-stage build：先编译 Go 二进制，再放入 distroless 运行时
#
# 镜像：~25 MB（含 modernc.org/sqlite 静态链接）
# 启动：监听 8080，SQLite 文件位于 /data/sysmlv2.db（由 docker volume 持久化）

# ---- builder ----
FROM golang:1.23-alpine AS builder

WORKDIR /src

# 先复制 go.mod/go.sum 以利用 Docker layer 缓存
COPY go.mod go.sum ./
RUN go mod download

# 复制源码并编译
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/server ./cmd/server

# ---- runtime ----
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=builder /out/server /app/server

# 数据卷：持久化 SQLite
VOLUME ["/data"]
ENV DB_PATH=/data/sysmlv2.db
ENV PORT=8080
ENV GIN_MODE=release

EXPOSE 8080

USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
