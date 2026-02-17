USE DataFederation;
GO

IF EXISTS (SELECT * FROM sys.database_scoped_credentials WHERE name = 'MariaDBCredential')
    DROP DATABASE SCOPED CREDENTIAL MariaDBCredential;
GO

CREATE DATABASE SCOPED CREDENTIAL MariaDBCredential
WITH IDENTITY = 'books_user',
     SECRET = 'Books!Passw0rd';
GO

IF EXISTS (SELECT * FROM sys.external_data_sources WHERE name = 'MariaDB_Books')
    DROP EXTERNAL DATA SOURCE MariaDB_Books;
GO

CREATE EXTERNAL DATA SOURCE MariaDB_Books
WITH (
    LOCATION = 'odbc://localhost:3307',
    CONNECTION_OPTIONS = 'Driver={MariaDB ODBC 3.2 Driver};Database=Books;', 
    CREDENTIAL = MariaDBCredential
);
GO

IF OBJECT_ID('dbo.MariaDB_INFORMATION_SCHEMA_SCHEMATA', 'U') IS NOT NULL
    DROP EXTERNAL TABLE dbo.MariaDB_INFORMATION_SCHEMA_SCHEMATA;
GO

CREATE EXTERNAL TABLE dbo.MariaDB_INFORMATION_SCHEMA_SCHEMATA
(
    SCHEMA_NAME NVARCHAR(80) NULL
)
WITH (
    LOCATION = 'information_schema.schemata', --location seems to be case sensitive.
    DATA_SOURCE = MariaDB_Books
);
GO

SELECT 
    SCHEMA_NAME AS DatabaseName
FROM dbo.MariaDB_INFORMATION_SCHEMA_SCHEMATA
WHERE SCHEMA_NAME NOT IN ('information_schema');

-- Outputs Books as expected

GO

IF OBJECT_ID('dbo.MariaDB_INFORMATION_SCHEMA_TABLES', 'U') IS NOT NULL
    DROP EXTERNAL TABLE dbo.MariaDB_INFORMATION_SCHEMA_TABLES;
GO

CREATE EXTERNAL TABLE dbo.MariaDB_INFORMATION_SCHEMA_TABLES
(
    table_name NVARCHAR(64) NULL,
    table_schema NVARCHAR(64) NULL,
    table_type NVARCHAR(64) NULL
)
WITH (
    LOCATION = 'information_schema.tables',
    DATA_SOURCE = MariaDB_Books
);
GO

-- Query tables and views in a specific database
PRINT '=== Tables and Views in Books Database ===';
SELECT 
    TABLE_NAME AS ObjectName
FROM dbo.MariaDB_INFORMATION_SCHEMA_TABLES
WHERE TABLE_SCHEMA = 'Books'  -- Change this to query different databases
  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
ORDER BY TABLE_NAME;

-- outputs books and ratings as expected
GO

-- next creat fake external table with unexisting column to raire expected error containing column definitions.

CREATE EXTERNAL TABLE dbo.FakeBooks
(
    NonExistingColumn NVARCHAR(64) NULL
)
WITH (
    LOCATION = 'Books.Books', -- location = case sensitive and should be in format [database].[schema].[table]
    DATA_SOURCE = MariaDB_Books
);

-- received error as expected:
-- 105083;The following columns in the user defined schema are incompatible with the external table schema for table 'FakeBooks': user defined column: 'NonExistingColumn' was not found in the external table. The detected external table schema is: ([BookId] INT, [Title] NVARCHAR(200) COLLATE Latin1_General_CI_AS NOT NULL, [Author] NVARCHAR(200) COLLATE Latin1_General_CI_AS NOT NULL, [PublishedYear] INT).

/* CLeanup resources */
drop external table dbo.MariaDB_INFORMATION_SCHEMA_TABLES;
drop external table dbo.MariaDB_INFORMATION_SCHEMA_SCHEMATA;

SELECT * FROM sys.external_data_sources where connection_options like '%mariadb%' or connection_options like '%mysql%';
SELECT * FROM sys.external_data_sources where location like 'sqlserver://%';



-- External Table: Books.Books
CREATE EXTERNAL TABLE [dbo].[Books]
([BookId] INT, [Title] NVARCHAR(200) COLLATE Latin1_General_CI_AS NOT NULL, [Author] NVARCHAR(200) COLLATE Latin1_General_CI_AS NOT NULL, [PublishedYear] INT)
WITH (LOCATION = N'Books.Books', DATA_SOURCE = [MariaDB_Books]);

-- External Table: Books.Ratings
CREATE EXTERNAL TABLE [dbo].[Ratings]
([RatingId] INT, [BookId] INT NOT NULL, [Rating] DECIMAL(3, 1) NOT NULL, [RatedAt] DATETIME2(0) NOT NULL)
WITH (LOCATION = N'Books.Ratings', DATA_SOURCE = [MariaDB_Books]);

drop EXTERNAL table [dbo].[Ratings]