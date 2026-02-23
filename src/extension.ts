import * as vscode from 'vscode';
import { VirtualizationWizard } from './VirtualizationWizard';

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand('mssql-datavirtualization.virtualizeDataWizard', async () => {

    let wizard: VirtualizationWizard = new VirtualizationWizard();
    
    await wizard.RunWizard();
    
  }); // vscode.commands.registerCommand
  context.subscriptions.push(disposable);
}

export function deactivate() {}
