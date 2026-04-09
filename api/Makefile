migrate:
	goose up

generate:
	go generate ./...

fmt-sql:
	syntaqlite fmt -i sql/**/*.sql sql/*.sql

fmt-go:
	go fmt ./...

fmt: fmt-sql fmt-go
