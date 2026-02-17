import * as vscode from 'vscode';
import { IExtension, IConnectionInfo } from 'vscode-mssql';
import { ISchemaProvider } from './providers/ISchemaProvider';
import { MSSQLSchemaProvider } from './providers/MSSQLSchemaProvider';
import { MariaDBSchemaProvider } from './providers/MariaDBSchemaProvider';
import { TableViewItem } from './providers/types';

/**
 * Wizard for creating external table scripts for SQL Server PolyBase data virtualization.
 * Orchestrates the workflow: connection → database → provider → data source → discovery → script generation.
 */
export class VirtualizationWizard implements vscode.Disposable {
  API: IExtension | undefined;
  Connection: IConnectionInfo | undefined;
  ConnectionUri: string | undefined;
  private readonly ExtensionId: string = 'gadeynebram.mssql-datavirtualization';
  SelectedDatabase: string | undefined;
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
    this.ConnectionUri = undefined;
    this.API = undefined;
  }

  /**
   * Executes the complete data virtualization wizard workflow.
   * Steps:
   * 1. Get MSSQL API
   * 2. Prompt for connection
   * 3. Prompt for database
   * 4. Initialize schema provider
   * 5. Select external data source
   * 6. Select external databases
   * 7. Create discovery infrastructure
   * 8. Select tables/views
   * 9. Generate external table scripts
   * 10. Open scripts in editor
   * 11. Cleanup discovery tables
   */
  async RunWizard() {
    await this.GetMSSQLAPI();
    await this.PromptForConnection();
    await this.PromptForDatabase();
    await this.InitializeProvider();
    const selectedDataSource = await this.PromptExternalDatasource();
    const selectedExternalDatabases = await this.PromptForExternalDatabases(selectedDataSource);
    await this.CreateDVWDiscoveryTablesForAllExternalDatabases(selectedDataSource, selectedExternalDatabases);
    const selectedTablesAndViews = await this.PromptForTablesAndViews(selectedExternalDatabases);
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
    this.API = MSSQLExtension.exports as IExtension;
    if (!this.API) {
      throw new Error("MSSQL Extension API is not available");
    }
  }

  private async PromptForConnection(): Promise<void> {
    try {
      if (!this.API) {
        throw new Error("PromptForConnection: API is not set!!");
      }
      this.Connection = await this.API.promptForConnection();
      while (!this.Connection) {
        vscode.window.showInformationMessage('Please select a connection.');
        this.Connection = await this.API.promptForConnection();
      }
      console.log(`Selected server: ${this.Connection.server}`);
      this.ConnectionUri = await this.API.connect(this.Connection);
    } catch (err) {
      throw new Error(`Could not get a connection: ${err}`);
    }
  }

  private async PromptForDatabase(): Promise<void> {
    try {
      if (!this.API) {
        throw new Error("PromptForDatabase: API is not set!!");
      }
      if (!this.ConnectionUri) {
        throw new Error("PromptForDatabase: ConnectionURI is not set!!");
      }
      if (!this.Connection) {
        throw new Error("PromptForDatabase: Connection is not set!!");
      }
      let promptRequired: boolean = this.Connection.database.length == 0;
      if (!promptRequired) {
        let answer = await vscode.window.showQuickPick(["Yes", "No"], { placeHolder: `Work with the current database ${this.Connection?.database}?` });
        promptRequired = answer == "No";
        if (answer === 'Yes') {
          this.SelectedDatabase = this.Connection.database && this.Connection.database.length > 0 ? this.Connection.database : 'master';
        }
      }
      if (promptRequired) {
        const databases = await this.API.listDatabases(this.ConnectionUri);
        if (!databases || databases.length === 0) {
          throw new Error('No databases found.');
        }
        let dbPick = await vscode.window.showQuickPick(databases, { placeHolder: 'Select a database' });
        while (!dbPick) {
          vscode.window.showInformationMessage('Please select a database');
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
    if (!this.ConnectionUri) {
      throw new Error('InitializeProvider: ConnectionUri is not set!');
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
      }
    ];

    const selectedProvider = await vscode.window.showQuickPick(providerOptions, {
      placeHolder: 'Select the type of external data source you will be connecting to',
      ignoreFocusOut: true
    });

    if (!selectedProvider) {
      throw new Error('No provider selected. Wizard cancelled.');
    }

    // Create the appropriate provider based on user selection
    if (selectedProvider.value === 'mariadb') {
      console.log('Initializing MariaDBSchemaProvider');
      this.provider = new MariaDBSchemaProvider(this.API, this.Connection, this.ConnectionUri);
    } else {
      console.log('Initializing MSSQLSchemaProvider');
      this.provider = new MSSQLSchemaProvider(this.API, this.Connection, this.ConnectionUri);
    }

    await this.provider.initialize(this.SelectedDatabase);
  }

  private async PromptExternalDatasource(): Promise<string> {
    try {
      if (!this.provider) {
        throw new Error('PromptExternalDatasource: Provider is not initialized!');
      }

      const sources = await this.provider.listExternalDataSources();
      let selected = await vscode.window.showQuickPick(sources, { placeHolder: 'Select a external data source' });
      while (!selected) {
        vscode.window.showInformationMessage('Please select an external data source');
        selected = await vscode.window.showQuickPick(sources, { placeHolder: 'Select a external data source' });
      }
      console.log(`Selected external datasource: ${selected}`);
      return selected;
    } catch (err) {
      throw new Error(`PromptExternalDatasource: ${err}`);
    }
  }

  private async PromptForExternalDatabases(dataSource: string): Promise<string[]> {
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
      vscode.window.showInformationMessage('Please select at least one external database');
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

  private async PromptForTablesAndViews(externalDatabases: string[]): Promise<TableViewItem[]> {
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
      vscode.window.showInformationMessage('Please select at least one table or view');
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

    const scripts: string[] = [];
    scripts.push('-- Generated by Data Virtualization Wizard');
    scripts.push(`-- Date: ${new Date().toLocaleString()}`);
    scripts.push(`-- External Data Source: ${dataSource}`);
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
          const script = this.provider!.generateCreateScript(item, detectedSchema, dataSource);
          scripts.push(script);
        } else {
          const localSchema = item.schema;
          const localName = item.name;
          const localFullName = `[${localSchema}].[${localName}]`;
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
