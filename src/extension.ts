import * as vscode from 'vscode';
import { VirtualizationWizard } from './VirtualizationWizard';
import { WizardWebviewProvider } from './WizardWebviewProvider';
import { WizardViewProvider } from './WizardViewProvider';

export function activate(context: vscode.ExtensionContext) {
  // Register the original command palette command (for backward compatibility)
  let disposable = vscode.commands.registerCommand('mssql-datavirtualization.virtualizeDataWizard', async () => {
    let wizard: VirtualizationWizard = new VirtualizationWizard();
    await wizard.RunWizard();
  });
  context.subscriptions.push(disposable);

  // Register the new webview-based wizard command
  let webviewCommand = vscode.commands.registerCommand('mssql-datavirtualization.openWizardWebview', () => {
    WizardWebviewProvider.createOrShow(context.extensionUri);
  });
  context.subscriptions.push(webviewCommand);

  // Register the sidebar tree view provider
  const wizardViewProvider = new WizardViewProvider(context.extensionUri);
  const treeView = vscode.window.registerTreeDataProvider('mssqlDataVirtualization', wizardViewProvider);
  context.subscriptions.push(treeView);

  // Register refresh command for the tree view
  let refreshCommand = vscode.commands.registerCommand('mssql-datavirtualization.refreshView', () => {
    wizardViewProvider.refresh();
  });
  context.subscriptions.push(refreshCommand);
}

export function deactivate() {}
