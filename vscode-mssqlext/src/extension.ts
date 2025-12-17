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
  SelectedExternalDataSource: string | undefined;
  SelectedDatabase: string | undefined;

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
    await this.GenerateVirtualizationScript();
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

      const result = await this.ConnectionSharingService.executeSimpleQuery(this.ConnectionUri, query);
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
}



export function deactivate() {}
