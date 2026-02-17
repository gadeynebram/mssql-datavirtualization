# Test Infrastructure

This folder provides test environments for the MSSQL Data Virtualization Wizard.

## Option 1: Local SQL Server Express (Recommended for Development)

### Prerequisites

- Windows 10 or later
- SQL Server Express 2022 or later installed locally

### Installation Steps

1. Download and install SQL Server Express 2022 from https://www.microsoft.com/en-us/sql-server/sql-server-express
   - Select custom installation. Choose both database services and PolyBase services
   - If running this from a non-domain joined machine, select mixed mode for authentication.

2. Once installed, open SQL Server Management Studio or connect via MSSQL extension in VS Code

3. Execute the SQL init scripts in the following order to set up the Data Federation infrastructure:
   - [sqlserver/datafederation/1.EnablePolyBase.sql](sqlserver/datafederation/1.EnablePolyBase.sql)
   - [sqlserver/datafederation/2.CreateDataFederationDB.sql](sqlserver/datafederation/2.CreateDataFederationDB.sql)
   - [sqlserver/datafederation/3.CreateMSSQLExtConnection.sql](sqlserver/datafederation/3.CreateMSSQLExtConnection.sql)

4. After Data Federation is configured, you can use the **MSSQL Data Virtualization Wizard** in VS Code to load the Movies database as an external table

### Connection Details (Local Setup)

| Database | Server | User | Password |
| --- | --- | --- | --- |
| DataFederationDB | localhost\SQLEXPRESS | sa | YourStrong!Passw0rd |

## Option 2: Docker/Podman (Hosting the Movies Database)

You can use Docker or Podman to host the Movies database separately. Your local SQL Express instance will connect to it via PolyBase.

### Prerequisites

- Docker Desktop or Podman installed
- Compose support enabled

### Start/Stop

From this folder:

```bash
# Start containers
docker compose up -d
# or
podman compose up -d

# Stop containers
docker compose down -v
# or
podman compose down -v
```

### Connection Details (Docker Setup)

| Service | Port | Database | User | Password |
| --- | --- | --- | --- | --- |
| movies | 14332 | Movies | sa | YourStrong!Passw0rd |

> **Note**: Use `127.0.0.1` instead of `localhost` when connecting to containers from Windows (e.g., `127.0.0.1,14332`).

## Manual Test Flow

After setting up the Data Federation infrastructure:

1. Optionally, start the Movies database via Docker/Podman (or it can be running locally on a different SQL Server instance)

2. In VS Code, open the MSSQL extension and create a connection to your local SQL Express instance:
   - **Server**: `localhost\SQLEXPRESS`
   - **Authentication**: SQL Login
   - **User**: `sa`
   - **Password**: `YourStrong!Passw0rd`

3. Run the **Virtualize Data Wizard** (press CTRL+Shift+P) command (`mssql-datavirtualization.virtualizeDataWizard`)

4. Follow the wizard steps:
   - Select Connection: **DataFederationDB**
   - Select database: **DataFederationDB**
   - Select external data source: **MoviesExternalSource**
   - Select external database: **Movies**
   - Select tables: **dbo.Movies** and **dbo.Ratings**

5. Verify that the generated `CREATE EXTERNAL TABLE` scripts open in a new editor tab

6. Execute the generated scripts against your connection

7. Run [sqlserver/datafederation/4.VerifyExternalTables.sql](sqlserver/datafederation/4.VerifyExternalTables) against your current connection to verify that you can access the remove Movies and Ratings tables.

## External Data Source Details

The wizard discovers this external data source automatically:

- **Name**: `MoviesExternalSource`
- **Type**: RDBMS
- **Location**: Points to your Movies database instance (Docker container or separate SQL Server)

## Test Databases

### Movies Database

Contains two tables:
- `dbo.Movies` (MovieId, Title, ReleaseYear)
- `dbo.Ratings` (RatingId, MovieId, Rating, RatedAt)

## Troubleshooting

### "Cannot connect to SQL Server"

- Ensure SQL Server service is running: `services.msc` → find "SQL Server (SQLEXPRESS)" → verify it's **Started**
- Try connecting via SQL Server Management Studio first to verify credentials

### "External data source not found"

- Run the Data Federation scripts in order:
  - [sqlserver/datafederation/1.EnablePolyBase.sql](sqlserver/datafederation/1.EnablePolyBase.sql)
  - [sqlserver/datafederation/2.CreateDataFederationDB.sql](sqlserver/datafederation/2.CreateDataFederationDB.sql)
  - [sqlserver/datafederation/3.CreateMSSQLExtConnection.sql](sqlserver/datafederation/3.CreateMSSQLExtConnection.sql)
- Ensure the Movies database is accessible at the location specified in the external data source

### Docker containers fail to start

- Check logs: `docker compose logs`
- Ensure you have sufficient disk space and permissions
