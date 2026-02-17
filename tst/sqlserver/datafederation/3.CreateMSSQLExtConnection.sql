/*
If you are running this from a non domain joined machine, you will need to use SQL Authentication instead of Windows Authentication.
*/

USE DataFederationDB;
GO

IF NOT EXISTS (SELECT 1 FROM sys.symmetric_keys WHERE name = '##MS_DatabaseMasterKey##')
BEGIN
  CREATE MASTER KEY ENCRYPTION BY PASSWORD = 'MasterKey!Passw0rd';
END
GO

IF EXISTS (SELECT 1 FROM sys.database_scoped_credentials WHERE name = 'MoviesCredential')
BEGIN
  DROP DATABASE SCOPED CREDENTIAL MoviesCredential;
END
GO

IF EXISTS (SELECT 1 FROM sys.external_data_sources WHERE name = 'MoviesExternalSource')
BEGIN
  DROP EXTERNAL DATA SOURCE MoviesExternalSource;
END
GO
CREATE DATABASE SCOPED CREDENTIAL MoviesCredential
WITH IDENTITY = 'polybase_user', SECRET = 'PolyBase!Passw0rd';
GO


CREATE EXTERNAL DATA SOURCE MoviesExternalSource
WITH ( 
    LOCATION = 'sqlserver://127.0.0.1:14332',
    CREDENTIAL = MoviesCredential
);
GO
