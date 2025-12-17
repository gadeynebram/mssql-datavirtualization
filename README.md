# MSSQL Data Virtualization Wizard

This VS Code extension provides a step-by-step wizard to connect external SQL Server databases via PolyBase and automatically generate `CREATE EXTERNAL TABLE` statements.

## Features

The wizard executes the following steps:

1. **Select Connection**: Choose a SQL Server database connection
2. **Select Database**: Choose the target database where external tables will be created
3. **Select External Data Source**: Choose an existing PolyBase external data source
4. **Discover External Databases**: Select one or more external databases to connect to
5. **Select Tables/Views**: Choose which tables and views you want to virtualize
6. **Generate Scripts**: The wizard automatically detects the schemas of external objects and generates corresponding `CREATE EXTERNAL TABLE` statements
7. **Review Scripts**: The generated DDL is displayed in a new SQL editor tab
8. **Cleanup**: All temporary discovery tables are automatically removed

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

Currently, only **SQL Server external data sources** are supported. Other PolyBase sources (Azure Blob Storage, Hadoop, etc.) are not supported at this time.

## Note on Temporary Tables

During the discovery process, the wizard creates temporary external tables (with prefix `DVW_`):

- `DVW_sys_databases_*`: For discovering available external databases
- `DVW_*_sys_tables_*`: For discovering tables in external databases
- `DVW_*_sys_views_*`: For discovering views in external databases
- `DVW_*_sys_schemas_*`: For discovering schema information

These tables are automatically removed at the end of the process. They are temporary and exist solely to support the discovery process.

## Command

- `Virtualize Data Wizard`: Start the data virtualization wizard
