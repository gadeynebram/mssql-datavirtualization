/**
 * Shared types for data virtualization providers
 */

/**
 * Represents a table or view in an external database
 */
export interface TableViewItem {
  /** Name of the external database */
  externalDb: string;
  /** Schema name */
  schema: string;
  /** Table or view name */
  name: string;
  /** Object type: 'U' for table, 'V' for view */
  type: 'U' | 'V';
  /** Display label for UI */
  displayLabel: string;
}

/**
 * Configuration for initializing a schema provider
 */
export interface ProviderConfig {
  /** Database context for operations */
  database: string;
  /** External data source name */
  dataSource?: string;
}
