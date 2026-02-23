import * as vscode from 'vscode';
import { IExtension, IConnectionInfo, IConnectionSharingService } from 'vscode-mssql';
import { ISchemaProvider } from './ISchemaProvider';
import { TableViewItem } from './types';

/**
 * Oracle-specific implementation of schema detection and external table operations.
 * Uses Oracle PolyBase connector (oracle://) and ALL_* views for metadata discovery.
 * 
 * Key characteristics:
 * - LOCATION format uses oracle:// connection string format
 * - Oracle has schema layer (user = schema in Oracle terminology)
 * - Uses ALL_USERS, ALL_TABLES, ALL_TAB_COLUMNS for metadata
 * - Still uses error message parsing (error 105083) for schema detection
 */
export class OracleSchemaProvider implements ISchemaProvider {
  private readonly api: IExtension;
  private readonly connection: IConnectionInfo;
  private readonly connectionSharingService: IConnectionSharingService;
  private readonly extensionId: string = 'gadeynebram.mssql-datavirtualization';
  private connectionUri: string | undefined;
  private selectedDatabase: string | undefined;
  private discoveryTables: string[] = [];
  private oracleDatabaseName: string | undefined;

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

    const query = `use ${this.selectedDatabase}; SELECT name FROM sys.external_data_sources where location like 'oracle://%' order by name`;
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    const sources = result.rows;
    
    if (sources.length === 0) {
      throw new Error('Could not find Oracle external datasources in the selected database.');
    }

    return sources.map((row: any) => row[0].displayValue);
  }

  async listExternalDatabases(dataSource: string): Promise<string[]> {
    if (!this.connectionSharingService) {
      throw new Error('listExternalDatabases: ConnectionSharingService is not set!');
    }

    // Extract Oracle database name from the external data source location
    await this.extractOracleDatabaseName(dataSource);

    // Create DVW external table to ALL_USERS with 3-part name
    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const localName = `DVW_ALL_USERS_${suffix}`;
    const localFullName = `[${localSchema}].[${localName}]`;
    const remote = `${this.oracleDatabaseName}.SYS.ALL_USERS`;

    await this.dropExternalTable(localSchema, localName);
    const created = await this.createExternalTableWithDetection(localFullName, remote, dataSource);
    if (created) {
      this.discoveryTables.push(`${localSchema}.${localName}`);
    } else {
      throw new Error('listExternalDatabases: Could not create DVW_ALL_USERS due to missing detected schema.');
    }

    // Query the DVW table for schema/user names
    const dvwUsersTable = this.discoveryTables.find(t => t.includes('DVW_ALL_USERS_'));
    if (!dvwUsersTable) {
      throw new Error('listExternalDatabases: DVW_ALL_USERS table not found');
    }

    // Oracle: Filter out system schemas
    const query = `use ${this.selectedDatabase}; 
SELECT USERNAME 
FROM [${dvwUsersTable.replace('.', '].[')}] 
WHERE USERNAME NOT IN ('SYS', 'SYSTEM', 'DBSNMP', 'SYSMAN', 'OUTLN', 'MDSYS', 'ORDSYS', 
                       'EXFSYS', 'DMSYS', 'WMSYS', 'CTXSYS', 'ANONYMOUS', 'XDB', 'XS$NULL',
                       'ORACLE_OCM', 'GSMADMIN_INTERNAL', 'APPQOSSYS', 'OJVMSYS', 'DVF',
                       'DBSFWUSER', 'REMOTE_SCHEDULER_AGENT', 'DIP', 'APEX_PUBLIC_USER',
                       'FLOWS_FILES', 'APEX_040000', 'APEX_040200', 'ORDS_PUBLIC_USER')
ORDER BY USERNAME`;
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    const rows = result.rows || [];
    
    if (rows.length === 0) {
      throw new Error('listExternalDatabases: No external schemas found via ALL_USERS');
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
      const tablesTable = this.discoveryTables.find(t => t.includes(`DVW_${safeDbName}_ALL_TABLES_`));

      if (!tablesTable) {
        vscode.window.showWarningMessage(`DVW: Skipping ${extDb} - discovery table not found`);
        continue;
      }

      // Query tables and views from ALL_TABLES
      // Oracle: TABLE_TYPE is not directly available in ALL_TABLES, need to check ALL_VIEWS separately
      const query = `use ${this.selectedDatabase}; 
SELECT OWNER, TABLE_NAME
FROM [${tablesTable.replace('.', '].[')}]
WHERE OWNER = '${extDb}'
ORDER BY TABLE_NAME`;
      const ownerUri = await this.getFreshConnectionUri();
      const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);

      for (const row of result.rows) {
        const owner = row[0].displayValue;
        const tableName = row[1].displayValue;
        
        // For Oracle, we'll mark all as tables (U) for simplicity
        // In a more sophisticated implementation, we could query ALL_VIEWS separately
        allItems.push({
          externalDb: extDb,
          schema: owner,
          name: tableName,
          type: 'U',
          displayLabel: `[${owner}].[${tableName}] (Table)`
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

  generateCreateScript(item: TableViewItem, detectedSchema: string, dataSource: string, localSchema?: string): string {
    // Oracle: LOCATION = 'DATABASE.SCHEMA.TABLE' (3-part name required)
    const remote = `${this.oracleDatabaseName}.${item.schema}.${item.name}`;
    const destSchema = localSchema || 'dbo';
    const localName = item.name;
    const localFullName = `[${destSchema}].[${localName}]`;
    
    const lines: string[] = [];
    lines.push(`-- External ${item.type === 'U' ? 'Table' : 'View'}: ${item.schema}.${item.name}`);
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
    this.oracleDatabaseName = undefined;
  }

  // Private helper methods

  /**
   * Extract Oracle database name from the external data source location string.
   * The location format is: oracle://hostname:port/DatabaseName
   */
  private async extractOracleDatabaseName(dataSource: string): Promise<void> {
    if (!this.connectionSharingService || !this.selectedDatabase) {
      throw new Error('extractOracleDatabaseName: Service or database not initialized');
    }

    const query = `use ${this.selectedDatabase}; 
SELECT location 
FROM sys.external_data_sources 
WHERE name = '${dataSource}'`;
    
    const ownerUri = await this.getFreshConnectionUri();
    const result = await this.connectionSharingService.executeSimpleQuery(ownerUri, query);
    
    if (result.rows.length > 0) {
      const location = result.rows[0][0].displayValue as string;
      // Extract database name from oracle://hostname:port/DatabaseName
      const match = location.match(/oracle:\/\/[^\/]+\/(.+)/);
      if (match && match[1]) {
        this.oracleDatabaseName = match[1];
      } else {
        // Fallback: prompt user if we can't extract it
        const userInput = await vscode.window.showInputBox({
          prompt: 'Enter the Oracle database/PDB name (e.g., Aviation, FREEPDB1)',
          placeHolder: 'Aviation',
          ignoreFocusOut: true,
          validateInput: (value: string) => {
            if (!value || value.trim().length === 0) {
              return 'Database name is required';
            }
            return null;
          }
        });
        
        if (userInput) {
          this.oracleDatabaseName = userInput.trim();
        } else {
          throw new Error('Oracle database name is required for creating external tables');
        }
      }
    } else {
      throw new Error(`External data source '${dataSource}' not found`);
    }
  }

  private async createDVWDiscoveryTables(externalSchemaName: string, dataSource: string): Promise<void> {
    if (!this.connectionSharingService) {
      throw new Error('createDVWDiscoveryTables: ConnectionSharingService is not set!');
    }
    if (!this.selectedDatabase) {
      throw new Error('createDVWDiscoveryTables: Database is not set!');
    }

    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const safeDbName = externalSchemaName.replace(/[^a-zA-Z0-9]/g, '_');
    
    // For each schema, create external table to ALL_TABLES with 3-part name
    const localName = `DVW_${safeDbName}_ALL_TABLES_${suffix}`;
    const localFullName = `[${localSchema}].[${localName}]`;
    const remote = `${this.oracleDatabaseName}.SYS.ALL_TABLES`;

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
    // "The detected external table schema is: ([column1] TYPE, [column2] TYPE ...)."
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
