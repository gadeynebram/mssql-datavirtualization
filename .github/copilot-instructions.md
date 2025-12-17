# Copilot Instructions

## Language
* Work in English

## Project Structure

### Main Directory: `vscode-mssqlext`
The primary working directory is `vscode-mssqlext`. The goal is to provide a minimal VS Code extension for generating external tables for an external data source using MS SQL Server PolyBase technology.

#### Current Implementation
The extension is currently a basic TypeScript-based VS Code extension with the following structure:

* **Extension Name**: MSSQL Data Virtualization Wizard (`vscode-mssqlext`)
* **Main Command**: `vscode-mssqlext.virtualizeDataWizard` - Launches the data virtualization wizard
* **Dependencies**: 
  - Requires the `ms-mssql.mssql` extension as a dependency
  - Uses the MSSQL extension's API for connection management and query execution

#### Wizard Flow
The `VirtualizationWizard` class implements a multi-step wizard that:
1. **GetMSSQLAPI**: Activates and retrieves the MSSQL extension API
2. **PromptForConnection**: Prompts user to select/create a SQL Server connection
3. **PromptForDatabase**: Allows user to select a database (or use the current one)
4. **PromptExternalDatasource**: Queries and displays available external data sources in the selected database
5. **GenerateVirtualizationScript**: (Placeholder - not yet implemented) Should generate external table creation scripts

#### Missing Functionality
* The `GenerateVirtualizationScript()` method is not implemented - this is the critical piece that should generate the PolyBase external table DDL
* No schema discovery or table mapping functionality
* No UI for column mapping or data type configuration

### Archive Directory: `azuredatastudioarchive`
The `azuredatastudioarchive` directory contains the implementation that was provided in Azure Data Studio. However, it is missing a crucial component: the language server components that perform the actual important operations.

## Key Points
* The VS Code extension should focus on PolyBase external table generation
* Reference the Azure Data Studio archive for context, but be aware of the missing language server functionality
* The language server components are the critical pieces that execute the core functionality
