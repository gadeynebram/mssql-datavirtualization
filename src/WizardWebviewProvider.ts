import * as vscode from 'vscode';
import { VirtualizationWizard } from './VirtualizationWizard';

/**
 * Manages the webview panel for the Data Virtualization Wizard.
 * Provides a multi-step UI with Previous/Next/Complete buttons.
 */
export class WizardWebviewProvider {
    public static currentPanel: WizardWebviewProvider | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _wizard: VirtualizationWizard;
    private _currentStep: number = 0;

    // Wizard steps
    private readonly steps = [
        'connection',
        'database',
        'provider',
        'schema',
        'datasource',
        'externaldatabases',
        'tables',
        'generate'
    ];

    // State to hold user selections
    private wizardState: {
        connection?: any;
        database?: string;
        provider?: string;
        schema?: string;
        dataSource?: string;
        externalDatabases?: string[];
        tables?: any[];
    } = {};

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._wizard = new VirtualizationWizard();

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                this._handleMessage(message);
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (WizardWebviewProvider.currentPanel) {
            WizardWebviewProvider.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'dataVirtualizationWizard',
            'Data Virtualization Wizard',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        WizardWebviewProvider.currentPanel = new WizardWebviewProvider(panel, extensionUri);
    }

    public dispose() {
        WizardWebviewProvider.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();
        this._wizard.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private async _handleMessage(message: any) {
        switch (message.command) {
            case 'next':
                await this._handleNext(message.data);
                break;
            case 'previous':
                await this._handlePrevious();
                break;
            case 'complete':
                await this._handleComplete();
                break;
            case 'cancel':
                this.dispose();
                break;
            case 'loadData':
                await this._loadStepData(message.step);
                break;
            case 'promptConnection':
                await this._promptConnection();
                break;
        }
    }

    private async _handleNext(data: any) {
        try {
            // Validate and process current step
            const currentStepName = this.steps[this._currentStep];
            const isValid = await this._validateStep(currentStepName, data);
            
            if (!isValid) {
                return; // Validation failed, stay on current step
            }

            // Save current step data
            this.wizardState[currentStepName as keyof typeof this.wizardState] = data;

            // Process step-specific logic
            await this._processStep(currentStepName, data);

            // Move to next step
            this._currentStep++;
            await this._update();
        } catch (error) {
            vscode.window.showErrorMessage(`Error processing step: ${error}`);
        }
    }

    private async _handlePrevious() {
        if (this._currentStep > 0) {
            this._currentStep--;
            await this._update();
        }
    }

    private async _handleComplete() {
        try {
            // Execute the final wizard steps
            await this._executeWizard();
        } catch (error) {
            vscode.window.showErrorMessage(`Wizard error: ${error}`);
        }
    }

    private async _promptConnection() {
        try {
            // Initialize API if not already done
            if (!this._wizard.API) {
                await this._wizard.GetMSSQLAPI();
            }

            // Check if API is available
            if (!this._wizard.API) {
                throw new Error('MSSQL API not available');
            }

            // Use native MSSQL extension connection dialog
            const connection = await this._wizard.API.promptForConnection();
            
            if (connection) {
                this._wizard.Connection = connection;
                this._wizard.ConnectionUri = await this._wizard.API.connect(connection);
                
                // Notify webview of successful connection
                this._panel.webview.postMessage({
                    command: 'connectionSuccess',
                    data: {
                        server: connection.server,
                        database: connection.database || '(not specified)'
                    }
                });
            } else {
                this._panel.webview.postMessage({
                    command: 'connectionCancelled'
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Connection failed: ${error}`);
            this._panel.webview.postMessage({
                command: 'connectionError',
                error: String(error)
            });
        }
    }

    private async _validateStep(stepName: string, data: any): Promise<boolean> {
        switch (stepName) {
            case 'connection':
                if (!this._wizard.ConnectionUri) {
                    vscode.window.showWarningMessage('Please establish a connection before continuing.');
                    return false;
                }
                return true;
            case 'database':
                if (!data || data.trim().length === 0) {
                    vscode.window.showWarningMessage('Please select a database.');
                    return false;
                }
                return true;
            case 'provider':
                if (!data) {
                    vscode.window.showWarningMessage('Please select a provider type.');
                    return false;
                }
                return true;
            case 'schema':
                if (!data || data.trim().length === 0) {
                    vscode.window.showWarningMessage('Please enter a schema name.');
                    return false;
                }
                // Validate schema name format
                if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(data.trim())) {
                    vscode.window.showWarningMessage('Schema name must be a valid SQL identifier.');
                    return false;
                }
                return true;
            case 'datasource':
                if (!data) {
                    vscode.window.showWarningMessage('Please select an external data source.');
                    return false;
                }
                return true;
            case 'externaldatabases':
                if (!data || data.length === 0) {
                    vscode.window.showWarningMessage('Please select at least one external database.');
                    return false;
                }
                return true;
            case 'tables':
                if (!data || data.length === 0) {
                    vscode.window.showWarningMessage('Please select at least one table or view.');
                    return false;
                }
                return true;
            default:
                return true;
        }
    }

    private async _processStep(stepName: string, data: any) {
        switch (stepName) {
            case 'database':
                this._wizard.SelectedDatabase = data;
                break;
            case 'provider':
                // Initialize provider based on selection
                await this._initializeProvider(data);
                break;
            case 'schema':
                this._wizard.SelectedSchema = data;
                // Ensure schema exists
                await this._wizard.EnsureSchemaExists();
                break;
            case 'externaldatabases':
                // Create discovery infrastructure
                const dataSource = this.wizardState.dataSource;
                if (dataSource) {
                    await this._createDiscoveryTables(dataSource, data);
                }
                break;
        }
    }

    private async _initializeProvider(providerType: string) {
        if (!this._wizard.API || !this._wizard.Connection || !this._wizard.ConnectionUri || !this._wizard.SelectedDatabase) {
            throw new Error('Wizard not properly initialized');
        }

        // Import only the required provider based on type
        if (providerType === 'mariadb') {
            const { MariaDBSchemaProvider } = await import('./providers/MariaDBSchemaProvider');
            this._wizard['provider'] = new MariaDBSchemaProvider(
                this._wizard.API,
                this._wizard.Connection,
                this._wizard.ConnectionUri
            );
        } else if (providerType === 'oracle') {
            const { OracleSchemaProvider } = await import('./providers/OracleSchemaProvider');
            this._wizard['provider'] = new OracleSchemaProvider(
                this._wizard.API,
                this._wizard.Connection,
                this._wizard.ConnectionUri
            );
        } else {
            const { MSSQLSchemaProvider } = await import('./providers/MSSQLSchemaProvider');
            this._wizard['provider'] = new MSSQLSchemaProvider(
                this._wizard.API,
                this._wizard.Connection,
                this._wizard.ConnectionUri
            );
        }

        await this._wizard['provider'].initialize(this._wizard.SelectedDatabase);
    }

    private async _createDiscoveryTables(dataSource: string, databases: string[]) {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Creating discovery tables",
            cancellable: false
        }, async (progress) => {
            const provider = this._wizard['provider'];
            if (!provider) {
                throw new Error('Provider not initialized');
            }

            const total = databases.length;
            for (let i = 0; i < total; i++) {
                const extDb = databases[i];
                progress.report({ 
                    increment: (i / total) * 100, 
                    message: `Processing ${extDb} (${i + 1}/${total})` 
                });
                await provider.createDiscoveryInfrastructure(dataSource, [extDb]);
            }
            progress.report({ increment: 100, message: 'Complete' });
        });
    }

    private async _executeWizard() {
        try {
            const provider = this._wizard['provider'];
            if (!provider || !this._wizard.SelectedSchema) {
                throw new Error('Wizard not properly configured');
            }

            const dataSource = this.wizardState.dataSource;
            const tables = this.wizardState.tables;
            const externalDatabases = this.wizardState.externalDatabases;

            if (!dataSource || !tables || !externalDatabases) {
                throw new Error('Missing required wizard data');
            }

            // Generate scripts using provider methods
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Generating external table scripts",
                cancellable: false
            }, async (progress) => {
                const scripts: string[] = [];
                scripts.push('-- Generated by Data Virtualization Wizard');
                scripts.push(`-- Date: ${new Date().toLocaleString()}`);
                scripts.push(`-- External Data Source: ${dataSource}`);
                scripts.push(`-- Destination Schema: ${this._wizard.SelectedSchema}`);
                scripts.push('');

                const total = tables.length;
                for (let i = 0; i < total; i++) {
                    const item = tables[i];
                    progress.report({ 
                        increment: (i / total) * 100, 
                        message: `Processing ${item.name} (${i + 1}/${total})` 
                    });

                    // Generate remote path based on item structure
                    const remote = item.externalDb 
                        ? `[${item.externalDb}].[${item.schema}].[${item.name}]`
                        : `${item.displayLabel}`;

                    // Detect the schema using the provider
                    const detectedSchema = await provider.detectSchema(remote, dataSource, `${item.schema}_${item.name}`);

                    if (detectedSchema) {
                        const script = provider.generateCreateScript(item, detectedSchema, dataSource, this._wizard.SelectedSchema);
                        scripts.push(script);
                    } else {
                        // If schema detection fails, add a comment
                        const localName = item.name;
                        const localFullName = `[${this._wizard.SelectedSchema}].[${localName}]`;
                        scripts.push(`-- External ${item.type === 'U' ? 'Table' : 'View'}: ${remote}`);
                        scripts.push(`-- WARNING: Could not detect schema for ${remote}`);
                        scripts.push(`-- CREATE EXTERNAL TABLE ${localFullName}`);
                        scripts.push(`-- (`);
                        scripts.push(`--     [column_name] DATA_TYPE`);
                        scripts.push(`-- )`);
                        scripts.push(`-- WITH (LOCATION = N'${remote}', DATA_SOURCE = [${dataSource}]);`);
                        scripts.push('');
                    }
                }

                progress.report({ increment: 100, message: 'Complete' });

                // Open scripts in editor
                const doc = await vscode.workspace.openTextDocument({
                    language: 'sql',
                    content: scripts.join('\n')
                });
                await vscode.window.showTextDocument(doc, { preview: false });
            });

            // Cleanup
            await provider.cleanupDiscoveryTables();

            vscode.window.showInformationMessage('Data Virtualization Wizard completed successfully!');
            this.dispose();
        } catch (error) {
            throw error;
        }
    }

    private async _loadStepData(step: string) {
        try {
            let data: any = {};
            
            switch (step) {
                case 'connection':
                    // Initialize API first
                    await this._wizard.GetMSSQLAPI();
                    data = { initialized: true };
                    break;
                    
                case 'database':
                    if (this._wizard.ConnectionUri) {
                        const databases = await this._wizard.API?.listDatabases(this._wizard.ConnectionUri);
                        data = { databases: databases || [] };
                    }
                    break;
                    
                case 'provider':
                    data = {
                        providers: [
                            { value: 'mssql', label: 'SQL Server (MSSQL)', description: 'For SQL Server external data sources' },
                            { value: 'mariadb', label: 'MariaDB / MySQL', description: 'For MariaDB or MySQL external data sources via ODBC' },
                            { value: 'oracle', label: 'Oracle', description: 'For Oracle external data sources using oracle:// connection' }
                        ]
                    };
                    break;
                    
                case 'datasource':
                    // Load external data sources
                    const provider = this._wizard['provider'];
                    if (provider) {
                        try {
                            const sources = await provider.listExternalDataSources();
                            data = { sources };
                        } catch (error) {
                            console.error('Error loading data sources:', error);
                            data = { sources: [], error: String(error) };
                        }
                    } else {
                        data = { sources: [], error: 'Provider not initialized' };
                    }
                    break;
                    
                case 'externaldatabases':
                    // Load external databases from selected data source
                    const extProvider = this._wizard['provider'];
                    const dataSource = this.wizardState.dataSource;
                    if (extProvider && dataSource) {
                        try {
                            const databases = await extProvider.listExternalDatabases(dataSource);
                            data = { databases };
                        } catch (error) {
                            console.error('Error loading external databases:', error);
                            data = { databases: [], error: String(error) };
                        }
                    } else {
                        data = { databases: [], error: 'Provider or data source not set' };
                    }
                    break;
                    
                case 'tables':
                    // Load tables and views from selected external databases
                    const tblProvider = this._wizard['provider'];
                    const extDatabases = this.wizardState.externalDatabases;
                    if (tblProvider && extDatabases && extDatabases.length > 0) {
                        try {
                            const items = await tblProvider.listTablesAndViews(extDatabases);
                            data = { 
                                tables: items.map(item => ({
                                    ...item,
                                    id: `${item.externalDb}.${item.schema}.${item.name}`
                                }))
                            };
                        } catch (error) {
                            console.error('Error loading tables:', error);
                            data = { tables: [], error: String(error) };
                        }
                    } else {
                        data = { tables: [], error: 'Provider or databases not set' };
                    }
                    break;
                    
                case 'generate':
                    // Prepare summary data
                    data = {
                        summary: {
                            database: this.wizardState.database,
                            provider: this.wizardState.provider,
                            schema: this.wizardState.schema,
                            dataSource: this.wizardState.dataSource,
                            externalDatabases: this.wizardState.externalDatabases,
                            tableCount: this.wizardState.tables?.length || 0
                        }
                    };
                    break;
            }
            
            this._panel.webview.postMessage({ command: 'stepData', step, data });
        } catch (error) {
            console.error('Error loading step data:', error);
            vscode.window.showErrorMessage(`Failed to load data for step ${step}: ${error}`);
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.title = 'Data Virtualization Wizard';
        this._panel.webview.html = this._getHtmlForWebview(webview);

        // Send current step to webview
        webview.postMessage({
            command: 'setStep',
            step: this._currentStep,
            stepName: this.steps[this._currentStep],
            totalSteps: this.steps.length,
            state: this.wizardState
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Use a nonce to only allow specific scripts to be run
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Data Virtualization Wizard</title>
    <style>
        body {
            padding: 20px;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }
        
        .wizard-container {
            max-width: 800px;
            margin: 0 auto;
        }
        
        .wizard-header {
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .wizard-title {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        .wizard-progress {
            display: flex;
            align-items: center;
            margin-top: 20px;
        }
        
        .progress-bar {
            flex: 1;
            height: 4px;
            background-color: var(--vscode-progressBar-background);
            border-radius: 2px;
            margin-right: 10px;
        }
        
        .progress-fill {
            height: 100%;
            background-color: var(--vscode-progressBar-background);
            border-radius: 2px;
            transition: width 0.3s ease;
        }
        
        .step-indicator {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        
        .wizard-content {
            min-height: 300px;
            margin-bottom: 30px;
        }
        
        .step-content {
            display: none;
        }
        
        .step-content.active {
            display: block;
            animation: fadeIn 0.3s;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .step-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 10px;
        }
        
        .step-description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 20px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
        }
        
        .form-input,
        .form-select {
            width: 100%;
            padding: 8px 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            font-family: inherit;
            font-size: inherit;
        }
        
        .form-input:focus,
        .form-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }
        
        .form-checkbox {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
            cursor: pointer;
        }
        
        .form-checkbox input[type="checkbox"] {
            margin-right: 8px;
        }
        
        .button-group {
            display: flex;
            justify-content: space-between;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        .button {
            padding: 8px 20px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-family: inherit;
            font-size: inherit;
        }
        
        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        
        .button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .button-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .button-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }
        
        .error-message {
            padding: 12px;
            margin-bottom: 16px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
            border-radius: 2px;
        }
        
        .info-message {
            padding: 12px;
            margin-bottom: 16px;
            background-color: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
            color: var(--vscode-inputValidation-infoForeground);
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="wizard-container">
        <div class="wizard-header">
            <div class="wizard-title">Data Virtualization Wizard</div>
            <div class="wizard-progress">
                <div class="progress-bar">
                    <div class="progress-fill" id="progressFill"></div>
                </div>
                <div class="step-indicator" id="stepIndicator">Step 1 of 8</div>
            </div>
        </div>
        
        <div class="wizard-content" id="wizardContent">
            <!-- Step 1: Connection -->
            <div class="step-content" data-step="0">
                <div class="step-title">SQL Server Connection</div>
                <div class="step-description">Select or create a SQL Server connection for data virtualization.</div>
                <div class="info-message">
                    Click the button below to open the connection dialog. You can select an existing connection or create a new one.
                </div>
                <div class="form-group">
                    <button class="button" id="connectBtn">Connect to SQL Server</button>
                </div>
                <div class="form-group">
                    <div id="connectionStatus">Not connected</div>
                </div>
            </div>
            
            <!-- Step 2: Database -->
            <div class="step-content" data-step="1">
                <div class="step-title">Select Database</div>
                <div class="step-description">Choose the target database for creating external tables.</div>
                <div class="form-group">
                    <label class="form-label" for="databaseSelect">Database:</label>
                    <select class="form-select" id="databaseSelect">
                        <option value="">-- Loading databases --</option>
                    </select>
                </div>
            </div>
            
            <!-- Step 3: Provider -->
            <div class="step-content" data-step="2">
                <div class="step-title">External Data Source Type</div>
                <div class="step-description">Select the type of external data source you will be connecting to.</div>
                <div class="form-group">
                    <label class="form-label" for="providerSelect">Provider:</label>
                    <select class="form-select" id="providerSelect">
                        <option value="mssql">SQL Server (MSSQL)</option>
                        <option value="mariadb">MariaDB / MySQL</option>
                        <option value="oracle">Oracle</option>
                    </select>
                </div>
            </div>
            
            <!-- Step 4: Schema -->
            <div class="step-content" data-step="3">
                <div class="step-title">Destination Schema</div>
                <div class="step-description">Enter the schema name where external tables will be created.</div>
                <div class="form-group">
                    <label class="form-label" for="schemaInput">Schema Name:</label>
                    <input type="text" class="form-input" id="schemaInput" value="dbo" placeholder="dbo" />
                </div>
            </div>
            
            <!-- Step 5: Data Source -->
            <div class="step-content" data-step="4">
                <div class="step-title">External Data Source</div>
                <div class="step-description">Select the external data source to query.</div>
                <div class="form-group">
                    <label class="form-label" for="dataSourceSelect">External Data Source:</label>
                    <select class="form-select" id="dataSourceSelect">
                        <option value="">-- Loading data sources --</option>
                    </select>
                </div>
            </div>
            
            <!-- Step 6: External Databases -->
            <div class="step-content" data-step="5">
                <div class="step-title">External Databases</div>
                <div class="step-description">Select one or more external databases to explore.</div>
                <div class="form-group">
                    <div id="externalDatabasesList">Loading...</div>
                </div>
            </div>
            
            <!-- Step 7: Tables and Views -->
            <div class="step-content" data-step="6">
                <div class="step-title">Tables and Views</div>
                <div class="step-description">Select tables and views to virtualize as external tables.</div>
                <div class="form-group">
                    <div id="tablesList">Loading...</div>
                </div>
            </div>
            
            <!-- Step 8: Generate -->
            <div class="step-content" data-step="7">
                <div class="step-title">Generate Scripts</div>
                <div class="step-description">Review your selections and generate the external table scripts.</div>
                <div class="info-message">
                    Click "Complete" to generate the external table scripts. The scripts will be opened in a new editor window.
                </div>
                <div id="summaryContent"></div>
            </div>
        </div>
        
        <div class="button-group">
            <div>
                <button class="button button-secondary" id="cancelBtn">Cancel</button>
            </div>
            <div>
                <button class="button button-secondary" id="previousBtn" disabled>Previous</button>
                <button class="button" id="nextBtn">Next</button>
                <button class="button" id="completeBtn" style="display: none;">Complete</button>
            </div>
        </div>
    </div>
    
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let currentStep = 0;
        let totalSteps = 8;
        let wizardState = {};
        
        // Button references
        const previousBtn = document.getElementById('previousBtn');
        const nextBtn = document.getElementById('nextBtn');
        const completeBtn = document.getElementById('completeBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const connectBtn = document.getElementById('connectBtn');
        
        // Connection button handler
        if (connectBtn) {
            connectBtn.addEventListener('click', () => {
                vscode.postMessage({ command: 'promptConnection' });
            });
        }
        
        // Update UI based on current step
        function updateUI(step, stepName, total, state) {
            currentStep = step;
            totalSteps = total;
            wizardState = state || {};
            
            // Update progress
            const progress = ((step + 1) / total) * 100;
            document.getElementById('progressFill').style.width = progress + '%';
            document.getElementById('stepIndicator').textContent = \`Step \${step + 1} of \${total}\`;
            
            // Show/hide step content
            document.querySelectorAll('.step-content').forEach((content, index) => {
                if (index === step) {
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                }
            });
            
            // Update buttons
            previousBtn.disabled = step === 0;
            
            if (step === total - 1) {
                nextBtn.style.display = 'none';
                completeBtn.style.display = 'inline-block';
            } else {
                nextBtn.style.display = 'inline-block';
                completeBtn.style.display = 'none';
            }
            
            // Load data for current step
            vscode.postMessage({ command: 'loadData', step: stepName });
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'setStep':
                    updateUI(message.step, message.stepName, message.totalSteps, message.state);
                    break;
                case 'stepData':
                    handleStepData(message.step, message.data);
                    break;
                case 'connectionSuccess':
                    handleConnectionSuccess(message.data);
                    break;
                case 'connectionCancelled':
                    document.getElementById('connectionStatus').textContent = 'Connection cancelled. Please try again.';
                    break;
                case 'connectionError':
                    document.getElementById('connectionStatus').textContent = 'Connection error: ' + message.error;
                    break;
            }
        });
        
        function handleConnectionSuccess(data) {
            const status = document.getElementById('connectionStatus');
            status.textContent = \`Connected to \${data.server} (Database: \${data.database})\`;
            status.style.color = 'var(--vscode-charts-green)';
        }
        
        function handleStepData(step, data) {
            switch (step) {
                case 'connection':
                    document.getElementById('connectionStatus').textContent = 'Not connected';
                    break;
                    
                case 'database':
                    const dbSelect = document.getElementById('databaseSelect');
                    dbSelect.innerHTML = '';
                    if (data.databases && data.databases.length > 0) {
                        data.databases.forEach(db => {
                            const option = document.createElement('option');
                            option.value = db;
                            option.textContent = db;
                            dbSelect.appendChild(option);
                        });
                    } else {
                        const option = document.createElement('option');
                        option.value = '';
                        option.textContent = '-- No databases found --';
                        dbSelect.appendChild(option);
                    }
                    break;
                    
                case 'provider':
                    // Provider options are static in HTML
                    break;
                    
                case 'datasource':
                    const dsSelect = document.getElementById('dataSourceSelect');
                    dsSelect.innerHTML = '';
                    if (data.sources && data.sources.length > 0) {
                        data.sources.forEach(source => {
                            const option = document.createElement('option');
                            option.value = source;
                            option.textContent = source;
                            dsSelect.appendChild(option);
                        });
                    } else {
                        const option = document.createElement('option');
                        option.value = '';
                        option.textContent = data.error || '-- No data sources found --';
                        dsSelect.appendChild(option);
                    }
                    break;
                    
                case 'externaldatabases':
                    const dbList = document.getElementById('externalDatabasesList');
                    dbList.innerHTML = '';
                    if (data.databases && data.databases.length > 0) {
                        data.databases.forEach(db => {
                            const label = document.createElement('label');
                            label.className = 'form-checkbox';
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.value = db;
                            checkbox.name = 'externalDb';
                            label.appendChild(checkbox);
                            label.appendChild(document.createTextNode(db));
                            dbList.appendChild(label);
                        });
                    } else {
                        dbList.textContent = data.error || 'No external databases found';
                    }
                    break;
                    
                case 'tables':
                    const tablesList = document.getElementById('tablesList');
                    tablesList.innerHTML = '';
                    if (data.tables && data.tables.length > 0) {
                        data.tables.forEach(table => {
                            const label = document.createElement('label');
                            label.className = 'form-checkbox';
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.value = table.id || table.displayLabel;
                            checkbox.name = 'table';
                            checkbox.setAttribute('data-table', JSON.stringify(table));
                            label.appendChild(checkbox);
                            label.appendChild(document.createTextNode(table.displayLabel || table.name));
                            tablesList.appendChild(label);
                        });
                    } else {
                        tablesList.textContent = data.error || 'No tables found';
                    }
                    break;
                    
                case 'generate':
                    const summary = document.getElementById('summaryContent');
                    if (data.summary) {
                        const s = data.summary;
                        summary.innerHTML = \`
                            <div class="form-group">
                                <strong>Target Database:</strong> \${s.database || 'N/A'}
                            </div>
                            <div class="form-group">
                                <strong>Provider Type:</strong> \${s.provider || 'N/A'}
                            </div>
                            <div class="form-group">
                                <strong>Destination Schema:</strong> \${s.schema || 'N/A'}
                            </div>
                            <div class="form-group">
                                <strong>External Data Source:</strong> \${s.dataSource || 'N/A'}
                            </div>
                            <div class="form-group">
                                <strong>External Databases:</strong> \${s.externalDatabases ? s.externalDatabases.join(', ') : 'N/A'}
                            </div>
                            <div class="form-group">
                                <strong>Tables to Virtualize:</strong> \${s.tableCount || 0}
                            </div>
                        \`;
                    }
                    break;
            }
        }
        
        // Button click handlers
        previousBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'previous' });
        });
        
        nextBtn.addEventListener('click', () => {
            const data = collectCurrentStepData();
            vscode.postMessage({ command: 'next', data });
        });
        
        completeBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'complete' });
        });
        
        cancelBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to cancel the wizard?')) {
                vscode.postMessage({ command: 'cancel' });
            }
        });
        
        function collectCurrentStepData() {
            const stepContent = document.querySelector('.step-content.active');
            const stepIndex = parseInt(stepContent.getAttribute('data-step'));
            
            switch (stepIndex) {
                case 0: // Connection
                    return { connected: true };
                case 1: // Database
                    return document.getElementById('databaseSelect').value;
                case 2: // Provider
                    return document.getElementById('providerSelect').value;
                case 3: // Schema
                    return document.getElementById('schemaInput').value;
                case 4: // Data Source
                    return document.getElementById('dataSourceSelect').value;
                case 5: // External Databases
                    const checkedDbs = [];
                    document.querySelectorAll('#externalDatabasesList input[type="checkbox"]:checked').forEach(cb => {
                        checkedDbs.push(cb.value);
                    });
                    return checkedDbs;
                case 6: // Tables
                    const checkedTables = [];
                    document.querySelectorAll('#tablesList input[type="checkbox"]:checked').forEach(cb => {
                        try {
                            const tableData = JSON.parse(cb.getAttribute('data-table'));
                            checkedTables.push(tableData);
                        } catch (e) {
                            // Fallback if JSON parsing fails
                            checkedTables.push({ name: cb.value });
                        }
                    });
                    return checkedTables;
                default:
                    return {};
            }
        }
        }
    </script>
</body>
</html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
