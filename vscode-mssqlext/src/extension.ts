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
    vscode.window.showInformationMessage(`Geselecteerde connectie: ${connection.server} (${connection.database})`);
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {}
