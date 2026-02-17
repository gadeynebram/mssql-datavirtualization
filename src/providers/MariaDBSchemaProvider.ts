import * as vscode from 'vscode';
import { IExtension, IConnectionInfo, IConnectionSharingService } from 'vscode-mssql';
import { ISchemaProvider } from './ISchemaProvider';
import { TableViewItem } from './types';

/**
 * MariaDB-specific implementation of schema detection and external table operations.
 * Uses ODBC connectivity and INFORMATION_SCHEMA views for metadata discovery.
 * 
 * Key differences from MSSQL:
 * - LOCATION format is lowercase and case-sensitive: 'information_schema.tables' not '[INFORMATION_SCHEMA].[TABLES]'
 * - MariaDB has no schema layer - database = schema in MariaDB terminology
 * - Uses INFORMATION_SCHEMA.SCHEMATA, TABLES, COLUMNS for metadata
 * - Still uses error message parsing (error 105083) for schema detection
 */
export class MariaDBSchemaProvider implements ISchemaProvider {
  private readonly api: IExtension;
  private readonly connection: IConnectionInfo;
  private readonly connectionSharingService: IConnectionSharingService;
  private readonly extensionId: string = 'gadeynebram.mssql-datavirtualization';
  private connectionUri: string | undefined;
  private selectedDatabase: string | undefined;
  private discoveryTables: string[] = [];
  private baseDataSourceName: string | undefined;
  private baseConnectionOptions: string | undefined;

  constructor(api: IExtension, connection: IConnectionInfo, connectionUri: string) {
    this.api = api;
    this.connection = connection;
    this.connectionUri = connectionUri;
    this.connectionSharingService = api.connectionSharing;
  }

  async initialize(database: string): Promise<void> {
    this.selectedDatabase = database;
    await this.getFreshConnectionUri();
  }

  async listExternalDataSources(): Promise<string[]> {
    if (!this.connectionSharingService) {
      throw new Error('listExternalDataSources: ConnectionSharingService is not set!');
    }
    if (!this.selectedDatabase) {
      throw new Error('listExternalDataSources: Database is not initialized!');
    }

    const query = `use ${this.selectedDatabase}; SELECT name FROM sys.external_data_sources where connection_options like '%mariadb%' or connection_options like '%mysql%' order by name`;
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    const sources = result.rows;
    
    if (sources.length === 0) {
      throw new Error('Could not find external datasources in the selected database.');
    }

    return sources.map((row: any) => row[0].displayValue);
  }

  async listExternalDatabases(dataSource: string): Promise<string[]> {
    if (!this.connectionSharingService) {
      throw new Error('listExternalDatabases: ConnectionSharingService is not set!');
    }

    // Store base data source info for later use
    this.baseDataSourceName = dataSource;
    await this.extractConnectionOptions(dataSource);

    // Create DVW external table to information_schema.schemata
    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const localName = `DVW_information_schema_schemata_${suffix}`;
    const localFullName = `[${localSchema}].[${localName}]`;
    // MariaDB: LOCATION is lowercase and case-sensitive
    const remote = `information_schema.schemata`;

    await this.dropExternalTable(localSchema, localName);
    const created = await this.createExternalTableWithDetection(localFullName, remote, dataSource);
    if (created) {
      this.discoveryTables.push(`${localSchema}.${localName}`);
    } else {
      throw new Error('listExternalDatabases: Could not create DVW_information_schema_schemata due to missing detected schema.');
    }

    // Query the DVW table for database names
    const dvwSchemaTable = this.discoveryTables.find(t => t.includes('DVW_information_schema_schemata_'));
    if (!dvwSchemaTable) {
      throw new Error('listExternalDatabases: DVW_information_schema_schemata table not found');
    }

    const query = `use ${this.selectedDatabase}; 
SELECT SCHEMA_NAME 
FROM [${dvwSchemaTable.replace('.', '].[')}] 
WHERE SCHEMA_NAME NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY SCHEMA_NAME`;
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    const rows = result.rows || [];
    
    if (rows.length === 0) {
      throw new Error('listExternalDatabases: No external databases found via information_schema.schemata');
    }

    return rows.map(r => r[0].displayValue);
  }

  async createDiscoveryInfrastructure(dataSource: string, externalDatabases: string[]): Promise<void> {
    for (const externalDb of externalDatabases) {
      await this.createDVWDiscoveryTables(externalDb, dataSource);
    }
  }

  async listTablesAndViews(externalDatabases: string[]): Promise<TableViewItem[]> {
    if (!this.connectionSharingService) {
      throw new Error('listTablesAndViews: ConnectionSharingService is not set!');
    }

    const allItems: TableViewItem[] = [];

    for (const extDb of externalDatabases) {
      const safeDbName = extDb.replace(/[^a-zA-Z0-9]/g, '_');
      const tablesTable = this.discoveryTables.find(t => t.includes(`DVW_${safeDbName}_information_schema_tables_`));

      if (!tablesTable) {
        vscode.window.showWarningMessage(`DVW: Skipping ${extDb} - discovery table not found`);
        continue;
      }

      // Query tables and views
      const query = `use ${this.selectedDatabase}; 
SELECT table_name, table_type
FROM [${tablesTable.replace('.', '].[')}]
WHERE table_schema = '${extDb}'
  AND table_type IN ('BASE TABLE', 'VIEW')
ORDER BY table_name`;
      const ownerUri = await this.getFreshConnectionUri();
      const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);

      for (const row of result.rows) {
        const tableName = row[0].displayValue;
        const tableType = row[1].displayValue;
        const type = tableType === 'BASE TABLE' ? 'U' : 'V';
        
        allItems.push({
          externalDb: extDb,
          schema: extDb, // In MariaDB, database = schema
          name: tableName,
          type: type,
          displayLabel: `[${extDb}].[${tableName}] (${tableType === 'BASE TABLE' ? 'Table' : 'View'})`
        });
      }
    }

    return allItems;
  }

  async detectSchema(remote: string, dataSource: string, nameHint?: string): Promise<string | undefined> {
    if (!this.connectionSharingService) {
      throw new Error('detectSchema: ConnectionSharingService not initialized');
    }
    
    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const tempName = nameHint ? `DVW_${nameHint}_${suffix}` : `DVW_probe_${suffix}`;
    const localFullName = `[${localSchema}].[${tempName}]`;

    // MariaDB: LOCATION format is 'database.table' (lowercase, case-sensitive)
    const dummyCreate = `use ${this.selectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName}\n(\n    [NonExistingColumn] NVARCHAR(64) NULL\n)\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
    
    try {
      const ownerUri = await this.getFreshConnectionUri();
      await this.connectionSharingService.executeSimpleQuery(ownerUri, dummyCreate);
      // Unexpected success: best-effort drop to keep environment clean
      try { await this.dropExternalTable(localSchema, tempName); } catch { /* ignore */ }
      return undefined;
    } catch (e: any) {
      const message = (e && e.message) ? e.message as string : `${e}`;
      const detected = this.parseDetectedSchemaFromErrorMessage(message);
      return detected;
    }
  }

  generateCreateScript(item: TableViewItem, detectedSchema: string, dataSource: string): string {
    // MariaDB: LOCATION = 'database.table' (no schema layer)
    const remote = `${item.externalDb}.${item.name}`;
    const localSchema = 'dbo';
    const localName = item.name;
    const localFullName = `[${localSchema}].[${localName}]`;
    
    const lines: string[] = [];
    lines.push(`-- External ${item.type === 'U' ? 'Table' : 'View'}: ${item.externalDb}.${item.name}`);
    lines.push(`CREATE EXTERNAL TABLE ${localFullName}`);
    lines.push(detectedSchema);
    lines.push(`WITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`);
    lines.push('');
    
    return lines.join('\n');
  }

  async cleanupDiscoveryTables(): Promise<void> {
    if (!this.connectionSharingService || this.discoveryTables.length === 0) {
      return;
    }

    for (const fullName of this.discoveryTables) {
      const parts = fullName.split('.');
      if (parts.length === 2) {
        await this.dropExternalTable(parts[0], parts[1]);
      }
    }

    this.discoveryTables = [];
  }

  dispose(): void {
    this.connectionUri = undefined;
    this.selectedDatabase = undefined;
    this.discoveryTables = [];
    this.baseDataSourceName = undefined;
    this.baseConnectionOptions = undefined;
  }

  // Private helper methods

  /**
   * Extract connection options from existing external data source
   */
  private async extractConnectionOptions(dataSource: string): Promise<void> {
    if (!this.connectionSharingService || !this.selectedDatabase) {
      throw new Error('extractConnectionOptions: Service or database not initialized');
    }

    const query = `use ${this.selectedDatabase}; 
SELECT location, connection_options 
FROM sys.external_data_sources 
WHERE name = '${dataSource}'`;
    
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    
    if (result.rows.length > 0) {
      this.baseConnectionOptions = result.rows[0][1].displayValue;
    }
  }

  private async createDVWDiscoveryTables(externalDbName: string, dataSource: string): Promise<void> {
    if (!this.connectionSharingService) {
      throw new Error('createDVWDiscoveryTables: ConnectionSharingService is not set!');
    }
    if (!this.selectedDatabase) {
      throw new Error('createDVWDiscoveryTables: Database is not set!');
    }

    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const safeDbName = externalDbName.replace(/[^a-zA-Z0-9]/g, '_');
    
    // For each database, create external table to information_schema.tables
    // MariaDB: LOCATION format is lowercase 'information_schema.tables'
    const localName = `DVW_${safeDbName}_information_schema_tables_${suffix}`;
    const localFullName = `[${localSchema}].[${localName}]`;
    const remote = `information_schema.tables`;

    await this.dropExternalTable(localSchema, localName);
    const created = await this.createExternalTableWithDetection(localFullName, remote, dataSource);
    if (created) {
      this.discoveryTables.push(`${localSchema}.${localName}`);
    }
  }

  private async createExternalTableWithDetection(localFullName: string, remote: string, dataSource: string): Promise<boolean> {
    if (!this.connectionSharingService) {
      throw new Error('createExternalTableWithDetection: ConnectionSharingService not initialized');
    }
    
    const dummyCreate = `use ${this.selectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName}\n(\n    [NonExistingColumn] NVARCHAR(64) NULL\n)\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
    
    try {
      const ownerUri = await this.getFreshConnectionUri();
      await this.connectionSharingService.executeSimpleQuery(ownerUri, dummyCreate);
      return true;
    } catch (e: any) {
      const message = (e && e.message) ? e.message as string : `${e}`;
      const detected = this.parseDetectedSchemaFromErrorMessage(message);
      if (detected) {
        const correctedCreate = `use ${this.selectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName} ${detected}\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
        const ownerUri2 = await this.getFreshConnectionUri();
        await this.connectionSharingService.executeSimpleQuery(ownerUri2, correctedCreate);
        return true;
      }
      vscode.window.showWarningMessage(`DVW: Could not detect schema for ${remote}. Skipping creation of ${localFullName}.`);
      return false;
    }
  }

  private async dropExternalTable(schema: string, name: string): Promise<void> {
    if (!this.connectionSharingService) {
      throw new Error('dropExternalTable: ConnectionSharingService not initialized');
    }
    
    const dropGuarded = `IF EXISTS (SELECT 1 FROM sys.external_tables et JOIN sys.schemas s ON et.schema_id = s.schema_id WHERE s.name = N'${schema}' AND et.name = N'${name}')\nBEGIN\n  DROP EXTERNAL TABLE [${schema}].[${name}];\nEND`;
    
    try {
      const ownerUri = await this.getFreshConnectionUri();
      const query = `use ${this.selectedDatabase};\n${dropGuarded}`;
      await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    } catch (e: any) {
      // ignore drop failures for DVW objects
      console.log(e.message);
    }
  }

  private parseDetectedSchemaFromErrorMessage(message: string): string | undefined {
    // Extract schema from SQL Server error 105083:
    // "The detected external table schema is: ([BookId] INT, [Title] NVARCHAR(200) ...)."
    const marker = 'The detected external table schema is:';
    const idx = message.indexOf(marker);
    if (idx === -1) {
      return undefined;
    }
    const tail = message.substring(idx + marker.length).trim();
    const startParen = tail.indexOf('(');
    const endParen = tail.lastIndexOf(')');
    if (startParen === -1 || endParen === -1 || endParen <= startParen) {
      return undefined;
    }
    const schemaSegment = tail.substring(startParen, endParen + 1);
    return schemaSegment;
  }

  private async getFreshConnectionUri(): Promise<string> {
    if (!this.api || !this.connection || !this.connectionSharingService) {
      throw new Error('getFreshConnectionUri: API/Connection/ConnectionSharingService not initialized');
    }
    
    let uri = await this.api.connect(this.connection);
    const connected = this.connectionSharingService.isConnected(uri);
    if (!connected) {
      const connId = await this.connectionSharingService.getActiveEditorConnectionId(this.extensionId);
      if (connId) {
        const sharedUri = await this.connectionSharingService.connect(this.extensionId, connId, this.selectedDatabase);
        if (sharedUri) {
          uri = sharedUri;
        }
      }
    }
    this.connectionUri = uri;
    return uri;
  }
}
