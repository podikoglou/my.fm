package db

import (
	"database/sql"

	_ "modernc.org/sqlite"
)

func OpenSQLite(dataSourceName string) (*sql.DB, error) {
	return sql.Open("sqlite", dataSourceName)
}
