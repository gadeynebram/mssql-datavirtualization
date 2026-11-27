import * as vscode from 'vscode';
import { IExtension, ISharedConnectionsService } from 'vscode-mssql';
import { SharedConnectionClient } from './SharedConnectionClient';
import { ISchemaProvider } from './providers/ISchemaProvider';
import { MSSQLSchemaProvider } from './providers/MSSQLSchemaProvider';
import { MariaDBSchemaProvider } from './providers/MariaDBSchemaProvider';
import { OracleSchemaProvider } from './providers/OracleSchemaProvider';
import { TableViewItem } from './providers/types';

/**
 * Wizard for creating external table scripts for SQL Server PolyBase data virtualization.
 * Orchestrates the workflow: connection → database → provider → data source → discovery → script generation.
 */
export class VirtualizationWizard implements vscode.Disposable {
  API: ISharedConnectionsService | undefined;
  Connection: SharedConnectionClient | undefined;
  SelectedDatabase: string | undefined;
  SelectedSchema: string | undefined;
  private provider: ISchemaProvider | undefined;

  /**
   * Creates a new VirtualizationWizard instance.
   * Checks for MSSQL extension availability on construction.
   */
  constructor() {
    this.CheckMSSQLExtension();
  }

  dispose() {
    if (this.provider) {
      this.provider.dispose();
      this.provider = undefined;
    }
    this.Connection = undefined;
    this.API = undefined;
  }

  /**
   * Shows a confirmation dialog when user cancels/presses ESC.
   * Returns true if user wants to quit the wizard, false otherwise.
   */
  private async confirmWizardCancellation(): Promise<boolean> {
    const answer = await vscode.window.showWarningMessage(
      'Do you want to quit the wizard?',
      { modal: true },
      'Yes',
      'No'
    );
    return answer === 'Yes';
  }

  /**
   * Executes the complete data virtualization wizard workflow.
   * Steps:
   * 1. Get MSSQL API
   * 2. Prompt for connection
   * 3. Prompt for database
   * 4. Initialize schema provider
   * 5. Prompt for destination schema
   * 6. Ensure schema exists (create if needed)
   * 7. Select external data source
   * 8. Select external databases
   * 9. Create discovery infrastructure
   * 10. Select tables/views
   * 11. Generate external table scripts
   * 12. Open scripts in editor
   * 13. Cleanup discovery tables
   */
  async RunWizard() {
    await this.GetMSSQLAPI();
    await this.PromptForConnection();
    if(!this.Connection) {
      return;
    }
    await this.PromptForDatabase();
    if(!this.SelectedDatabase) {
      return;
    }
    await this.InitializeProvider();
    if(!this.provider) {
      return;
    }
    await this.PromptForSchema();
    if(!this.SelectedSchema) {
      return;
    }
    await this.EnsureSchemaExists();
    const selectedDataSource = await this.PromptExternalDatasource();
    if(!selectedDataSource) {
      return;
    }
    const selectedExternalDatabases = await this.PromptForExternalDatabases(selectedDataSource);
    if(!selectedExternalDatabases) {
      return;
    }
    await this.CreateDVWDiscoveryTablesForAllExternalDatabases(selectedDataSource, selectedExternalDatabases);
    const selectedTablesAndViews = await this.PromptForTablesAndViews(selectedExternalDatabases);
    if(!selectedTablesAndViews) {
      return;
    }
    const scripts = await this.GenerateExternalTableScripts(selectedTablesAndViews, selectedDataSource);
    await this.OpenScriptsInEditor(scripts);
    await this.CleanupDVWTables();
    vscode.window.showInformationMessage('Data Virtualization Wizard complete! External table scripts generated.');
  }

  private CheckMSSQLExtension(): vscode.Extension<any> {
    const mssqlExt = vscode.extensions.getExtension('ms-mssql.mssql');
    if (!mssqlExt) {
      throw new Error("MSSQL extension is required");
    }
    return mssqlExt;
  }

  private async GetMSSQLAPI(): Promise<void> {
    let MSSQLExtension = this.CheckMSSQLExtension();
    await MSSQLExtension.activate();
    const extensionApi = MSSQLExtension.exports as IExtension;
    if (typeof extensionApi?.getSharedConnectionsApi !== 'function') {
      throw new Error('Update the MSSQL extension to a version that supports getSharedConnectionsApi(1).');
    }
    this.API = extensionApi.getSharedConnectionsApi(1);
  }

  private async PromptForConnection(): Promise<void> {
    try {
      if (!this.API) {
        throw new Error("PromptForConnection: API is not set!!");
      }
      const session = await vscode.authentication.getSession(this.API.authenticationProviderId, [], {
        createIfNone: true
      });
      const items: (vscode.QuickPickItem & { connectionId?: string; database?: string })[] = [];
      if (vscode.window.activeTextEditor) {
        const activeConnectionId = await this.API.getActiveEditorConnectionId(session.accessToken);
        if (activeConnectionId) {
          items.push({
            label: 'Use active editor connection',
            connectionId: activeConnectionId,
            database: await this.API.getActiveDatabase(session.accessToken)
          });
        }
      }
      const profiles = vscode.workspace.getConfiguration('mssql').get<{
        id?: string; profileName?: string; server?: string; database?: string;
      }[]>('connections', []);
      for (const profile of profiles) {
        if (profile.id) {
          items.push({
            label: profile.profileName || profile.server || profile.id,
            description: profile.database || profile.server,
            connectionId: profile.id
          });
        }
      }
      items.push({ label: '$(add) New MSSQL connection' });
      let selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a SQL Server connection' });
      while (!selected) {
        if (await this.confirmWizardCancellation()) {
          return;
        }
        selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a SQL Server connection' });
      }
      if (!selected.connectionId) {
        await vscode.commands.executeCommand('mssql.addObjectExplorer');
        vscode.window.showInformationMessage('Create a connection in MSSQL, then run Virtualize Data Wizard again.');
        return;
      }
      this.Connection = new SharedConnectionClient(this.API, selected.connectionId, selected.database);
    } catch (err) {
      throw new Error(`Could not get a connection: ${err}`);
    }
  }

  private async PromptForDatabase(): Promise<void> {
    try {
      if (!this.API) {
        throw new Error("PromptForDatabase: API is not set!!");
      }
      if (!this.Connection) {
        throw new Error("PromptForDatabase: Connection is not set!!");
      }
      const currentDatabase = await this.Connection.getDatabase();
      let promptRequired: boolean = !currentDatabase;
      if (!promptRequired) {
        let answer = await vscode.window.showQuickPick(["Yes", "No"], { placeHolder: `Work with the current database ${currentDatabase}?` });
        if (!answer) {
          // User pressed ESC, show confirmation
          const shouldQuit = await this.confirmWizardCancellation();
          if (shouldQuit) {
            return;
          }
          // User chose not to quit, re-prompt
          return this.PromptForDatabase();
        }
        promptRequired = answer == "No";
        if (answer === 'Yes') {
          this.SelectedDatabase = currentDatabase;
        }
      }
      if (promptRequired) {
        const databases = await this.Connection.listDatabases();
        if (!databases || databases.length === 0) {
          throw new Error('No databases found.');
        }
        let dbPick = await vscode.window.showQuickPick(databases, { placeHolder: 'Select a database' });
        while (!dbPick) {
          // User pressed ESC, show confirmation
          const shouldQuit = await this.confirmWizardCancellation();
          if (shouldQuit) {
            return;
          }
          // User chose not to quit, re-prompt
          dbPick = await vscode.window.showQuickPick(databases, { placeHolder: 'Select a database' });
        }
        this.SelectedDatabase = dbPick;
      }
      console.log(`Selected database: ${this.SelectedDatabase}`)
    } catch (err) {
      throw new Error(`Could not fetch databases: ${err}`);
    }
  }

  private async InitializeProvider(): Promise<void> {
    if (!this.API) {
      throw new Error('InitializeProvider: API is not set!');
    }
    if (!this.Connection) {
      throw new Error('InitializeProvider: Connection is not set!');
    }
    if (!this.SelectedDatabase) {
      throw new Error('InitializeProvider: SelectedDatabase is not set!');
    }

    // Prompt user to select provider type
    const providerOptions = [
      {
        label: 'SQL Server (MSSQL)',
        description: 'For SQL Server external data sources',
        value: 'mssql'
      },
      {
        label: 'MariaDB / MySQL',
        description: 'For MariaDB or MySQL external data sources via ODBC',
        value: 'mariadb'
      },
      {
        label: 'Oracle',
        description: 'For Oracle external data sources using oracle:// connection',
        value: 'oracle'
      }
    ];

    const selectedProvider = await vscode.window.showQuickPick(providerOptions, {
      placeHolder: 'Select the type of external data source you will be connecting to',
      ignoreFocusOut: true
    });

    if (!selectedProvider) {
      // User pressed ESC, show confirmation
      const shouldQuit = await this.confirmWizardCancellation();
      if (shouldQuit) {
        return;
      }
      // User chose not to quit, re-prompt
      return this.InitializeProvider();
    }

    // Create the appropriate provider based on user selection
    if (selectedProvider.value === 'mariadb') {
      console.log('Initializing MariaDBSchemaProvider');
      this.provider = new MariaDBSchemaProvider(this.Connection);
    } else if (selectedProvider.value === 'oracle') {
      console.log('Initializing OracleSchemaProvider');
      this.provider = new OracleSchemaProvider(this.Connection);
    } else {
      console.log('Initializing MSSQLSchemaProvider');
      this.provider = new MSSQLSchemaProvider(this.Connection);
    }

    await this.provider.initialize(this.SelectedDatabase);
  }

  private async PromptForSchema(): Promise<void> {
    const schemaInput = await vscode.window.showInputBox({
      prompt: 'Enter the destination schema name for external tables',
      placeHolder: 'dbo',
      value: 'dbo',
      ignoreFocusOut: true,
      validateInput: (value: string) => {
        if (!value || value.trim().length === 0) {
          return 'Schema name cannot be empty';
        }
        // Basic validation for SQL identifier
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value.trim())) {
          return 'Schema name must be a valid SQL identifier (alphanumeric and underscore, cannot start with number)';
        }
        return null;
      }
    });

    if (!schemaInput) {
      // User pressed ESC, show confirmation
      const shouldQuit = await this.confirmWizardCancellation();
      if (shouldQuit) {
        return;
      }
      // User chose not to quit, re-prompt
      return this.PromptForSchema();
    }

    this.SelectedSchema = schemaInput.trim();
    console.log(`Selected schema: ${this.SelectedSchema}`);
  }

  private async EnsureSchemaExists(): Promise<void> {
    if (!this.API || !this.SelectedDatabase || !this.SelectedSchema) {
      throw new Error('EnsureSchemaExists: Required properties not initialized');
    }

    const connectionSharingService = this.Connection;
    if (!connectionSharingService) {
      throw new Error('EnsureSchemaExists: ConnectionSharingService not available');
    }

    try {
      // Check if schema exists
      const checkQuery = `use ${this.SelectedDatabase}; 
SELECT COUNT(*) as cnt FROM sys.schemas WHERE name = N'${this.SelectedSchema}'`;
      const result = await connectionSharingService.executeSimpleQuery(this.SelectedDatabase, checkQuery);
      
      const count = result.rows[0][0].displayValue;
      
      if (count === '0') {
        // Schema doesn't exist, create it
        console.log(`Schema '${this.SelectedSchema}' does not exist. Creating...`);
        const createQuery = `CREATE SCHEMA [${this.SelectedSchema}]`;
        await connectionSharingService.executeSimpleQuery(this.SelectedDatabase, createQuery);
        vscode.window.showInformationMessage(`Schema '${this.SelectedSchema}' created successfully.`);
      } else {
        console.log(`Schema '${this.SelectedSchema}' already exists.`);
      }
    } catch (err) {
      throw new Error(`EnsureSchemaExists: Failed to check/create schema: ${err}`);
    }
  }

  private async PromptExternalDatasource(): Promise<string | false> {
    try {
      if (!this.provider) {
        throw new Error('PromptExternalDatasource: Provider is not initialized!');
      }

      const sources = await this.provider.listExternalDataSources();
      let selected = await vscode.window.showQuickPick(sources, { placeHolder: 'Select a external data source' });
      while (!selected) {
        // User pressed ESC, show confirmation
        const shouldQuit = await this.confirmWizardCancellation();
        if (shouldQuit) {
          return false;
        }
        // User chose not to quit, re-prompt
        selected = await vscode.window.showQuickPick(sources, { placeHolder: 'Select a external data source' });
      }
      console.log(`Selected external datasource: ${selected}`);
      return selected;
    } catch (err) {
      throw new Error(`PromptExternalDatasource: ${err}`);
    }
  }

  private async PromptForExternalDatabases(dataSource: string): Promise<string[] | false> {
    if (!this.provider) {
      throw new Error('PromptForExternalDatabases: Provider is not initialized!');
    }

    const dbNames = await this.provider.listExternalDatabases(dataSource);
    const picked = await vscode.window.showQuickPick(dbNames, {
      placeHolder: 'Select one or more external databases',
      canPickMany: true
    });
    let selection = picked;
    while (!selection || selection.length === 0) {
      // User pressed ESC or didn't select anything, show confirmation
      const shouldQuit = await this.confirmWizardCancellation();
      if (shouldQuit) {
        return false;
      }
      // User chose not to quit, re-prompt
      selection = await vscode.window.showQuickPick(dbNames, {
        placeHolder: 'Select one or more external databases',
        canPickMany: true
      });
    }
    console.log(`Selected external databases: ${selection.join(', ')}`);
    return selection;
  }

  private async CreateDVWDiscoveryTablesForAllExternalDatabases(dataSource: string, externalDatabases: string[]): Promise<void> {
    if (!this.provider) {
      throw new Error('CreateDVWDiscoveryTablesForAllExternalDatabases: Provider is not initialized!');
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Creating discovery tables",
      cancellable: false
    }, async (progress) => {
      const total = externalDatabases.length;
      for (let i = 0; i < total; i++) {
        const extDb = externalDatabases[i];
        progress.report({ increment: (i / total) * 100, message: `Processing ${extDb} (${i + 1}/${total})` });
        await this.provider!.createDiscoveryInfrastructure(dataSource, [extDb]);
      }
      progress.report({ increment: 100, message: 'Complete' });
    });
  }

  private async PromptForTablesAndViews(externalDatabases: string[]): Promise<TableViewItem[] | false> {
    if (!this.provider) {
      throw new Error('PromptForTablesAndViews: Provider is not initialized!');
    }

    const allItems = await this.provider.listTablesAndViews(externalDatabases);

    if (allItems.length === 0) {
      throw new Error('PromptForTablesAndViews: No tables or views found in selected external databases');
    }

    // Present multi-select UI
    const displayLabels = allItems.map(i => i.displayLabel);
    const picked = await vscode.window.showQuickPick(displayLabels, {
      placeHolder: 'Select tables and views for external table generation',
      canPickMany: true
    });
    let selection = picked;
    while (!selection || selection.length === 0) {
      // User pressed ESC or didn't select anything, show confirmation
      const shouldQuit = await this.confirmWizardCancellation();
      if (shouldQuit) {
        return false;
      }
      // User chose not to quit, re-prompt
      selection = await vscode.window.showQuickPick(displayLabels, {
        placeHolder: 'Select tables and views for external table generation',
        canPickMany: true
      });
    }

    // Map selections back to items
    const selectedItems = allItems.filter(item => selection!.includes(item.displayLabel));
    console.log(`Selected ${selectedItems.length} tables/views for script generation`);
    return selectedItems;
  }

  private async GenerateExternalTableScripts(selectedItems: TableViewItem[], dataSource: string): Promise<string> {
    if (!this.provider) {
      throw new Error('GenerateExternalTableScripts: Provider is not initialized!');
    }
    if (!this.SelectedSchema) {
      throw new Error('GenerateExternalTableScripts: SelectedSchema is not set!');
    }

    const scripts: string[] = [];
    scripts.push('-- Generated by Data Virtualization Wizard');
    scripts.push(`-- Date: ${new Date().toLocaleString()}`);
    scripts.push(`-- External Data Source: ${dataSource}`);
    scripts.push(`-- Destination Schema: ${this.SelectedSchema}`);
    scripts.push('');

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Generating external table scripts",
      cancellable: false
    }, async (progress) => {
      const total = selectedItems.length;
      for (let i = 0; i < total; i++) {
        const item = selectedItems[i];
        progress.report({ increment: (i / total) * 100, message: `Processing ${item.name} (${i + 1}/${total})` });

        // Generate remote path based on provider type
        // MariaDB: 'database.table' (lowercase, no schema layer)
        // MSSQL: '[database].[schema].[table]'
        const isMariaDB = this.provider instanceof MariaDBSchemaProvider;
        const remote = isMariaDB 
          ? `${item.externalDb}.${item.name}` 
          : `[${item.externalDb}].[${item.schema}].[${item.name}]`;

        // Detect the schema using the provider
        const detectedSchema = await this.provider!.detectSchema(remote, dataSource, `${item.schema}_${item.name}`);

        if (detectedSchema) {
          const script = this.provider!.generateCreateScript(item, detectedSchema, dataSource, this.SelectedSchema!);
          scripts.push(script);
        } else {
          const localName = item.name;
          const localFullName = `[${this.SelectedSchema}].[${localName}]`;
          scripts.push(`-- External ${item.type === 'U' ? 'Table' : 'View'}: ${remote}`);
          scripts.push(`-- WARNING: Could not detect schema for ${remote}`);
          scripts.push(`-- CREATE EXTERNAL TABLE ${localFullName}`);
          scripts.push(`-- (`);
          scripts.push(`--     [column_name] DATA_TYPE`);
          scripts.push(`-- )`);
          scripts.push(`-- WITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`);
          scripts.push('');
        }
      }
      progress.report({ increment: 100, message: 'Complete' });
    });

    return scripts.join('\n');
  }

  private async OpenScriptsInEditor(scripts: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({
      language: 'sql',
      content: scripts
    });
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private async CleanupDVWTables(): Promise<void> {
    if (!this.provider) {
      return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Cleaning up discovery tables",
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 50, message: 'Removing discovery tables...' });
      await this.provider!.cleanupDiscoveryTables();
      progress.report({ increment: 100, message: 'Complete' });
    });
  }
}
