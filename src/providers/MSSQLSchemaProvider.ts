import * as vscode from 'vscode';
import { IExtension, IConnectionInfo, IConnectionSharingService } from 'vscode-mssql';
import { ISchemaProvider } from './ISchemaProvider';
import { TableViewItem } from './types';

/**
 * MSSQL-specific implementation of schema detection and external table operations.
 * Uses SQL Server PolyBase error messages to detect remote table schemas.
 */
export class MSSQLSchemaProvider implements ISchemaProvider {
  private readonly api: IExtension;
  private readonly connection: IConnectionInfo;
  private readonly connectionSharingService: IConnectionSharingService;
  private readonly extensionId: string = 'gadeynebram.mssql-datavirtualization';
  private connectionUri: string | undefined;
  private selectedDatabase: string | undefined;
  private discoveryTables: string[] = [];

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

    const query = `use ${this.selectedDatabase}; SELECT name FROM sys.external_data_sources order by name`;
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

    // Create DVW external table to master.sys.databases
    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const localName = `DVW_sys_databases_${suffix}`;
    const localFullName = `[${localSchema}].[${localName}]`;
    const remote = `[master].[sys].[databases]`;

    await this.dropExternalTable(localSchema, localName);
    const created = await this.createExternalTableWithDetection(localFullName, remote, dataSource);
    if (created) {
      this.discoveryTables.push(`${localSchema}.${localName}`);
    } else {
      throw new Error('listExternalDatabases: Could not create DVW_sys_databases due to missing detected schema.');
    }

    // Query the DVW table for database names
    const dvwDbTable = this.discoveryTables.find(t => t.includes('DVW_sys_databases_'));
    if (!dvwDbTable) {
      throw new Error('listExternalDatabases: DVW_sys_databases table not found');
    }

    const query = `use ${this.selectedDatabase}; SELECT name FROM [${dvwDbTable.replace('.', '].[')}] ORDER BY name`;
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    const rows = result.rows || [];
    
    if (rows.length === 0) {
      throw new Error('listExternalDatabases: No external databases found via DVW_sys_databases');
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
      const tablesTable = this.discoveryTables.find(t => t.includes(`DVW_${safeDbName}_sys_tables_`));
      const viewsTable = this.discoveryTables.find(t => t.includes(`DVW_${safeDbName}_sys_views_`));
      const schemasTable = this.discoveryTables.find(t => t.includes(`DVW_${safeDbName}_sys_schemas_`));

      if (!tablesTable || !viewsTable || !schemasTable) {
        vscode.window.showWarningMessage(`DVW: Skipping ${extDb} - discovery tables not found`);
        continue;
      }

      // Query tables
      const tablesQuery = `use ${this.selectedDatabase}; 
SELECT s.name as schema_name, t.name as table_name, 'U' as type
FROM [${tablesTable.replace('.', '].[')}] t
JOIN [${schemasTable.replace('.', '].[')}] s ON t.schema_id = s.schema_id
ORDER BY s.name, t.name`;
      const tablesOwnerUri = await this.getFreshConnectionUri();
      const tablesResult = await this.connectionSharingService.executeSimpleQuery(tablesOwnerUri, tablesQuery);

      for (const row of tablesResult.rows) {
        const schemaName = row[0].displayValue;
        const tableName = row[1].displayValue;
        allItems.push({
          externalDb: extDb,
          schema: schemaName,
          name: tableName,
          type: 'U',
          displayLabel: `[${extDb}].[${schemaName}].[${tableName}] (Table)`
        });
      }

      // Query views
      const viewsQuery = `use ${this.selectedDatabase}; 
SELECT s.name as schema_name, v.name as view_name, 'V' as type
FROM [${viewsTable.replace('.', '].[')}] v
JOIN [${schemasTable.replace('.', '].[')}] s ON v.schema_id = s.schema_id
ORDER BY s.name, v.name`;
      const viewsOwnerUri = await this.getFreshConnectionUri();
      const viewsResult = await this.connectionSharingService.executeSimpleQuery(viewsOwnerUri, viewsQuery);

      for (const row of viewsResult.rows) {
        const schemaName = row[0].displayValue;
        const viewName = row[1].displayValue;
        allItems.push({
          externalDb: extDb,
          schema: schemaName,
          name: viewName,
          type: 'V',
          displayLabel: `[${extDb}].[${schemaName}].[${viewName}] (View)`
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

    const dummyCreate = `use ${this.selectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName}\n(\n    [idontexist] BIT NULL\n)\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
    
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
    const remote = `[${item.externalDb}].[${item.schema}].[${item.name}]`;
    const localSchema = item.schema;
    const localName = item.name;
    const localFullName = `[${localSchema}].[${localName}]`;
    
    const lines: string[] = [];
    lines.push(`-- External ${item.type === 'U' ? 'Table' : 'View'}: ${remote}`);
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
  }

  // Private helper methods

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
    const baseNames = [
      { localName: `DVW_${safeDbName}_sys_tables_${suffix}`, remote: `[${externalDbName}].[sys].[tables]` },
      { localName: `DVW_${safeDbName}_sys_views_${suffix}`, remote: `[${externalDbName}].[sys].[views]` },
      { localName: `DVW_${safeDbName}_sys_schemas_${suffix}`, remote: `[${externalDbName}].[sys].[schemas]` }
    ];

    for (const item of baseNames) {
      const localFullName = `[${localSchema}].[${item.localName}]`;
      // For DVW discovery tables, drop first (safe to recreate)
      await this.dropExternalTable(localSchema, item.localName);
      const created = await this.createExternalTableWithDetection(localFullName, item.remote, dataSource);
      if (created) {
        this.discoveryTables.push(`${localSchema}.${item.localName}`);
      }
    }
  }

  private async createExternalTableWithDetection(localFullName: string, remote: string, dataSource: string): Promise<boolean> {
    if (!this.connectionSharingService) {
      throw new Error('createExternalTableWithDetection: ConnectionSharingService not initialized');
    }
    
    const dummyCreate = `use ${this.selectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName}\n(\n    [idontexist] BIT NULL\n)\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
    
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
    // "The detected external table schema is: ([nr] INT NOT NULL)."
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
