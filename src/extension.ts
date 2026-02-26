import * as vscode from 'vscode';
import { VirtualizationWizard } from './VirtualizationWizard';
import { WizardTreeProvider } from './WizardTreeProvider';

export function activate(context: vscode.ExtensionContext) {
  // Register the main wizard command
  let disposable = vscode.commands.registerCommand('mssql-datavirtualization.virtualizeDataWizard', async () => {
    let wizard: VirtualizationWizard = new VirtualizationWizard();
    await wizard.RunWizard();
  });
  context.subscriptions.push(disposable);

  // Register help command
  let helpDisposable = vscode.commands.registerCommand('mssql-datavirtualization.showHelp', async () => {
    const readmeUri = vscode.Uri.parse('https://github.com/gadeynebram/mssql-datavirtualization#readme');
    await vscode.env.openExternal(readmeUri);
  });
  context.subscriptions.push(helpDisposable);

  // Create and register the Tree View provider
  const treeDataProvider = new WizardTreeProvider();
  const treeView = vscode.window.createTreeView('mssql-datavirtualization-view', {
    treeDataProvider: treeDataProvider
  });
  context.subscriptions.push(treeView);

  // Create a status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(database) Virtualize Data";
  statusBarItem.tooltip = "Launch Data Virtualization Wizard";
  statusBarItem.command = 'mssql-datavirtualization.virtualizeDataWizard';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate() {}
