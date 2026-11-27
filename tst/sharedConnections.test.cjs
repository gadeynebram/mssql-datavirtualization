const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function loadModule(relativePath, vscode, dependencies = {}, consoleApi = console) {
  const module = { exports: {} };
  const filename = path.join(__dirname, '..', 'out', relativePath);
  vm.runInNewContext(readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: name => name === 'vscode' ? vscode : dependencies[name],
    console: consoleApi
  }, { filename });
  return module.exports;
}

function createClientFixture(overrides = {}) {
  const calls = [];
  let tokenNumber = 0;
  const vscode = {
    authentication: {
      getSession: async (providerId, scopes, options) => {
        assert.equal(providerId, 'mssql-shared-connections');
        assert.equal(scopes.length, 0);
        assert.equal(options.createIfNone, true);
        return { accessToken: `token-${++tokenNumber}` };
      }
    }
  };
  const result = { rows: [], rowCount: 0, columnInfo: [] };
  const api = {
    authenticationProviderId: 'mssql-shared-connections',
    connect: async (...args) => { calls.push(['connect', ...args]); return `uri-${args[0]}`; },
    executeSimpleQuery: async (...args) => { calls.push(['query', ...args]); return result; },
    disconnect: async (...args) => { calls.push(['disconnect', ...args]); },
    listDatabases: async (...args) => { calls.push(['list', ...args]); return ['DataFederation']; },
    getDatabaseForConnectionId: async (...args) => { calls.push(['database', ...args]); return 'SavedDatabase'; },
    ...overrides
  };
  const errors = [];
  const { SharedConnectionClient } = loadModule('SharedConnectionClient.js', vscode, {}, {
    error: (...args) => errors.push(args)
  });
  return { api, calls, result, errors, client: new SharedConnectionClient(api, 'profile-id'), SharedConnectionClient };
}

test('queries use a fresh token and a URI opened and closed with that token', async () => {
  const { client, calls, result } = createClientFixture();
  assert.equal(await client.executeSimpleQuery('DataFederation', 'SELECT 1'), result);
  await client.executeSimpleQuery('DataFederation', 'SELECT 2');
  assert.deepEqual(calls, [
    ['connect', 'token-1', 'profile-id', 'DataFederation'],
    ['query', 'token-1', 'uri-token-1', 'SELECT 1'],
    ['disconnect', 'token-1', 'uri-token-1'],
    ['connect', 'token-2', 'profile-id', 'DataFederation'],
    ['query', 'token-2', 'uri-token-2', 'SELECT 2'],
    ['disconnect', 'token-2', 'uri-token-2']
  ]);
});

test('query errors survive cleanup, including a failed disconnect', async () => {
  const schemaError = new Error('The detected external table schema is: ([id] INT).');
  const { client, errors } = createClientFixture({
    executeSimpleQuery: async () => { throw schemaError; },
    disconnect: async () => { throw new Error('Session ended'); }
  });
  await assert.rejects(client.executeSimpleQuery('DataFederation', 'CREATE EXTERNAL TABLE'), error => error === schemaError);
  assert.equal(errors.length, 1);
});

test('query failures still disconnect their shared connection', async () => {
  const { client, calls } = createClientFixture({
    executeSimpleQuery: async () => { throw new Error('SQL failure'); }
  });
  await assert.rejects(client.executeSimpleQuery('DataFederation', 'SELECT 1'), /SQL failure/);
  assert.deepEqual(calls.at(-1), ['disconnect', 'token-1', 'uri-token-1']);
});

test('connection failures do not execute queries or disconnect an unopened URI', async () => {
  const { client, calls } = createClientFixture({
    connect: async () => { throw new Error('Connection failed'); }
  });
  await assert.rejects(client.executeSimpleQuery('DataFederation', 'SELECT 1'), /Connection failed/);
  assert.deepEqual(calls, []);
});

test('database lookup and listing use authenticated APIs with connection cleanup', async () => {
  const { client, calls } = createClientFixture();
  assert.equal(await client.getDatabase(), 'SavedDatabase');
  assert.deepEqual(await client.listDatabases(), ['DataFederation']);
  assert.deepEqual(calls, [
    ['database', 'token-1', 'profile-id'],
    ['connect', 'token-2', 'profile-id', undefined],
    ['list', 'token-2', 'uri-token-2'],
    ['disconnect', 'token-2', 'uri-token-2']
  ]);
});

test('active editor database takes precedence over the saved profile database', async () => {
  const { api, SharedConnectionClient, calls } = createClientFixture();
  const client = new SharedConnectionClient(api, 'profile-id', 'EditorDatabase');
  assert.equal(await client.getDatabase(), 'EditorDatabase');
  await client.listDatabases();
  assert.deepEqual(calls[0], ['connect', 'token-1', 'profile-id', 'EditorDatabase']);
});

function createWizardFixture({ active = false, profiles = [], pick, confirmation = 'Yes', namespaceInput = 'SOMENAMESPACE' } = {}) {
  const clientFixture = createClientFixture();
  const api = {
    ...clientFixture.api,
    getActiveEditorConnectionId: async () => 'active-id',
    getActiveDatabase: async () => 'EditorDatabase'
  };
  const commands = [];
  const irisProviders = [];
  class FakeIRISSchemaProvider {
    constructor(connection, namespace) {
      const instance = { connection, namespace, database: undefined };
      irisProviders.push(instance);
      this.instance = instance;
    }
    async initialize(database) { this.instance.database = database; }
  }
  const vscode = {
    extensions: { getExtension: () => ({ activate: async () => {}, exports: {
      getSharedConnectionsApi: version => { assert.equal(version, 1); return api; }
    } }) },
    authentication: { getSession: async () => ({ accessToken: 'consent-token' }) },
    workspace: { getConfiguration: () => ({ get: () => profiles }) },
    window: {
      activeTextEditor: active ? {} : undefined,
      showQuickPick: async items => pick ? pick(items) : undefined,
      showInputBox: async () => namespaceInput,
      showWarningMessage: async () => confirmation,
      showInformationMessage: () => {}
    },
    commands: { executeCommand: async command => { commands.push(command); } }
  };
  const { VirtualizationWizard } = loadModule('VirtualizationWizard.js', vscode, {
    './SharedConnectionClient': { SharedConnectionClient: clientFixture.SharedConnectionClient },
    './providers/MSSQLSchemaProvider': {},
    './providers/MariaDBSchemaProvider': {},
    './providers/OracleSchemaProvider': {},
    './providers/IRISSchemaProvider': { IRISSchemaProvider: FakeIRISSchemaProvider }
  });
  return { wizard: new VirtualizationWizard(), vscode, api, commands, irisProviders };
}

test('wizard obtains API v1 and can select a saved connection without an editor', async () => {
  const { wizard } = createWizardFixture({
    profiles: [{ id: 'saved-id', profileName: 'Local SQL' }],
    pick: items => items.find(item => item.connectionId === 'saved-id')
  });
  await wizard.GetMSSQLAPI();
  await wizard.PromptForConnection();
  assert.equal(wizard.Connection.connectionId, 'saved-id');
});

test('wizard preserves the active editor database', async () => {
  const { wizard } = createWizardFixture({ active: true, pick: items => items[0] });
  await wizard.GetMSSQLAPI();
  await wizard.PromptForConnection();
  assert.equal(wizard.Connection.connectionId, 'active-id');
  assert.equal(await wizard.Connection.getDatabase(), 'EditorDatabase');
});

test('connection selection cancellation exits without creating a client', async () => {
  const { wizard } = createWizardFixture();
  await wizard.GetMSSQLAPI();
  await wizard.PromptForConnection();
  assert.equal(wizard.Connection, undefined);
});

test('new connection selection opens MSSQL UI without racing its asynchronous dialog', async () => {
  const { wizard, commands } = createWizardFixture({ pick: items => items.at(-1) });
  await wizard.GetMSSQLAPI();
  await wizard.PromptForConnection();
  assert.deepEqual(commands, ['mssql.addObjectExplorer']);
  assert.equal(wizard.Connection, undefined);
});

test('older MSSQL versions produce an actionable compatibility error', async () => {
  const { wizard, vscode } = createWizardFixture();
  vscode.extensions.getExtension = () => ({ activate: async () => {}, exports: {} });
  await assert.rejects(wizard.GetMSSQLAPI(), /Update the MSSQL extension/);
});

test('denied authentication prevents connection selection and queries', async () => {
  const { wizard, vscode } = createWizardFixture();
  vscode.authentication.getSession = async () => { throw new Error('Access denied'); };
  vscode.window.showQuickPick = async () => { assert.fail('Picker must not open without consent'); };
  await wizard.GetMSSQLAPI();
  await assert.rejects(wizard.PromptForConnection(), /Access denied/);
  assert.equal(wizard.Connection, undefined);
});

test('wizard prompts for the IRIS namespace and initializes the selected provider', async () => {
  const { wizard, irisProviders } = createWizardFixture({
    pick: items => items.find(item => item.value === 'iris'),
    namespaceInput: 'SomeSchema'
  });
  wizard.API = {};
  wizard.Connection = {};
  wizard.SelectedDatabase = 'DataFederation';
  await wizard.InitializeProvider();
  assert.deepEqual(irisProviders.map(({ namespace, database }) => ({ namespace, database })), [
    { namespace: 'SomeSchema', database: 'DataFederation' }
  ]);
});

test('wizard returns to provider selection when the IRIS namespace prompt is cancelled', async () => {
  const { wizard, irisProviders } = createWizardFixture({
    pick: items => items.find(item => item.value === 'iris'),
    namespaceInput: null
  });
  wizard.API = {};
  wizard.Connection = {};
  wizard.SelectedDatabase = 'DataFederation';
  await wizard.InitializeProvider();
  assert.equal(irisProviders.length, 0);
});

for (const providerName of ['MSSQLSchemaProvider', 'MariaDBSchemaProvider', 'OracleSchemaProvider']) {
  test(`${providerName} executes discovery using the selected database and shared client`, async () => {
    const calls = [];
    const client = {
      executeSimpleQuery: async (...args) => {
        calls.push(args);
        return { rows: [[{ displayValue: 'ExternalSource' }]] };
      }
    };
    const Provider = loadModule(`providers/${providerName}.js`, {})[providerName];
    const provider = new Provider(client);
    await provider.initialize('DataFederation');
    assert.equal((await provider.listExternalDataSources())[0], 'ExternalSource');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'DataFederation');
    assert.match(calls[0][1], /sys\.external_data_sources/);
    provider.dispose();
  });
}

test('IRIS provider discovers schemas and generates three-part LOCATION values', async () => {
  const calls = [];
  const client = {
    executeSimpleQuery: async (database, query) => {
      calls.push([database, query]);
      if (query.includes('SELECT name FROM sys.external_data_sources')) {
        return { rows: [[{ displayValue: 'IRISDS' }]] };
      }
      if (query.includes('SELECT SCHEMA_NAME')) {
        return { rows: [[{ displayValue: 'SomeSchema' }]] };
      }
      if (query.includes('SELECT TABLE_NAME, TABLE_TYPE')) {
        return { rows: [
          [{ displayValue: 'SomeTable' }, { displayValue: 'BASE TABLE' }],
          [{ displayValue: 'SomeTableView' }, { displayValue: 'VIEW' }]
        ] };
      }
      if (query.includes('CREATE EXTERNAL TABLE') && query.includes('NonExistingColumn')) {
        throw new Error('The detected external table schema is: ([ID] BIGINT NOT NULL, [Name] NVARCHAR(100)).');
      }
      return { rows: [] };
    }
  };
  const { IRISSchemaProvider } = loadModule('providers/IRISSchemaProvider.js', {});
  const provider = new IRISSchemaProvider(client, 'SomeSchema');
  await provider.initialize('DataFederation');

  assert.deepEqual(await provider.listExternalDataSources(), ['IRISDS']);
  assert.deepEqual(await provider.listExternalDatabases('IRISDS'), ['SomeSchema']);
  await provider.createDiscoveryInfrastructure('IRISDS', ['SomeSchema']);
  const items = await provider.listTablesAndViews(['SomeSchema']);
  assert.equal(items.length, 2);
  assert.equal(items[0].type, 'U');
  assert.equal(items[1].type, 'V');
  assert.equal(provider.getRemoteLocation(items[0]), 'SomeSchema.SomeSchema.SomeTable');

  const detected = await provider.detectSchema('SomeSchema.SomeSchema.SomeTable', 'IRISDS');
  assert.equal(detected, '([ID] BIGINT NOT NULL, [Name] NVARCHAR(100))');
  const script = provider.generateCreateScript(items[0], detected, 'IRISDS', 'IRIS');
  assert.match(script, /LOCATION = N'SomeSchema\.SomeSchema\.SomeTable'/);
  assert.match(script, /\[IRIS\]\.\[SomeTable\]/);
  assert.ok(calls.every(([database]) => database === 'DataFederation'));

  await provider.cleanupDiscoveryTables();
  provider.dispose();
});

test('schema creation explicitly uses the selected database for both queries', async () => {
  const { wizard, api } = createWizardFixture();
  const calls = [];
  wizard.API = api;
  wizard.SelectedDatabase = 'DataFederation';
  wizard.SelectedSchema = 'external';
  wizard.Connection = {
    executeSimpleQuery: async (...args) => {
      calls.push(args);
      return { rows: [[{ displayValue: '0' }]] };
    }
  };
  await wizard.EnsureSchemaExists();
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'DataFederation');
  assert.deepEqual(calls[1], ['DataFederation', 'CREATE SCHEMA [external]']);
});