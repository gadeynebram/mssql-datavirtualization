USE DataFederation;
GO

-- Create database scoped credential for Oracle connection
-- Note: Oracle connections use SYSTEM user for demonstration purposes
-- In production, create a dedicated user with appropriate permissions
IF EXISTS (SELECT * FROM sys.database_scoped_credentials WHERE name = 'OracleCredential')
    DROP DATABASE SCOPED CREDENTIAL OracleCredential;
GO

CREATE DATABASE SCOPED CREDENTIAL OracleCredential
WITH IDENTITY = 'SYSTEM',
     SECRET = 'Oracle!Passw0rd';
GO

-- Create external data source using oracle:// connection string
-- See: https://learn.microsoft.com/en-us/sql/relational-databases/polybase/polybase-configure-oracle
IF EXISTS (SELECT * FROM sys.external_data_sources WHERE name = 'Oracle_Aviation')
    DROP EXTERNAL DATA SOURCE Oracle_Aviation;
GO

CREATE EXTERNAL DATA SOURCE Oracle_Aviation
WITH (
    LOCATION = 'oracle://localhost:1521/Aviation',
    CREDENTIAL = OracleCredential
);

GO

-- Verify the external data source was created successfully
SELECT name, location, type_desc
FROM sys.external_data_sources
WHERE name = 'Oracle_Aviation';
GO
