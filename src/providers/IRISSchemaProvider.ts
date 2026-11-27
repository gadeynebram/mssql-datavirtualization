import * as vscode from 'vscode';
import { SharedConnectionClient } from '../SharedConnectionClient';
import { ISchemaProvider } from './ISchemaProvider';
import { TableViewItem } from './types';

export class IRISSchemaProvider implements ISchemaProvider {
  private readonly connectionSharingService: SharedConnectionClient;
  private readonly namespace: string;
  private selectedDatabase: string | undefined;
  private discoveryTables: string[] = [];

  constructor(connectionSharingService: SharedConnectionClient, namespace: string) {
    this.connectionSharingService = connectionSharingService;
    this.namespace = namespace;
  }

  async initialize(database: string): Promise<void> {
    this.selectedDatabase = database;
  }

  async listExternalDataSources(): Promise<string[]> {
    this.ensureInitialized('listExternalDataSources');
    const query = `use ${this.selectedDatabase}; SELECT name FROM sys.external_data_sources WHERE location LIKE 'odbc://%' AND connection_options LIKE '%InterSystems IRIS%' ORDER BY name`;
    const result = await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, query);
    if (result.rows.length === 0) {
      throw new Error('Could not find InterSystems IRIS external data sources in the selected database.');
    }
    return result.rows.map((row: any) => row[0].displayValue);
  }

  async listExternalDatabases(dataSource: string): Promise<string[]> {
    this.ensureInitialized('listExternalDatabases');
    const suffix = Date.now().toString();
    const localName = `DVW_IRIS_SCHEMATA_${suffix}`;
    const localFullName = `[dbo].[${localName}]`;
    const remote = `${this.escapeLocationPart(this.namespace)}.INFORMATION_SCHEMA.SCHEMATA`;

    await this.dropExternalTable(localName);
    if (!await this.createExternalTableWithDetection(localFullName, remote, dataSource)) {
      throw new Error('listExternalDatabases: Could not detect the IRIS INFORMATION_SCHEMA.SCHEMATA schema.');
    }
    this.discoveryTables.push(`dbo.${localName}`);

    const query = `use ${this.selectedDatabase};
SELECT SCHEMA_NAME
FROM [dbo].[${localName}]
WHERE SCHEMA_NAME <> 'INFORMATION_SCHEMA'
ORDER BY SCHEMA_NAME`;
    const result = await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, query);
    return (result.rows || []).map((row: any) => row[0].displayValue);
  }

  async createDiscoveryInfrastructure(dataSource: string, externalDatabases: string[]): Promise<void> {
    this.ensureInitialized('createDiscoveryInfrastructure');
    for (const externalSchema of externalDatabases) {
      const suffix = Date.now().toString();
      const safeSchema = externalSchema.replace(/[^a-zA-Z0-9]/g, '_');
      const localName = `DVW_IRIS_${safeSchema}_TABLES_${suffix}`;
      const localFullName = `[dbo].[${localName}]`;
      const remote = `${this.escapeLocationPart(this.namespace)}.INFORMATION_SCHEMA.TABLES`;

      await this.dropExternalTable(localName);
      if (await this.createExternalTableWithDetection(localFullName, remote, dataSource)) {
        this.discoveryTables.push(`dbo.${localName}`);
      }
    }
  }

  async listTablesAndViews(externalDatabases: string[]): Promise<TableViewItem[]> {
    this.ensureInitialized('listTablesAndViews');
    const items: TableViewItem[] = [];

    for (const externalSchema of externalDatabases) {
      const safeSchema = externalSchema.replace(/[^a-zA-Z0-9]/g, '_');
      const tablesTable = this.discoveryTables.find(name => name.includes(`DVW_IRIS_${safeSchema}_TABLES_`));
      if (!tablesTable) {
        vscode.window.showWarningMessage(`DVW: Skipping ${externalSchema} - IRIS discovery table not found`);
        continue;
      }
      const localName = tablesTable.split('.')[1];
      const query = `use ${this.selectedDatabase};
SELECT TABLE_NAME, TABLE_TYPE
FROM [dbo].[${localName}]
WHERE TABLE_SCHEMA = '${this.escapeSqlLiteral(externalSchema)}'
  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
ORDER BY TABLE_NAME`;
      const result = await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, query);

      for (const row of result.rows || []) {
        const tableName = row[0].displayValue;
        const tableType = row[1].displayValue;
        items.push({
          externalDb: this.namespace,
          schema: externalSchema,
          name: tableName,
          type: tableType === 'VIEW' ? 'V' : 'U',
          displayLabel: `[${externalSchema}].[${tableName}] (${tableType === 'VIEW' ? 'View' : 'Table'})`
        });
      }
    }
    return items;
  }

  async detectSchema(remote: string, dataSource: string, nameHint?: string): Promise<string | undefined> {
    this.ensureInitialized('detectSchema');
    const suffix = Date.now().toString();
    const tempName = `DVW_${(nameHint || 'probe').replace(/[^a-zA-Z0-9_]/g, '_')}_${suffix}`;
    const dummyCreate = `use ${this.selectedDatabase};
CREATE EXTERNAL TABLE [dbo].[${tempName}] ([NonExistingColumn] NVARCHAR(64) NULL)
WITH (LOCATION = N'${this.escapeSqlLiteral(remote)}', DATA_SOURCE = [${dataSource}]);`;

    try {
      await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, dummyCreate);
      await this.dropExternalTable(tempName);
      return undefined;
    } catch (error: any) {
      return this.parseDetectedSchema(error?.message ?? `${error}`);
    }
  }

  generateCreateScript(item: TableViewItem, detectedSchema: string, dataSource: string, localSchema = 'dbo'): string {
    const remote = this.getRemoteLocation(item);
    const columns = this.formatSchemaColumns(detectedSchema);
    return [
      `-- External ${item.type === 'U' ? 'Table' : 'View'}: ${item.schema}.${item.name}`,
      `CREATE EXTERNAL TABLE [${localSchema}].[${item.name}]`,
      columns,
      `WITH (LOCATION = N'${this.escapeSqlLiteral(remote)}', DATA_SOURCE = [${dataSource}]);`,
      ''
    ].join('\n');
  }

  getRemoteLocation(item: TableViewItem): string {
    return [this.namespace, item.schema, item.name].map(part => this.escapeLocationPart(part)).join('.');
  }

  async cleanupDiscoveryTables(): Promise<void> {
    for (const table of this.discoveryTables) {
      const [, name] = table.split('.');
      await this.dropExternalTable(name);
    }
    this.discoveryTables = [];
  }

  dispose(): void {
    this.selectedDatabase = undefined;
    this.discoveryTables = [];
  }

  private ensureInitialized(operation: string): void {
    if (!this.selectedDatabase) {
      throw new Error(`${operation}: Database is not initialized!`);
    }
  }

  private async createExternalTableWithDetection(localFullName: string, remote: string, dataSource: string): Promise<boolean> {
    const dummyCreate = `use ${this.selectedDatabase};
CREATE EXTERNAL TABLE ${localFullName} ([NonExistingColumn] NVARCHAR(64) NULL)
WITH (LOCATION = N'${this.escapeSqlLiteral(remote)}', DATA_SOURCE = [${dataSource}]);`;
    try {
      await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, dummyCreate);
      return true;
    } catch (error: any) {
      const detected = this.parseDetectedSchema(error?.message ?? `${error}`);
      if (!detected) {
        vscode.window.showWarningMessage(`DVW: Could not detect schema for ${remote}.`);
        return false;
      }
      const correctedCreate = `use ${this.selectedDatabase};
CREATE EXTERNAL TABLE ${localFullName} ${detected}
WITH (LOCATION = N'${this.escapeSqlLiteral(remote)}', DATA_SOURCE = [${dataSource}]);`;
      await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, correctedCreate);
      return true;
    }
  }

  private async dropExternalTable(name: string): Promise<void> {
    const query = `use ${this.selectedDatabase};
IF EXISTS (SELECT 1 FROM sys.external_tables et JOIN sys.schemas s ON et.schema_id = s.schema_id WHERE s.name = N'dbo' AND et.name = N'${name}')
  DROP EXTERNAL TABLE [dbo].[${name}];`;
    try {
      await this.connectionSharingService.executeSimpleQuery(this.selectedDatabase, query);
    } catch (error: any) {
      console.log(error.message);
    }
  }

  private parseDetectedSchema(message: string): string | undefined {
    const marker = 'The detected external table schema is:';
    const index = message.indexOf(marker);
    if (index < 0) {
      return undefined;
    }
    const tail = message.substring(index + marker.length).trim();
    const start = tail.indexOf('(');
    const end = tail.lastIndexOf(')');
    return start >= 0 && end > start ? tail.substring(start, end + 1) : undefined;
  }

  private formatSchemaColumns(schema: string): string {
    const trimmed = schema.trim();
    if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
      return schema;
    }
    const inner = trimmed.slice(1, -1);
    const columns: string[] = [];
    let current = '';
    let depth = 0;
    for (const character of inner) {
      if (character === '(') depth++;
      if (character === ')') depth--;
      if (character === ',' && depth === 0) {
        columns.push(current.trim());
        current = '';
      } else {
        current += character;
      }
    }
    if (current.trim()) columns.push(current.trim());
    return columns.length ? `(${columns.map(column => `\n    ${column}`).join(',') }\n)` : schema;
  }

  private escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
  }

  private escapeLocationPart(value: string): string {
    return value.replace(/\./g, '').replace(/'/g, "''");
  }
}