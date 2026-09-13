# SysML v2 MBSE — Frontend Dockerfile
# multi-stage build：Vite 构建静态文件 → nginx 服务
#
# 镜像：~30 MB（nginx alpine + 静态资源）
# 默认通过 docker-compose 暴露 3000；容器内 nginx 监听 80

# ---- builder ----
FROM node:22-alpine AS builder

WORKDIR /src

# 1. 先生成 parser.generated.ts（M1 解析器依赖）
COPY ../parser /parser
WORKDIR /parser
RUN npm ci --no-audit --no-fund
RUN npm run build || true
WORKDIR /src

# 2. 安装前端依赖并构建
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine

# 自定义 nginx 配置：转发 /api 到后端
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /src/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O- http://localhost/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
