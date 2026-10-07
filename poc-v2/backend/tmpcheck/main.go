package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

func main() {
	db, _ := sql.Open("sqlite", ":memory:")
	_, err := db.Exec(`CREATE TABLE views (id TEXT PRIMARY KEY)`)
	fmt.Println("create:", err)
	_, err = db.Exec(`ALTER TABLE views ADD COLUMN standard_view TEXT NOT NULL DEFAULT ''`)
	fmt.Println("alter:", err)
	rows, err := db.Query(`PRAGMA table_info(views)`)
	fmt.Println("pragma err:", err)
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull int
		var dflt any
		var pk int
		rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk)
		fmt.Println(" col:", name, ctype)
	}
}
