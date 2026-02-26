import * as vscode from 'vscode';
import { WizardWebviewProvider } from './WizardWebviewProvider';

/**
 * Provides the tree view for the Data Virtualization sidebar.
 * Displays a simple tree with an item to launch the wizard.
 */
export class WizardViewProvider implements vscode.TreeDataProvider<WizardTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<WizardTreeItem | undefined | null | void> = new vscode.EventEmitter<WizardTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WizardTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private extensionUri: vscode.Uri) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: WizardTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: WizardTreeItem): Thenable<WizardTreeItem[]> {
        if (!element) {
            // Root level - show main actions
            return Promise.resolve([
                new WizardTreeItem(
                    'Start Data Virtualization Wizard',
                    'Click to launch the wizard',
                    vscode.TreeItemCollapsibleState.None,
                    'startWizard',
                    {
                        command: 'mssql-datavirtualization.openWizardWebview',
                        title: 'Start Wizard',
                        arguments: []
                    }
                ),
                new WizardTreeItem(
                    'About',
                    'Learn more about data virtualization',
                    vscode.TreeItemCollapsibleState.None,
                    'info'
                )
            ]);
        }
        return Promise.resolve([]);
    }
}

/**
 * Represents an item in the wizard tree view.
 */
export class WizardTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly tooltip: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly iconName?: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.tooltip = tooltip;
        this.description = '';
        
        // Set icon based on iconName
        if (iconName === 'startWizard') {
            this.iconPath = new vscode.ThemeIcon('rocket');
        } else if (iconName === 'info') {
            this.iconPath = new vscode.ThemeIcon('info');
        }
    }
}
