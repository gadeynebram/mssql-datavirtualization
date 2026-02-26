import * as vscode from 'vscode';

/**
 * Tree item for the wizard view
 */
class WizardTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly commandId?: string,
    public readonly iconName?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = description;
    
    if (commandId) {
      this.command = {
        command: commandId,
        title: label,
        arguments: []
      };
    }

    if (iconName) {
      this.iconPath = new vscode.ThemeIcon(iconName);
    }
  }
}

/**
 * Tree Data Provider for the Data Virtualization wizard view
 * Provides a simple tree structure with action items
 */
export class WizardTreeProvider implements vscode.TreeDataProvider<WizardTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<WizardTreeItem | undefined | null | void> = new vscode.EventEmitter<WizardTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<WizardTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item representation
   */
  getTreeItem(element: WizardTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children nodes for the tree
   */
  getChildren(element?: WizardTreeItem): Thenable<WizardTreeItem[]> {
    if (element) {
      // No child nodes in this simple tree
      return Promise.resolve([]);
    } else {
      // Root level items
      return Promise.resolve(this.getWizardActions());
    }
  }

  /**
   * Returns the list of wizard actions
   */
  private getWizardActions(): WizardTreeItem[] {
    return [
      new WizardTreeItem(
        'Start Wizard',
        'Launch the data virtualization wizard',
        'mssql-datavirtualization.virtualizeDataWizard',
        'debug-start'
      ),
      new WizardTreeItem(
        'Help',
        'View documentation',
        'mssql-datavirtualization.showHelp',
        'question'
      )
    ];
  }
}
