// one-shot helper: 通过 sqlite3 直接插一行 project_shares。
// 用途：W1 截图脚本调用，模拟"alice 直分享给 bob"。
// 不会被 go build ./... 编译（独立 main 包，单独运行）。
//
//   go run ./cmd/seed-share -db sysmlv2.db -project <pid> -user <uid> -by <aid> -perm read
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	dbPath := flag.String("db", "sysmlv2.db", "sqlite db path")
	projectID := flag.String("project", "", "project id")
	userID := flag.String("user", "", "user id")
	grantedBy := flag.String("by", "", "granted_by user id")
	perm := flag.String("perm", "read", "permission")
	flag.Parse()

	if *projectID == "" || *userID == "" || *grantedBy == "" {
		fmt.Fprintln(os.Stderr, "usage: seed-share -project <pid> -user <uid> -by <aid> [-perm read|write|admin] [-db path]")
		os.Exit(2)
	}

	db, err := sql.Open("sqlite", *dbPath)
	if err != nil {
		log.Fatalf("open: %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		log.Fatalf("pragma: %v", err)
	}

	res, err := db.Exec(
		`INSERT OR REPLACE INTO project_shares (project_id, user_id, permission, granted_by) VALUES (?, ?, ?, ?)`,
		*projectID, *userID, *perm, *grantedBy,
	)
	if err != nil {
		log.Fatalf("insert: %v", err)
	}
	n, _ := res.RowsAffected()
	log.Printf("seeded project_shares: project=%s user=%s perm=%s by=%s (rows=%d)",
		*projectID, *userID, *perm, *grantedBy, n)
}
