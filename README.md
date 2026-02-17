# MSSQL Data Virtualization Wizard

[![VS Code](https://img.shields.io/badge/VS%20Code-1.109.0%2B-blue)](https://code.visualstudio.com/)
[![MSSQL Extension](https://img.shields.io/badge/MSSQL%20Extension-v1.39.0%2B-blue)](https://github.com/microsoft/vscode-mssql/releases/tag/v1.38.0)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This VS Code extension provides a step-by-step wizard to connect external SQL Server databases via PolyBase and automatically generate `CREATE EXTERNAL TABLE` statements.

> **Note**: As confirmed by Microsoft in [this discussion](https://github.com/microsoft/vscode-mssql/discussions/19462), "As of now, there isn't a direct replacement for the Virtualize Data extension in VS Code, neither we have planned to support this feature in the MSSQL extension." This community extension fills that gap.

## Features

The wizard executes the following steps:

1. **Select Connection**: Choose a SQL Server database connection
2. **Select Database**: Choose the target database where external tables will be created
3. **Select Provider Type**: Choose SQL Server or MariaDB/MySQL discovery mode
4. **Select Destination Schema**: Choose the schema for created external tables (default: `dbo`)
5. **Select External Data Source**: Choose an existing PolyBase external data source
6. **Discover External Databases**: Select one or more external databases to connect to
7. **Select Tables/Views**: Choose which tables and views you want to virtualize
8. **Generate Scripts**: The wizard automatically detects the schemas of external objects and generates corresponding `CREATE EXTERNAL TABLE` statements
9. **Review Scripts**: The generated DDL is displayed in a new SQL editor tab
10. **Cleanup**: All temporary discovery tables are automatically removed

## Usage

To start the wizard:

1. Press **CTRL + Shift + P** (or **CMD + Shift + P** on macOS) to open the Command Palette
2. Type and select **"Virtualize Data Wizard"**
3. Follow the step-by-step wizard to generate your external table scripts

## How It Works

The wizard leverages PolyBase schema detection:

- For each selected table or view, the wizard sends a dummy `CREATE EXTERNAL TABLE` statement to SQL Server
- SQL Server returns an error message containing the actual schema of the external object
- The wizard parses this detected schema and generates a correct `CREATE EXTERNAL TABLE` statement
- After detection, all temporary external tables are automatically cleaned up

## Prerequisites

- **VS Code 1.70.0 or higher**
- **MSSQL extension** (ms-mssql.mssql) - this is a required dependency. This extension manages database connections. For setup instructions, see the [vscode-mssql repository](https://github.com/Microsoft/vscode-mssql)
- **SQL Server 2016 or higher** with PolyBase installed and configured. For PolyBase setup instructions, see the [PolyBase guide](https://learn.microsoft.com/en-us/sql/relational-databases/polybase/polybase-guide?view=sql-server-ver17)
- **Existing PolyBase external data source** configured in the target database. For external data source configuration, see [CREATE EXTERNAL DATA SOURCE](https://learn.microsoft.com/en-us/sql/t-sql/statements/create-external-data-source-transact-sql)
- **Network access** from your SQL Server to the external database

## Required SQL Server Privileges

The user account must have the following permissions in the target database:

- **CREATE EXTERNAL TABLE**: Required to create external tables
- **ALTER SCHEMA**: Required if creating external tables in non-dbo schemas
- **SELECT** on `sys.external_data_sources`: Required to discover available external data sources
- **SELECT** on `sys.schemas`, `sys.tables`, and `sys.views`: Required to query metadata of external objects (these are queried via temporary external tables)
- **ALTER DATABASE**: May be required if PolyBase is not yet enabled on the database

Minimal recommended role: `db_owner` or custom role with the above permissions.

## Supported External Data Sources

- **SQL Server external data sources** via PolyBase
- **MariaDB/MySQL external data sources** via PolyBase + ODBC

Other PolyBase sources (Azure Blob Storage, Hadoop, etc.) are not supported at this time.

## Test Infrastructure

See [tst/README.md](tst/README.md) for a Docker/Podman compose environment with SQL Server (PolyBase), a dummy SQL Server, and a MariaDB instance.

## Note on Temporary Tables

During the discovery process, the wizard creates temporary external tables (with prefix `DVW_`):

- `DVW_sys_databases_*`: For discovering available external databases
- `DVW_*_sys_tables_*`: For discovering tables in external databases
- `DVW_*_sys_views_*`: For discovering views in external databases
- `DVW_*_sys_schemas_*`: For discovering schema information

These tables are automatically removed at the end of the process. They are temporary and exist solely to support the discovery process.
