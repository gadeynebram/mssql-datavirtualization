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