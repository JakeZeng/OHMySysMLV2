package handler

import "os"

// getenv 返回环境变量；缺失时返回 fallback。
func getenv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}