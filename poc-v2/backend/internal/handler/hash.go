package handler

import (
	"crypto/sha256"
	"encoding/hex"
)

func sha256Of(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
