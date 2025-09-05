import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('vscode-mssqlext.virtualizeDataWizard', async () => {
    vscode.window.showInformationMessage('Virtualize Data Wizard started!');
    // Hier komt de wizard logica
  });
  context.subscriptions.push(disposable);
}

export function deactivate() {}
