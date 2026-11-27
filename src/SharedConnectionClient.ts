import * as vscode from 'vscode';
import { ISharedConnectionsService, SimpleExecuteResult } from 'vscode-mssql';

export class SharedConnectionClient {
  constructor(
    private readonly api: ISharedConnectionsService,
    readonly connectionId: string,
    private readonly database?: string
  ) {}

  private async getAccessToken(): Promise<string> {
    const session = await vscode.authentication.getSession(this.api.authenticationProviderId, [], {
      createIfNone: true
    });
    return session.accessToken;
  }

  async getDatabase(): Promise<string | undefined> {
    if (this.database) {
      return this.database;
    }
    return this.api.getDatabaseForConnectionId(await this.getAccessToken(), this.connectionId);
  }

  async listDatabases(): Promise<string[]> {
    return this.withConnection(this.database, (accessToken, connectionUri) =>
      this.api.listDatabases(accessToken, connectionUri));
  }

  async executeSimpleQuery(database: string | undefined, query: string): Promise<SimpleExecuteResult> {
    return this.withConnection(database, (accessToken, connectionUri) =>
      this.api.executeSimpleQuery(accessToken, connectionUri, query));
  }

  private async withConnection<Result>(
    database: string | undefined,
    operation: (accessToken: string, connectionUri: string) => Promise<Result>
  ): Promise<Result> {
    const accessToken = await this.getAccessToken();
    const connectionUri = await this.api.connect(accessToken, this.connectionId, database);
    try {
      return await operation(accessToken, connectionUri);
    } finally {
      try {
        await this.api.disconnect(accessToken, connectionUri);
      } catch (error) {
        console.error('Could not disconnect the MSSQL shared connection:', error);
      }
    }
  }
}