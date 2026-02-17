import { TableViewItem } from './types';

/**
 * Interface for database-specific schema detection and external table operations.
 * Implementations provide vendor-specific logic for MSSQL, MySQL, PostgreSQL, etc.
 */
export interface ISchemaProvider {
  /**
   * Initialize the provider with connection context
   * @param database - Target database for operations
   */
  initialize(database: string): Promise<void>;

  /**
   * List available external data sources in the current database
   * @returns Array of external data source names
   */
  listExternalDataSources(): Promise<string[]>;

  /**
   * Discover external databases accessible through the data source
   * @param dataSource - External data source name
   * @returns Array of external database names
   */
  listExternalDatabases(dataSource: string): Promise<string[]>;

  /**
   * Create discovery infrastructure (temporary external tables) for metadata queries
   * @param dataSource - External data source name
   * @param externalDatabases - Array of external database names to set up discovery for
   */
  createDiscoveryInfrastructure(dataSource: string, externalDatabases: string[]): Promise<void>;

  /**
   * List tables and views from external databases using discovery infrastructure
   * @param externalDatabases - Array of external database names to query
   * @returns Array of table and view metadata
   */
  listTablesAndViews(externalDatabases: string[]): Promise<TableViewItem[]>;

  /**
   * Detect the schema of a remote table or view
   * @param remote - Remote object location (e.g., '[db].[schema].[table]')
   * @param dataSource - External data source name
   * @param nameHint - Optional hint for naming temporary objects
   * @returns Detected schema definition or undefined if detection fails
   */
  detectSchema(remote: string, dataSource: string, nameHint?: string): Promise<string | undefined>;

  /**
   * Generate CREATE EXTERNAL TABLE DDL script
   * @param item - Table or view metadata
   * @param detectedSchema - Schema definition from detectSchema()
   * @param dataSource - External data source name
   * @param localSchema - Optional destination schema name (defaults to 'dbo')
   * @returns SQL DDL statement
   */
  generateCreateScript(item: TableViewItem, detectedSchema: string, dataSource: string, localSchema?: string): string;

  /**
   * Clean up all discovery infrastructure (temporary external tables)
   */
  cleanupDiscoveryTables(): Promise<void>;

  /**
   * Dispose of provider resources
   */
  dispose(): void;
}
