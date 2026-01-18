# Copilot Instructions

## Language
* Work in English

## Project Overview

This is a VS Code extension for generating external tables for SQL Server PolyBase data virtualization.

* **Extension Name**: MSSQL Data Virtualization Wizard
* **Extension ID**: `gadeynebram.mssql-datavirtualization`
* **Main Command**: `mssql-datavirtualization.virtualizeDataWizard` - Launches the data virtualization wizard
* **Main Entry Point**: `src/extension.ts`

## Dependencies

* Requires the `ms-mssql.mssql` extension as a dependency
* Uses the MSSQL extension's API for connection management and query execution

## Project Structure

```
├── src/
│   └── extension.ts         # Main extension code with VirtualizationWizard class
├── typings/
│   └── vscode-mssql.d.ts    # Type definitions for MSSQL extension API
├── package.json             # Extension manifest
├── tsconfig.json           # TypeScript configuration
└── README.md               # Extension documentation
```

## Wizard Implementation

The `VirtualizationWizard` class in `src/extension.ts` implements a complete multi-step wizard:

1. **GetMSSQLAPI**: Activates and retrieves the MSSQL extension API
2. **PromptForConnection**: Prompts user to select/create a SQL Server connection
3. **PromptForDatabase**: Allows user to select a database (or use the current one)
4. **PromptExternalDatasource**: Queries and displays available external data sources in the selected database
5. **CreateDVWExternalDatabasesTable**: Creates temporary external table to master.sys.databases for database discovery
6. **PromptForExternalDatabases**: Multi-select UI for choosing external databases to explore
7. **CreateDVWDiscoveryTablesForAllExternalDatabases**: Creates temporary external tables (sys.tables, sys.views, sys.schemas) for each selected database
8. **PromptForTablesAndViews**: Multi-select UI for choosing tables and views to virtualize
9. **GenerateExternalTableScripts**: Generates CREATE EXTERNAL TABLE statements using schema detection via error messages
10. **OpenScriptsInEditor**: Displays generated SQL scripts in a new editor tab
11. **CleanupDVWTables**: Removes all temporary discovery tables

## Key Technical Approach

### Schema Detection via PolyBase Error Messages

The extension uses a creative approach to detect schemas:
- Creates dummy external tables with `[idontexist] BIT NULL`
- SQL Server returns error 105083 with actual schema: "The detected external table schema is: ([col1] TYPE, [col2] TYPE, ...)"
- Parses the error message to extract the real schema
- Creates the external table with the detected schema

### Temporary Discovery Tables (DVW_*)

The wizard creates temporary external tables with prefix `DVW_` to query remote metadata:
- `DVW_sys_databases_*`: Discovers available databases
- `DVW_<dbname>_sys_tables_*`: Discovers tables in a database
- `DVW_<dbname>_sys_views_*`: Discovers views in a database  
- `DVW_<dbname>_sys_schemas_*`: Schema information

These are automatically cleaned up at the end of the process.

## Key Points

* Only SQL Server external data sources are currently supported
* All DDL statements are prefixed with `use ${this.SelectedDatabase};` for proper context
* Fresh connection URIs are obtained before each query operation to avoid OwnerUri staleness
* Progress notifications are shown for long-running operations (discovery, script generation, cleanup)

## Version Management

When updating extension or dependency versions:

* Update `engines.vscode` in `package.json` for VS Code version changes
* Update `@types/vscode` in `devDependencies` to match the VS Code version
* Update the version badges in `README.md` to reflect the new minimum versions:
  - VS Code badge: Update the version in the shield and link to code.visualstudio.com
  - MSSQL Extension badge: Update the version and link to the corresponding GitHub release (e.g., https://github.com/microsoft/vscode-mssql/releases/tag/v1.38.0)
* Update `version` in `package.json` for extension releases
