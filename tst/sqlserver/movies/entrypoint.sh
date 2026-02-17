#!/usr/bin/env bash
set -euo pipefail

/opt/mssql/bin/sqlservr &

for i in {1..60}; do
  /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -N -C -Q "SELECT 1" >/dev/null 2>&1 && break
  sleep 2
done

/opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -N -C -i /scripts/init.sql

wait
