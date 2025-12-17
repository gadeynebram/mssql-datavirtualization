import * as vscode from 'vscode';
import { IExtension, IConnectionInfo, IConnectionSharingService } from 'vscode-mssql';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('vscode-mssqlext.virtualizeDataWizard', async () => {
    console.log('Virtualize Data Wizard started!');
    vscode.window.showInformationMessage('Virtualize Data Wizard started!');

    let wizard: VirtualizationWizard = new VirtualizationWizard();
    
    await wizard.RunWizard();
    
  }); // vscode.commands.registerCommand
  context.subscriptions.push(disposable);
}

class VirtualizationWizard implements vscode.Disposable{

  API: IExtension | undefined;
  ConnectionSharingService: IConnectionSharingService | undefined;
  Connection: IConnectionInfo | undefined;
  ConnectionUri: string | undefined;
  OwnerDoc: vscode.TextDocument | undefined;
  private readonly ExtensionId: string = 'gadeynebram.vscode-mssqlext';
  SelectedExternalDataSource: string | undefined;
  SelectedDatabase: string | undefined;
  SelectedExternalDatabases: string[] = [];
  SelectedTablesAndViews: Array<{externalDb: string, schema: string, name: string, type: 'U' | 'V'}> = [];
  DiscoveryTables: string[] = [];

  /**
   *
   */
  constructor() {
    this.CheckMSSQLExtension();
  }
  dispose() {
    this.Connection = undefined;
    this.ConnectionUri = undefined;
    this.ConnectionSharingService = undefined;
    this.SelectedExternalDataSource = undefined;
    this.API = undefined;
  }

  async RunWizard(){
    await this.GetMSSQLAPI();
    await this.PromptForConnection();
    await this.PromptForDatabase();
    await this.PromptExternalDatasource();
    await this.CreateDVWExternalDatabasesTable();
    await this.PromptForExternalDatabases();
    await this.CreateDVWDiscoveryTablesForAllExternalDatabases();
    await this.PromptForTablesAndViews();
    vscode.window.showInformationMessage('Step B complete: Tables/views selected. Ready for validation.');
  }

  private CheckMSSQLExtension(): vscode.Extension<any> {
      const mssqlExt = vscode.extensions.getExtension('ms-mssql.mssql');
      if (!mssqlExt) {
        throw new Error("MSSQL extension is required");
      }
      return mssqlExt;
  }

  private async GetMSSQLAPI(): Promise<void>{
    let MSSQLExtension = this.CheckMSSQLExtension();
    await MSSQLExtension.activate();
    this.API = MSSQLExtension.exports as IExtension;
    if (!this.API) {
      throw new Error("MSSQL Extension API is not available");
    }
    this.ConnectionSharingService = this.API.connectionSharing;
  }

  private async PromptForConnection(): Promise<void>{
    try {
      if(!this.API){
        throw new Error("PromptForConnection: API is not set!!");
      }
      this.Connection = await this.API.promptForConnection();
      while(!this.Connection){
        vscode.window.showInformationMessage('Please select a connection.');
        this.Connection = await this.API.promptForConnection();
      }
      console.log(`Selected server: ${this.Connection.server}`);
      await this.EnsureOwnerDocumentActive();
      this.ConnectionUri = await this.API.connect(this.Connection);
    } catch (err) {
      throw new Error(`Could not get a connection: ${err}`);
    }
  }

  private async PromptForDatabase(): Promise<void>{
    try {
      if(!this.API){
        throw new Error("PromptForDatabase: API is not set!!");
      }
      if(!this.ConnectionUri){
        throw new Error("PromptForDatabase: ConnectionURI is not set!!");
      }
      if(!this.Connection){
        throw new Error("PromptForDatabase: Connection is not set!!");
      }
      let promptRequired: boolean = this.Connection.database.length == 0;
      if(!promptRequired){
          let answer = await vscode.window.showQuickPick(["Yes","No"], { placeHolder: `Work with the current database ${this.Connection?.database}?` });
          promptRequired = answer == "No";
          if(answer === 'Yes'){
            this.SelectedDatabase = this.Connection.database && this.Connection.database.length > 0 ? this.Connection.database : 'master';
          }
      }
      if(promptRequired){
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

  private async PromptExternalDatasource(): Promise<void>{
    try {
      if(!this.ConnectionSharingService){
        throw new Error("PromptExternalDatasource: ConnectionSharingService is not set!!");
      }
      if(!this.ConnectionUri){
        throw new Error("PromptExternalDatasource: ConnectionUri is not set!!");
      }

      const query = `use ${this.SelectedDatabase}; SELECT name FROM sys.external_data_sources order by name`;

      const ownerUri = await this.GetFreshConnectionUri();
      const result = await this.ConnectionSharingService.executeSimpleQuery(ownerUri, query);
      const sources = result.rows
      if (sources.length === 0) {
        throw new Error("Could not find external datasources in the selected database.");
      }

      const items = sources.map((row: any) => row[0].displayValue);
      let selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a external data source' });
      while(!selected) {
        vscode.window.showInformationMessage('Please select an external data source');
        selected = await vscode.window.showQuickPick(items, { placeHolder: 'Select a external data source' });
      }
      this.SelectedExternalDataSource = selected;
      console.log(`Selected external datasource: ${this.SelectedExternalDataSource}`);
    } catch (err) {
      throw new Error(`PromptExternalDatasource: ${err}`);
    }
  }

  // Step 1: Create 3 temporary external tables to sys.tables, sys.views, sys.schemas for a given external database
  private async CreateDVWDiscoveryTables(externalDbName: string): Promise<void>{
    if(!this.ConnectionSharingService){
      throw new Error('CreateDVWDiscoveryTables: ConnectionSharingService is not set!!');
    }
    if(!this.ConnectionUri){
      throw new Error('CreateDVWDiscoveryTables: ConnectionUri is not set!!');
    }
    if(!this.SelectedDatabase){
      throw new Error('CreateDVWDiscoveryTables: SelectedDatabase is not set!!');
    }
    if(!this.SelectedExternalDataSource){
      throw new Error('CreateDVWDiscoveryTables: SelectedExternalDataSource is not set!!');
    }

    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const safeDbName = externalDbName.replace(/[^a-zA-Z0-9]/g, '_');
    const baseNames = [
      { localName: `DVW_${safeDbName}_sys_tables_${suffix}`, remote: `[${externalDbName}].[sys].[tables]` },
      { localName: `DVW_${safeDbName}_sys_views_${suffix}`, remote: `[${externalDbName}].[sys].[views]` },
      { localName: `DVW_${safeDbName}_sys_schemas_${suffix}`, remote: `[${externalDbName}].[sys].[schemas]` }
    ];

    for(const item of baseNames){
      const localFullName = `[${localSchema}].[${item.localName}]`;
      // For DVW discovery tables, drop first (safe to recreate)
      await this.DropExternalTable(localSchema, item.localName);
      const created = await this.CreateExternalTableWithDetection(localFullName, item.remote, this.SelectedExternalDataSource);
      if(created){
        this.DiscoveryTables.push(`${localSchema}.${item.localName}`);
      }
    }
  }

  // New Step: Create DVW external table to master.sys.databases so we can list external DBs
  private async CreateDVWExternalDatabasesTable(): Promise<void>{
    if(!this.ConnectionSharingService){
      throw new Error('CreateDVWExternalDatabasesTable: ConnectionSharingService is not set!!');
    }
    if(!this.SelectedExternalDataSource){
      throw new Error('CreateDVWExternalDatabasesTable: SelectedExternalDataSource is not set!!');
    }

    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const localName = `DVW_sys_databases_${suffix}`;
    const localFullName = `[${localSchema}].[${localName}]`;
    const remote = `[master].[sys].[databases]`;

    await this.DropExternalTable(localSchema, localName);
    const created = await this.CreateExternalTableWithDetection(localFullName, remote, this.SelectedExternalDataSource);
    if(created){
      this.DiscoveryTables.push(`${localSchema}.${localName}`);
    } else {
      throw new Error('CreateDVWExternalDatabasesTable: Could not create DVW_sys_databases due to missing detected schema.');
    }
  }

  // New Step: Prompt user to select one or more external databases from DVW_sys_databases
  private async PromptForExternalDatabases(): Promise<void>{
    if(!this.ConnectionSharingService){
      throw new Error('PromptForExternalDatabases: ConnectionSharingService is not set!!');
    }
    // Find the latest DVW_sys_databases table we created
    const dvwDbTable = this.DiscoveryTables.find(t => t.includes('DVW_sys_databases_'));
    if(!dvwDbTable){
      throw new Error('PromptForExternalDatabases: DVW_sys_databases table not found');
    }
    const query = `use ${this.SelectedDatabase}; SELECT name FROM [${dvwDbTable.replace('.', '].[')}] ORDER BY name`;
    const ownerUri = await this.GetFreshConnectionUri();
    const result = await this.ConnectionSharingService.executeSimpleQuery(ownerUri, query);
    const rows = result.rows || [];
    if(rows.length === 0){
      throw new Error('PromptForExternalDatabases: No external databases found via DVW_sys_databases');
    }
    const dbNames = rows.map(r => r[0].displayValue);
    const picked = await vscode.window.showQuickPick(dbNames, { placeHolder: 'Select one or more external databases', canPickMany: true });
    let selection = picked;
    while(!selection || selection.length === 0){
      vscode.window.showInformationMessage('Please select at least one external database');
      selection = await vscode.window.showQuickPick(dbNames, { placeHolder: 'Select one or more external databases', canPickMany: true });
    }
    this.SelectedExternalDatabases = selection;
    console.log(`Selected external databases: ${this.SelectedExternalDatabases.join(', ')}`);
  }

  // New Step: Create discovery tables for all selected external databases with progress
  private async CreateDVWDiscoveryTablesForAllExternalDatabases(): Promise<void>{
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Creating discovery tables",
      cancellable: false
    }, async (progress) => {
      const total = this.SelectedExternalDatabases.length;
      for(let i = 0; i < total; i++){
        const extDb = this.SelectedExternalDatabases[i];
        progress.report({ increment: (i / total) * 100, message: `Processing ${extDb} (${i+1}/${total})` });
        await this.CreateDVWDiscoveryTables(extDb);
      }
      progress.report({ increment: 100, message: 'Complete' });
    });
  }

  // New Step: Query DVW tables and prompt for table/view selection
  private async PromptForTablesAndViews(): Promise<void>{
    if(!this.ConnectionSharingService){
      throw new Error('PromptForTablesAndViews: ConnectionSharingService is not set!!');
    }
    
    // Collect all tables and views from all external databases
    interface TableViewItem {
      externalDb: string;
      schema: string;
      name: string;
      type: 'U' | 'V';
      displayLabel: string;
    }
    const allItems: TableViewItem[] = [];

    for(const extDb of this.SelectedExternalDatabases){
      const safeDbName = extDb.replace(/[^a-zA-Z0-9]/g, '_');
      const tablesTable = this.DiscoveryTables.find(t => t.includes(`DVW_${safeDbName}_sys_tables_`));
      const viewsTable = this.DiscoveryTables.find(t => t.includes(`DVW_${safeDbName}_sys_views_`));
      const schemasTable = this.DiscoveryTables.find(t => t.includes(`DVW_${safeDbName}_sys_schemas_`));

      if(!tablesTable || !viewsTable || !schemasTable){
        vscode.window.showWarningMessage(`DVW: Skipping ${extDb} - discovery tables not found`);
        continue;
      }

      // Query tables
      const tablesQuery = `use ${this.SelectedDatabase}; 
SELECT s.name as schema_name, t.name as table_name, 'U' as type
FROM [${tablesTable.replace('.', '].[')}] t
JOIN [${schemasTable.replace('.', '].[')}] s ON t.schema_id = s.schema_id
ORDER BY s.name, t.name`;
      const tablesOwnerUri = await this.GetFreshConnectionUri();
      const tablesResult = await this.ConnectionSharingService.executeSimpleQuery(tablesOwnerUri, tablesQuery);
      
      for(const row of tablesResult.rows){
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
      const viewsQuery = `use ${this.SelectedDatabase}; 
SELECT s.name as schema_name, v.name as view_name, 'V' as type
FROM [${viewsTable.replace('.', '].[')}] v
JOIN [${schemasTable.replace('.', '].[')}] s ON v.schema_id = s.schema_id
ORDER BY s.name, v.name`;
      const viewsOwnerUri = await this.GetFreshConnectionUri();
      const viewsResult = await this.ConnectionSharingService.executeSimpleQuery(viewsOwnerUri, viewsQuery);
      
      for(const row of viewsResult.rows){
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

    if(allItems.length === 0){
      throw new Error('PromptForTablesAndViews: No tables or views found in selected external databases');
    }

    // Present multi-select UI
    const displayLabels = allItems.map(i => i.displayLabel);
    const picked = await vscode.window.showQuickPick(displayLabels, { 
      placeHolder: 'Select tables and views for external table generation', 
      canPickMany: true 
    });
    let selection = picked;
    while(!selection || selection.length === 0){
      vscode.window.showInformationMessage('Please select at least one table or view');
      selection = await vscode.window.showQuickPick(displayLabels, { 
        placeHolder: 'Select tables and views for external table generation', 
        canPickMany: true 
      });
    }

    // Map selections back to items
    this.SelectedTablesAndViews = allItems.filter(item => selection!.includes(item.displayLabel));
    console.log(`Selected ${this.SelectedTablesAndViews.length} tables/views for script generation`);
  }

  private parseDetectedSchemaFromErrorMessage(message: string): string | undefined {
    // We only retain the part after "The detected external table schema is:" including the parentheses
    // Example tail: "The detected external table schema is: ([nr] INT NOT NULL)."
    const marker = 'The detected external table schema is:';
    const idx = message.indexOf(marker);
    if(idx === -1){
      return undefined;
    }
    const tail = message.substring(idx + marker.length).trim();
    // Tail may end with a period. We want the parenthesis block
    const startParen = tail.indexOf('(');
    const endParen = tail.lastIndexOf(')');
    if(startParen === -1 || endParen === -1 || endParen <= startParen){
      return undefined;
    }
    const schemaSegment = tail.substring(startParen, endParen + 1);
    // Return with leading space to attach after table name
    return `\n${schemaSegment}`;
  }

  // Reusable: Probe remote object schema by issuing a dummy CREATE using a DVW_ prefixed temp name
  // Returns only the detected schema segment ("(col defs...)"), or undefined if not found
  private async ProbeDetectedSchema(remote: string, dataSource: string, nameHint?: string): Promise<string | undefined> {
    if(!this.ConnectionSharingService){
      throw new Error('ProbeDetectedSchema: ConnectionSharingService not initialized');
    }
    const suffix = new Date().getTime().toString();
    const localSchema = 'dbo';
    const tempName = nameHint ? `DVW_${nameHint}_${suffix}` : `DVW_probe_${suffix}`;
    const localFullName = `[${localSchema}].[${tempName}]`;

    const dummyCreate = `use ${this.SelectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName}\n(\n    [idontexist] BIT NULL\n)\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
    try{
      const ownerUri = await this.GetFreshConnectionUri();
      await this.ConnectionSharingService.executeSimpleQuery(ownerUri, dummyCreate);
      // Unexpected success: best-effort drop to keep environment clean
      try { await this.DropExternalTable(localSchema, tempName); } catch { /* ignore */ }
      return undefined;
    } catch(e: any){
      const message = (e && e.message) ? e.message as string : `${e}`;
      const detected = this.parseDetectedSchemaFromErrorMessage(message);
      return detected; // may be undefined per requirement
    }
  }

  // Reusable: Drop an external table if it exists (schema-qualified)
  private async DropExternalTable(schema: string, name: string): Promise<void> {
    if(!this.ConnectionSharingService){
      throw new Error('DropExternalTable: ConnectionSharingService not initialized');
    }
    const dropGuarded = `IF EXISTS (SELECT 1 FROM sys.external_tables et JOIN sys.schemas s ON et.schema_id = s.schema_id WHERE s.name = N'${schema}' AND et.name = N'${name}')\nBEGIN\n  DROP EXTERNAL TABLE [${schema}].[${name}];\nEND`;
    try{
      const ownerUri = await this.GetFreshConnectionUri();
      const query = `use ${this.SelectedDatabase};\n${dropGuarded}`;
      await this.ConnectionSharingService.executeSimpleQuery(ownerUri, query);
    } catch (e: any) {
        // ignore drop failures for DVW objects
        console.log(e.message);
    }
  }

  // Reusable: Create external table by first issuing a dummy create then using detected schema from error
  // Returns true if created, false if schema could not be detected and create was skipped
  private async CreateExternalTableWithDetection(localFullName: string, remote: string, dataSource: string): Promise<boolean> {
    if(!this.ConnectionSharingService){
      throw new Error('CreateExternalTableWithDetection: ConnectionSharingService not initialized');
    }
    const dummyCreate = `use ${this.SelectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName}\n(\n    [idontexist] BIT NULL\n)\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
    try{
      const ownerUri = await this.GetFreshConnectionUri();
      await this.ConnectionSharingService.executeSimpleQuery(ownerUri, dummyCreate);
      return true;
    } catch(e: any){
      const message = (e && e.message) ? e.message as string : `${e}`;
      const detected = this.parseDetectedSchemaFromErrorMessage(message);
      if(detected){
        const correctedCreate = `use ${this.SelectedDatabase};\nCREATE EXTERNAL TABLE ${localFullName} ${detected}\nWITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`;
        const ownerUri2 = await this.GetFreshConnectionUri();
        await this.ConnectionSharingService.executeSimpleQuery(ownerUri2, correctedCreate);
        return true;
      }
      vscode.window.showWarningMessage(`DVW: Could not detect schema for ${remote}. Skipping creation of ${localFullName}.`);
      return false;
    }
  }

  // Ensure we have a dedicated SQL document active to bind OwnerUri
  private async EnsureOwnerDocumentActive(): Promise<void> {
    if(!this.OwnerDoc || !vscode.window.visibleTextEditors.find(e => e.document === this.OwnerDoc)){
      this.OwnerDoc = await vscode.workspace.openTextDocument({ language: 'sql', content: '-- DVW OwnerUri Context' });
    }
    await vscode.window.showTextDocument(this.OwnerDoc, { preview: false });
  }

  // Get a fresh OwnerUri by ensuring the DVW doc is active and reconnecting
  private async GetFreshConnectionUri(): Promise<string> {
    if(!this.API || !this.Connection || !this.ConnectionSharingService){
      throw new Error('GetFreshConnectionUri: API/Connection/ConnectionSharingService not initialized');
    }
    await this.EnsureOwnerDocumentActive();
    let uri = await this.API.connect(this.Connection);
    const connected = this.ConnectionSharingService.isConnected(uri);
    if(!connected){
      const connId = await this.ConnectionSharingService.getActiveEditorConnectionId(this.ExtensionId);
      if(connId){
        const sharedUri = await this.ConnectionSharingService.connect(this.ExtensionId, connId, this.SelectedDatabase);
        if(sharedUri){
          uri = sharedUri;
        }
      }
    }
    this.ConnectionUri = uri;
    return uri;
  }
}



export function deactivate() {}
