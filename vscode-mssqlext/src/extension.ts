import * as vscode from 'vscode';
import { IExtension, IConnectionInfo } from 'vscode-mssql';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('vscode-mssqlext.virtualizeDataWizard', async () => {
    console.log('Virtualize Data Wizard started!');
    vscode.window.showInformationMessage('Virtualize Data Wizard started!');
    // Probeer de mssql extensie te vinden en de API te gebruiken
    const mssqlExt = vscode.extensions.getExtension('ms-mssql.mssql');
    if (!mssqlExt) {
      console.error('mssql extensie niet gevonden.');
      vscode.window.showErrorMessage('mssql extensie niet gevonden. Installeer de mssql extensie.');
      return;
    }
    await mssqlExt.activate();
    const api = mssqlExt.exports as IExtension;
    if (!api) {
      console.error('mssql extensie API niet beschikbaar.');
      vscode.window.showErrorMessage('mssql extensie API niet beschikbaar.');
      return;
    }
    // Prompt gebruiker voor een connectie
    let connection: IConnectionInfo | undefined;
    try {
      connection = await api.promptForConnection();
      console.log('Connectie gekozen:', connection);
    } catch (err) {
      console.error('Kon connectie niet ophalen:', err);
      vscode.window.showErrorMessage('Kon connectie niet ophalen: ' + err);
      return;
    }
    if (!connection) {
      console.log('Geen connectie geselecteerd.');
      vscode.window.showInformationMessage('Geen connectie geselecteerd.');
      return;
    }
    vscode.window.showInformationMessage(`Geselecteerde connectie: ${connection.server}`);

    // Stap: Database kiezen
    let connectionUri: string;
    try {
      connectionUri = await api.connect(connection);
      const databases = await api.listDatabases(connectionUri);
      if (!databases || databases.length === 0) {
        vscode.window.showInformationMessage('Geen databases gevonden.');
        return;
      }
      const dbPick = await vscode.window.showQuickPick(databases, { placeHolder: 'Selecteer een database' });
      if (!dbPick) {
        vscode.window.showInformationMessage('Geen database geselecteerd.');
        return;
      }
      connection.database = dbPick;
      vscode.window.showInformationMessage(`Geselecteerde database: ${dbPick}`);
    } catch (err) {
      console.error('Fout bij ophalen databases:', err);
      vscode.window.showErrorMessage('Fout bij ophalen databases: ' + err);
      return;
    }

    // Stap: External Data Sources ophalen uit gekozen database
    try {
      // Herconnect met gekozen database
      vscode.window.showInformationMessage(`Verbinden met database`);
      connectionUri = await api.connect(connection);
      const query = 'SELECT name, type, location FROM sys.external_data_sources order by name';

      const conn = api.connectionSharing;
      if(!conn){
        console.error('Fout bij ophalen IConnectionSharingService');
        vscode.window.showErrorMessage('Fout bij ophalen IConnectionSharingService');
        return ;
      }

      const result = await conn.executeSimpleQuery(connectionUri, query);
      const sources = result.rows
      if (sources.length === 0) {
        console.log('Geen external data sources gevonden.');
        vscode.window.showInformationMessage('Geen external data sources gevonden.');
        return;
      }
      // Toon in QuickPick
      const items = sources.map((row: any) => row[0].displayValue);
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Selecteer een external data source' });
      if (pick) {
        console.log('Geselecteerde data source:', pick);
        vscode.window.showInformationMessage(`Geselecteerde data source: ${pick}`);

        // Stap: tabellen/views ophalen uit gekozen external data source
        try {
          // Query alle tabellen/views uit sys.external_tables die bij de gekozen data source horen
          const tablesQuery = `SELECT t.name, s.name AS schema_name
            FROM sys.external_tables t
            JOIN sys.schemas s ON t.schema_id = s.schema_id
            WHERE t.data_source_id = (SELECT data_source_id FROM sys.external_data_sources WHERE name = @dataSourceName)
            order by s.name, t.name`;
          const tablesResult = await conn.executeSimpleQuery(connectionUri, tablesQuery.replace('@dataSourceName', `'${pick}'`));
          const tables = tablesResult?.rows || [];
          if (tables.length === 0) {
            vscode.window.showInformationMessage('Geen tabellen/views gevonden voor deze data source.');
            return;
          }
          // Toon tabellen/views in multiselect QuickPick
          const tableItems = tables.map((row: any) => `${row[1].displayValue}.${row[0].displayValue}`); // schema.table
          const selectedTables = await vscode.window.showQuickPick(tableItems, {
            placeHolder: 'Selecteer één of meerdere tabellen/views',
            canPickMany: true
          });
          if (selectedTables && selectedTables.length > 0) {
            console.log('Geselecteerde tabellen/views:', selectedTables);
            vscode.window.showInformationMessage(`Geselecteerde tabellen/views: ${selectedTables.join(', ')}`);
          } else {
            console.log('Geen tabellen/views geselecteerd.');
            vscode.window.showInformationMessage('Geen tabellen/views geselecteerd.');
          }
        } catch (err) {
          console.error('Fout bij ophalen tabellen/views:', err);
          vscode.window.showErrorMessage('Fout bij ophalen tabellen/views: ' + err);
          return;
        }
      } else {
        console.log('Geen data source geselecteerd.');
        vscode.window.showInformationMessage('Geen data source geselecteerd.');
      }
    } catch (err) {
      console.error('Fout bij ophalen external data sources:', err);
      vscode.window.showErrorMessage('Fout bij ophalen external data sources: ' + err);
      return;
    }
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {}
